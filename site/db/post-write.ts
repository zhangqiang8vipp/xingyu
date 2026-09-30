import { env } from "cloudflare:workers";
import { eq, or } from "drizzle-orm";
import { getDb } from ".";
import { ensureDatabase } from "./bootstrap";
import { isUniqueConstraintError } from "./constraint-error";
import { createPostPublicId } from "./public-id";
import { categories, postSlugHistory, posts, spaces } from "./schema";
import type { PostPayload } from "@/domain/posts/post-input";
import { attachmentIdsFromMarkdown, prepareMarkdownAttachmentBinding } from "./attachments";
import { preparePostWriteActivity, type PostWriteAudit } from "./mcp-activity";
import { getSiteOwnerUserId } from "./site-identity";

const MAX_TITLE_LENGTH = 200;
const MAX_SLUG_LENGTH = 180;
const MAX_EXCERPT_LENGTH = 1_000;
const MAX_CONTENT_LENGTH = 750_000;
const MAX_INTERNAL_ATTACHMENT_REFERENCES = 200;

export class PostWriteError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "PostWriteError";
  }
}

function isHistoricalSlugConflict(error: unknown) {
  let cause = error;
  while (cause instanceof Error) {
    if (cause.message.includes("slug reserved by another post history")
      || cause.message.includes("historical slug conflicts with another current post")) return true;
    cause = cause.cause;
  }
  return false;
}

export function validatePostInput(input: PostPayload) {
  if (!input.title) throw new PostWriteError("文章标题不能为空");
  if (input.title.length > MAX_TITLE_LENGTH) throw new PostWriteError(`文章标题不能超过 ${MAX_TITLE_LENGTH} 个字符`);
  if (!input.slug) throw new PostWriteError("文章 Slug 不能为空");
  if (input.slug.length > MAX_SLUG_LENGTH) throw new PostWriteError(`文章 Slug 不能超过 ${MAX_SLUG_LENGTH} 个字符`);
  if (input.excerpt.length > MAX_EXCERPT_LENGTH) throw new PostWriteError(`文章摘要不能超过 ${MAX_EXCERPT_LENGTH} 个字符`);
  if (input.content.length > MAX_CONTENT_LENGTH) throw new PostWriteError(`Markdown 正文不能超过 ${MAX_CONTENT_LENGTH} 个字符`);
  if (!Number.isInteger(input.categoryId) || input.categoryId < 1) throw new PostWriteError("文章分类无效");
  if (input.spaceId !== null && (!Number.isInteger(input.spaceId) || input.spaceId < 1)) throw new PostWriteError("文章空间无效");
  if (input.sortOrder !== undefined && !Number.isSafeInteger(input.sortOrder)) throw new PostWriteError("浏览顺序必须是整数");
}

async function validateSpace(spaceId: number | null) {
  if (spaceId === null) return;
  const rows = await getDb().select({ id: spaces.id }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!rows[0]) throw new PostWriteError("所选知识空间不存在");
}

function attachmentEligibility(markdown: string, postId: number | null) {
  const ids = attachmentIdsFromMarkdown(markdown);
  if (ids.length > MAX_INTERNAL_ATTACHMENT_REFERENCES) {
    throw new PostWriteError(`正文最多引用 ${MAX_INTERNAL_ATTACHMENT_REFERENCES} 个不同的内部附件`);
  }
  if (!ids.length) return { sql: "", bindings: [] as Array<string | number>, count: 0 };
  const ownerCondition = postId === null ? "post_id IS NULL" : "(post_id IS NULL OR post_id = ?)";
  return {
    sql: `AND (SELECT COUNT(*) FROM attachments WHERE public_id IN (SELECT value FROM json_each(?)) AND ${ownerCondition}) = ?`,
    bindings: [JSON.stringify(ids), ...(postId === null ? [] : [postId]), ids.length],
    count: ids.length,
  };
}

export async function createPostRecord(input: PostPayload, audit?: PostWriteAudit) {
  validatePostInput(input);
  await ensureDatabase();
  await validateSpace(input.spaceId);

  const historical = await getDb()
    .select({ postId: postSlugHistory.postId })
    .from(postSlugHistory)
    .where(eq(postSlugHistory.slug, input.slug))
    .limit(1);
  if (historical[0]) throw new PostWriteError("该 Slug 曾被使用，请换一个地址", 409);

  const publicId = createPostPublicId();
  const eligibility = attachmentEligibility(input.content, null);
  const publishedAt = input.status === "published"
    ? input.publishedAt ?? new Date().toISOString()
    : null;
  // Attribution is server-resolved: the payload never decides who the author is.
  const ownerId = await getSiteOwnerUserId();
  let activity: { id: number; createdAt: string } | undefined;
  try {
    const insert = env.DB.prepare(`INSERT INTO posts
      (public_id, title, slug, excerpt, content, category_id, space_id, sort_order, status, featured, published_at, author_id, created_by, updated_by)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM categories WHERE id = ?)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM spaces WHERE id = ?)) ${eligibility.sql}`).bind(
      publicId, input.title, input.slug, input.excerpt, input.content,
      input.categoryId, input.spaceId, input.sortOrder ?? 0, input.status, input.featured ? 1 : 0, publishedAt,
      ownerId, ownerId, ownerId,
      input.categoryId, input.spaceId, input.spaceId,
      ...eligibility.bindings,
    );
    const attachment = prepareMarkdownAttachmentBinding(env.DB, { publicId }, input.content, true);
    const statements = [insert];
    if (audit) statements.push(preparePostWriteActivity(env.DB, { publicId }, audit, true));
    if (attachment) statements.push(attachment);
    const results = await env.DB.batch(statements);
    if (audit) {
      const receipt = results[1]?.results?.[0] as { id?: number; created_at?: string } | undefined;
      if (receipt?.id && receipt.created_at) activity = { id: receipt.id, createdAt: receipt.created_at };
    }
  } catch (error) {
    if (error instanceof PostWriteError) throw error;
    if (isUniqueConstraintError(error, "posts.slug") || isHistoricalSlugConflict(error)) {
      throw new PostWriteError("文章 Slug 已被使用，请换一个地址", 409);
    }
    throw error;
  }
  const [post] = await getDb().select().from(posts).where(eq(posts.publicId, publicId)).limit(1);
  if (!post) {
    const category = await getDb().select({ id: categories.id }).from(categories)
      .where(eq(categories.id, input.categoryId)).limit(1);
    if (!category[0]) throw new PostWriteError("所选文章分类不存在", 409);
    if (input.spaceId !== null) {
      const space = await getDb().select({ id: spaces.id }).from(spaces)
        .where(eq(spaces.id, input.spaceId)).limit(1);
      if (!space[0]) throw new PostWriteError("所选知识空间不存在，文章未保存", 409);
    }
    throw new PostWriteError(eligibility.count
      ? "正文引用的附件不存在或已属于其他文章，文章未保存"
      : "文章创建结果无法读取，请按公开 ID 核对后再重试", 409);
  }
  if (audit && !activity) throw new Error("MCP article audit receipt is missing after create");
  return { ...post, activity };
}

export async function getWritablePost(identifier: string | number) {
  await ensureDatabase();
  const numericId = typeof identifier === "number"
    ? identifier
    : /^\d+$/.test(identifier) ? Number(identifier) : null;
  const condition = numericId
    ? eq(posts.id, numericId)
    : or(eq(posts.publicId, String(identifier)), eq(posts.slug, String(identifier)));
  const rows = await getDb().select().from(posts).where(condition).limit(1);
  return rows[0] ?? null;
}

export async function updatePostRecord(id: number, input: PostPayload, expectedVersion: number, audit?: PostWriteAudit) {
  validatePostInput(input);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new PostWriteError("缺少有效的文章版本，请重新打开文章后再保存", 409);
  }
  await ensureDatabase();
  await validateSpace(input.spaceId);

  const current = await getDb()
    .select({ publicId: posts.publicId, publishedAt: posts.publishedAt, slug: posts.slug, sortOrder:posts.sortOrder, version: posts.version })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!current[0]) throw new PostWriteError("文章不存在", 404);
  if (current[0].version !== expectedVersion) {
    throw new PostWriteError("文章已被其他编辑者更新，请重新打开并核对修改", 409);
  }

  let activity: { id: number; createdAt: string } | undefined;
  try {
    const eligibility = attachmentEligibility(input.content, id);
    const historical = await getDb()
      .select({ postId: postSlugHistory.postId })
      .from(postSlugHistory)
      .where(eq(postSlugHistory.slug, input.slug))
      .limit(1);
    if (historical[0] && historical[0].postId !== id) {
      throw new PostWriteError("该 Slug 属于另一篇文章的历史地址", 409);
    }
    const ownerId = await getSiteOwnerUserId();
    const publishedAt = input.status === "published"
      ? input.publishedAt ?? current[0].publishedAt ?? new Date().toISOString()
      : current[0].publishedAt;
    const history = env.DB.prepare(`INSERT OR IGNORE INTO post_slug_history (post_id, slug)
      SELECT id, slug FROM posts WHERE id = ? AND version = ? AND slug <> ?
      AND EXISTS (SELECT 1 FROM categories WHERE id = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM spaces WHERE id = ?)) ${eligibility.sql}`)
      .bind(id, expectedVersion, input.slug, input.categoryId,
        input.spaceId, input.spaceId, ...eligibility.bindings);
    const update = env.DB.prepare(`UPDATE posts SET
      title = ?, slug = ?, excerpt = ?, content = ?, category_id = ?, space_id = ?, sort_order = ?,
      status = ?, featured = ?, published_at = ?, updated_at = ?, updated_by = ?, version = version + 1
      WHERE id = ? AND version = ?
      AND EXISTS (SELECT 1 FROM categories WHERE id = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM spaces WHERE id = ?)) ${eligibility.sql}`).bind(
      input.title, input.slug, input.excerpt, input.content, input.categoryId,
      input.spaceId, input.sortOrder ?? current[0].sortOrder, input.status, input.featured ? 1 : 0, publishedAt,
      new Date().toISOString(), ownerId, id, expectedVersion, input.categoryId,
      input.spaceId, input.spaceId, ...eligibility.bindings,
    );
    // SQLite changes() excludes trigger side effects. D1 meta.changes does not.
    const changeCount = env.DB.prepare("SELECT changes() AS changed");
    // A SELECT does not reset changes(), so this still observes the post UPDATE.
    const attachment = prepareMarkdownAttachmentBinding(env.DB, { id }, input.content, true);
    const statements = [history, update, changeCount];
    if (audit) statements.push(preparePostWriteActivity(env.DB,
      { publicId: current[0].publicId, version: expectedVersion + 1 }, audit, true));
    if (attachment) statements.push(attachment);
    const results = await env.DB.batch(statements);
    const changedRow = results[2]?.results?.[0] as { changed?: number } | undefined;
    if (audit) {
      const receipt = results[3]?.results?.[0] as { id?: number; created_at?: string } | undefined;
      if (receipt?.id && receipt.created_at) activity = { id: receipt.id, createdAt: receipt.created_at };
    }
    if (Number(changedRow?.changed ?? 0) !== 1) {
      const latest = await getDb().select({ version: posts.version }).from(posts).where(eq(posts.id, id)).limit(1);
      if (latest[0]?.version === expectedVersion) {
        const category = await getDb().select({ id: categories.id }).from(categories)
          .where(eq(categories.id, input.categoryId)).limit(1);
        if (!category[0]) throw new PostWriteError("所选文章分类不存在，文章未修改", 409);
        if (input.spaceId !== null) {
          const space = await getDb().select({ id: spaces.id }).from(spaces)
            .where(eq(spaces.id, input.spaceId)).limit(1);
          if (!space[0]) throw new PostWriteError("所选知识空间不存在，文章未修改", 409);
        }
      }
      if (latest[0]?.version === expectedVersion && eligibility.count) {
        throw new PostWriteError("正文引用的附件不存在或已属于其他文章，文章未修改", 409);
      }
      throw new PostWriteError("文章已被其他编辑者更新，请重新打开并核对修改", 409);
    }
  } catch (error) {
    if (error instanceof PostWriteError) throw error;
    if (isUniqueConstraintError(error, "posts.slug") || isHistoricalSlugConflict(error)) {
      throw new PostWriteError("文章 Slug 已被使用，请换一个地址", 409);
    }
    throw error;
  }
  const [post] = await getDb().select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) throw new PostWriteError("文章不存在", 404);
  if (audit && !activity) throw new Error("MCP article audit receipt is missing after update");
  return { ...post, activity };
}

export async function deleteAdminPost(postId: number, expectedVersion: number) {
  if (!Number.isSafeInteger(postId) || postId < 1) throw new PostWriteError("文章不存在", 404);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new PostWriteError("缺少有效的文章版本，请刷新列表后再删除", 409);
  }
  await ensureDatabase();
  const current = await getDb().select({ version: posts.version }).from(posts)
    .where(eq(posts.id, postId)).limit(1);
  if (!current[0]) throw new PostWriteError("文章不存在", 404);
  if (current[0].version !== expectedVersion) {
    throw new PostWriteError("文章已被其他编辑者更新，请刷新列表后再删除", 409);
  }

  // All dependent writes use the same version guard; a concurrent edit before
  // this transaction turns the entire sequence into no-ops.
  const currentPost = "EXISTS (SELECT 1 FROM posts WHERE id = ? AND version = ?)";
  const guarded = (table: string) => env.DB.prepare(
    `DELETE FROM ${table} WHERE post_id = ? AND ${currentPost}`,
  ).bind(postId, postId, expectedVersion);
  const statements = [
    guarded("post_slug_history"),
    guarded("post_views"),
    guarded("post_preview_tokens"),
    env.DB.prepare(`UPDATE attachments SET post_id = NULL, unbound_at = CURRENT_TIMESTAMP
      WHERE post_id = ? AND ${currentPost}`).bind(postId, postId, expectedVersion),
    env.DB.prepare("DELETE FROM posts WHERE id = ? AND version = ?").bind(postId, expectedVersion),
    env.DB.prepare("SELECT changes() AS changed"),
  ];
  const result = await env.DB.batch(statements);
  const deleted = result[5]?.results?.[0] as { changed?: number } | undefined;
  if (Number(deleted?.changed ?? 0) !== 1) {
    throw new PostWriteError("文章已被其他编辑者更新，请刷新列表后再删除", 409);
  }
}

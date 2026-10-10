import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from ".";
import { ensureDatabase } from "./bootstrap";
import { attachments, posts, attachmentCleanupQueue } from "./schema";
import { removeAttachmentReference } from "@/domain/attachments/markdown-reference";
import { cleanupFailedAttachmentUpload, enqueueAttachmentCleanup } from "./attachment-cleanup";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_MCP_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const allowedTypes = new Map<string, string[]>([
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["image/webp", ["webp"]],
  ["image/gif", ["gif"]],
  ["image/avif", ["avif"]],
  ["application/pdf", ["pdf"]],
  ["text/plain", ["txt", "log"]],
  ["text/markdown", ["md", "markdown"]],
  ["text/csv", ["csv"]],
  ["application/json", ["json"]],
  ["application/zip", ["zip"]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ["docx"]],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["xlsx"]],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ["pptx"]],
]);

export class AttachmentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 415 = 400) {
    super(message);
    this.name = "AttachmentError";
  }
}

export function validateAttachmentInput(name: string, contentType: string, size: number, maxBytes = MAX_ATTACHMENT_BYTES) {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 240) throw new AttachmentError("附件名称无效");
  if (/[\u0000-\u001f\u007f]/.test(normalizedName)) throw new AttachmentError("附件名称包含无效字符");
  if (!Number.isSafeInteger(size) || size < 1) throw new AttachmentError("附件不能为空");
  if (size > maxBytes) throw new AttachmentError(`附件不能超过 ${formatBytes(maxBytes)}`, 413);
  const extension = normalizedName.split(".").pop()?.toLowerCase() ?? "";
  const extensions = allowedTypes.get(contentType.toLowerCase());
  if (!extensions?.includes(extension)) {
    throw new AttachmentError("不支持这种附件。可上传图片、PDF、Markdown、文本、CSV、JSON、ZIP 与 Office 文档", 415);
  }
  return { name: normalizedName, contentType: contentType.toLowerCase(), extension };
}

export async function createAttachment(input: {
  name: string;
  contentType: string;
  bytes: Uint8Array;
  postId?: number | null;
  workspaceId?: number;
  audit?: { summary: string; clientLabel: string };
}) {
  await ensureDatabase();
  const checked = validateAttachmentInput(input.name, input.contentType, input.bytes.byteLength);
  const workspaceId = input.workspaceId ?? 1;
  if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) throw new AttachmentError("工作区无效",404);
  if (input.postId) {
    const post = await getDb().select({ id: posts.id, workspaceId: posts.workspaceId }).from(posts).where(eq(posts.id, input.postId)).limit(1);
    if (!post[0] || post[0].workspaceId !== workspaceId) throw new AttachmentError("要关联的文章不存在", 404);
  }

  const publicId = `att_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const safeName = safeObjectName(checked.name);
  const objectKey = `attachments/${workspaceId === 1 ? "" : "ws" + workspaceId + "/"}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${publicId}/${safeName}`;
  const stableBytes = new Uint8Array(input.bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes);
  const sha256 = bytesToHex(new Uint8Array(digest));

  await env.MEDIA.put(objectKey, stableBytes, {
    httpMetadata: { contentType: checked.contentType },
    customMetadata: { originalName: checked.name, attachmentId: publicId, sha256 },
  });

  const postId = input.postId ?? null;
  // Same UTC layout as SQLite CURRENT_TIMESTAMP so expiry comparisons stay consistent.
  const unboundAt = postId === null ? new Date().toISOString().slice(0, 19).replace("T", " ") : null;
  const insert = env.DB.prepare(`INSERT INTO attachments
      (workspace_id, public_id, post_id, object_key, original_name, content_type, size, sha256, unbound_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND status = 'active')
        AND (? IS NULL OR EXISTS (SELECT 1 FROM posts WHERE id = ? AND workspace_id = ?))
      RETURNING id, public_id AS publicId, post_id AS postId, object_key AS objectKey,
        original_name AS originalName, content_type AS contentType, size, sha256,
        created_at AS createdAt`).bind(
      workspaceId, publicId, postId, objectKey, checked.name, checked.contentType,
      input.bytes.byteLength, sha256, unboundAt, workspaceId, postId, postId, workspaceId,
    );
  const statements = [insert];
  if (input.audit) {
    statements.push(env.DB.prepare(`INSERT INTO mcp_activity
        (workspace_id, action, post_id, public_id, title, before_status, after_status, changed_fields, summary, client_label)
        SELECT a.workspace_id, 'upload_attachment', COALESCE(p.id, 0),
          CASE WHEN a.post_id IS NULL THEN 'attachment:' || a.public_id ELSE p.public_id END,
          CASE WHEN a.post_id IS NULL THEN a.original_name ELSE p.title END,
          p.status, COALESCE(p.status, 'unbound_private'), '["attachments"]', ?, ?
        FROM attachments a LEFT JOIN posts p ON p.id = a.post_id
        WHERE a.public_id = ? AND changes() = 1 RETURNING id, created_at`).bind(
        input.audit.summary, input.audit.clientLabel, publicId,
    ));
  }
  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (error) {
    await cleanupFailedAttachmentUpload(env.MEDIA, publicId, objectKey, error, env.DB);
    throw error;
  }
  const record = results[0]?.results?.[0] as {
      id: number; publicId: string; postId: number | null; objectKey: string;
      originalName: string; contentType: string; size: number; sha256: string; createdAt: string;
  } | undefined;
  if (!record) {
    const error = new AttachmentError(postId === null
      ? "附件记录创建失败" : "要关联的文章已不存在，附件未保存", 409);
    await cleanupFailedAttachmentUpload(env.MEDIA, publicId, objectKey, error, env.DB);
    throw error;
  }
  const auditRow = input.audit ? results[1]?.results?.[0] as { id?: number; created_at?: string } | undefined : undefined;
  if (input.audit && (!auditRow?.id || !auditRow.created_at)) {
    // D1 already returned a committed attachment row. Keep its R2 object reachable.
    console.error(JSON.stringify({ event: "attachment_audit_receipt_missing", publicId, objectKey }));
    throw new Error(`附件 ${publicId} 已写入，但审计回执缺失；请联系管理员核查`);
  }
  return { ...record, activity: auditRow ? { id: auditRow.id!, createdAt: auditRow.created_at! } : undefined };
}

export async function getAttachment(publicId: string) {
  await ensureDatabase();
  const rows = await getDb().select({
    id: attachments.id,
    workspaceId: attachments.workspaceId,
    publicId: attachments.publicId,
    postId: attachments.postId,
    objectKey: attachments.objectKey,
    originalName: attachments.originalName,
    contentType: attachments.contentType,
    size: attachments.size,
    sha256: attachments.sha256,
    createdAt: attachments.createdAt,
    postStatus: posts.status,
    postSpaceId: posts.spaceId,
  }).from(attachments).leftJoin(posts, eq(attachments.postId, posts.id))
    .where(eq(attachments.publicId, publicId)).limit(1);
  return rows[0] ?? null;
}

export async function getAttachmentObject(objectKey: string) {
  return env.MEDIA.get(objectKey);
}

export async function listAttachmentOrphanCandidates(cursor?: string) {
  await ensureDatabase();
  const page = await env.MEDIA.list({ prefix: "attachments/", limit: 100, ...(cursor ? { cursor } : {}) });
  const keys = page.objects.map((object) => object.key);
  const known = keys.length
    ? await env.DB.prepare(`SELECT object_key FROM attachments
      WHERE object_key IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(keys))
      .all<{ object_key: string }>()
    : null;
  const recorded = new Set((known?.results ?? []).map((row) => row.object_key));
  return {
    candidates: page.objects.filter((object) => !recorded.has(object.key)).map((object) => ({
      objectKey: object.key,
      attachmentId: object.key.match(/^attachments\/(?:ws\d+\/)?\d{4}\/\d{2}\/(att_[a-f0-9]{32})\//)?.[1] ?? null,
      size: object.size,
      uploadedAt: object.uploaded.toISOString(),
    })),
    nextCursor: page.truncated ? page.cursor : null,
  };
}

export async function listPostAttachments(postId: number) {
  await ensureDatabase();
  return getDb().select().from(attachments)
    .where(eq(attachments.postId, postId))
    .orderBy(attachments.createdAt, attachments.id);
}

export async function deleteAttachment(publicId: string, expectedVersion?: number) {
  await ensureDatabase();
  const record = await getDb().select().from(attachments)
    .where(eq(attachments.publicId, publicId)).limit(1);
  if (!record[0]) throw new AttachmentError("附件不存在或已经删除", 404);

  let nextVersion: number | null = null;
  if (record[0].postId !== null) {
    const post = await getDb().select({ content: posts.content, version: posts.version }).from(posts)
      .where(eq(posts.id, record[0].postId)).limit(1);
    if (post[0]) {
      if (!Number.isSafeInteger(expectedVersion) || (expectedVersion ?? 0) < 1) {
        throw new AttachmentError("缺少有效的文章版本，请重新打开文章后再删除附件", 409);
      }
      if (post[0].version !== expectedVersion) {
        throw new AttachmentError("文章已被其他编辑者更新，请重新打开并核对附件", 409);
      }
      const markdown = attachmentMarkdown(record[0]);
      const content = removeAttachmentReference(post[0].content, { url: attachmentUrl(record[0]), markdown });
      const result = await env.DB.batch([
        env.DB.prepare(`DELETE FROM attachments WHERE public_id = ? AND post_id = ?
          AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND version = ?)`)
          .bind(publicId, record[0].postId, record[0].postId, expectedVersion),
        env.DB.prepare(`UPDATE posts SET content = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND changes() = 1`)
          .bind(content, new Date().toISOString(), record[0].postId, expectedVersion),
        env.DB.prepare("SELECT changes() AS changed"),
      ]);
      const changed = result[2]?.results?.[0] as { changed?: number } | undefined;
      if (Number(changed?.changed ?? 0) !== 1) {
        throw new AttachmentError("附件或文章已发生变化，请刷新后重试", 409);
      }
      nextVersion = expectedVersion + 1;
    } else {
      const result = await env.DB.batch([
        env.DB.prepare(`DELETE FROM attachments WHERE public_id = ? AND post_id = ?
          AND NOT EXISTS (SELECT 1 FROM posts WHERE id = ?)`)
          .bind(publicId, record[0].postId, record[0].postId),
        env.DB.prepare("SELECT changes() AS changed"),
      ]);
      const changed = result[1]?.results?.[0] as { changed?: number } | undefined;
      if (Number(changed?.changed ?? 0) !== 1) {
        throw new AttachmentError("附件归属已发生变化，请刷新后重试", 409);
      }
    }
  } else {
    const result = await env.DB.batch([
      env.DB.prepare("DELETE FROM attachments WHERE public_id = ? AND post_id IS NULL").bind(publicId),
      env.DB.prepare("SELECT changes() AS changed"),
    ]);
    const changed = result[1]?.results?.[0] as { changed?: number } | undefined;
    if (Number(changed?.changed ?? 0) !== 1) {
      throw new AttachmentError("附件归属已发生变化，请刷新后重试", 409);
    }
  }
  try {
    await env.MEDIA.delete(record[0].objectKey);
  } catch (error) {
    // The database row owns reachability. Once it is gone the object is private
    // and can be reclaimed later without turning a successful delete into a retry.
    console.error(JSON.stringify({
      event: "attachment_object_cleanup_required", operation: "delete", publicId,
      objectKey: record[0].objectKey,
      cleanupErrorType: error instanceof Error ? error.name : typeof error,
    }));
    await enqueueAttachmentCleanup(env.DB, publicId, record[0].objectKey, "delete", error);
  }
  return { ...record[0], version: nextVersion };
}

export async function listCleanupQueueItems(limit = 100) {
  await ensureDatabase();
  const rows = await getDb().select({
    id: attachmentCleanupQueue.id,
    publicId: attachmentCleanupQueue.publicId,
    objectKey: attachmentCleanupQueue.objectKey,
    operation: attachmentCleanupQueue.operation,
    status: attachmentCleanupQueue.status,
    attempts: attachmentCleanupQueue.attempts,
    lastError: attachmentCleanupQueue.lastError,
    createdAt: attachmentCleanupQueue.createdAt,
    updatedAt: attachmentCleanupQueue.updatedAt,
  }).from(attachmentCleanupQueue)
    .where(eq(attachmentCleanupQueue.status, "pending"))
    .orderBy(attachmentCleanupQueue.createdAt, attachmentCleanupQueue.id)
    .limit(Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 100, 1), 500));
  return rows.map((row) => ({
    id: row.id,
    publicId: row.publicId,
    objectKey: row.objectKey,
    operation: row.operation,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
  }));
}

/**
 * Marks a queued cleanup as resolved. The operator must reclaim the R2 object
 * by its exact key first; resolving verifies server-side that the object is
 * gone before the queue entry is closed, so a stray click cannot hide an
 * object that is still stored.
 */
export async function resolveCleanupQueueItem(objectKey: string) {
  await ensureDatabase();
  const rows = await getDb().select({
    id: attachmentCleanupQueue.id,
    status: attachmentCleanupQueue.status,
    operation: attachmentCleanupQueue.operation,
  }).from(attachmentCleanupQueue).where(eq(attachmentCleanupQueue.objectKey, objectKey)).limit(1);
  if (!rows[0]) throw new AttachmentError("待回收对象不存在", 404);
  if (rows[0].status === "resolved") throw new AttachmentError("该对象已标记为回收完成", 409);
  if (rows[0].operation === "expired_unbound") {
    const attachment = await env.DB.prepare("SELECT post_id FROM attachments WHERE object_key = ?")
      .bind(objectKey).first<{ post_id: number | null }>();
    if (attachment?.post_id != null) throw new AttachmentError("附件已绑定文章，不能按过期未绑定附件回收", 409);
  }
  const head = await env.MEDIA.head(objectKey);
  if (head) throw new AttachmentError("对象仍存在于 R2，请先按精确键删除对象再确认回收", 409);
  if (rows[0].operation === "expired_unbound") {
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM attachments WHERE object_key = ? AND post_id IS NULL
        AND EXISTS (SELECT 1 FROM attachment_cleanup_queue
          WHERE object_key = ? AND operation = 'expired_unbound' AND status = 'pending')`)
        .bind(objectKey, objectKey),
      env.DB.prepare(`UPDATE attachment_cleanup_queue SET status = 'resolved', updated_at = CURRENT_TIMESTAMP
        WHERE object_key = ? AND operation = 'expired_unbound' AND status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM attachments WHERE object_key = ?)`)
        .bind(objectKey, objectKey),
    ]);
    if (results[1]?.meta.changes !== 1) {
      throw new AttachmentError("附件归属已变化，请重新检查后再确认回收", 409);
    }
    return { objectKey, operation: rows[0].operation, resolved: true };
  }
  await getDb().update(attachmentCleanupQueue)
    .set({ status: "resolved", updatedAt: new Date().toISOString() })
    .where(eq(attachmentCleanupQueue.objectKey, objectKey));
  return { objectKey, operation: rows[0].operation, resolved: true };
}

export function prepareMarkdownAttachmentBinding(
  db: D1Database,
  post: { id: number } | { publicId: string },
  markdown: string,
  requirePreviousWrite = false,
) {
  const ids = attachmentIdsFromMarkdown(markdown);
  if (!ids.length) return null;
  const identifier = "id" in post ? post.id : post.publicId;
  const target = "id" in post ? "?" : "(SELECT id FROM posts WHERE public_id = ?)";
  return db.prepare(`UPDATE attachments SET post_id = ${target}
    WHERE public_id IN (SELECT value FROM json_each(?))
      AND (post_id IS NULL OR post_id = ${target})
      ${requirePreviousWrite ? "AND changes() = 1" : ""}`)
    .bind(identifier, JSON.stringify(ids), identifier);
}

export function attachmentIdsFromMarkdown(markdown: string) {
  const matches = markdown.matchAll(/\/api\/attachments\/(att_[a-f0-9]{32})(?:\/|[)\s"']|$)/gi);
  return [...new Set(Array.from(matches, (match) => match[1].toLowerCase()))];
}

export function attachmentUrl(record: { publicId: string; originalName: string }) {
  return `/api/attachments/${record.publicId}/${encodeURIComponent(record.originalName)}`;
}

export function attachmentMarkdown(record: { publicId: string; originalName: string; contentType: string; size: number }) {
  const url = attachmentUrl(record);
  const escapedName = record.originalName.replaceAll("[", "\\[").replaceAll("]", "\\]");
  if (record.contentType.startsWith("image/")) return `![${escapedName}](${url})`;
  return `[${escapedName}](${url} "${fileKind(record.originalName)} · ${formatBytes(record.size)}")`;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function fileKind(name: string) {
  return name.split(".").pop()?.toUpperCase() || "FILE";
}

function safeObjectName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "bin";
  const stem = name.slice(0, Math.max(0, name.length - extension.length - 1))
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";
  return `${stem}.${extension}`;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { ensureDatabase } from "@/db/bootstrap";
import { getContentPage, listAdminPosts } from "@/db/queries";
import { categories } from "@/db/schema";
import { getSpaceOverview, getSpacePath, listSpaceChildren, listSpacePosts, resolveSpace, searchSpaces } from "@/db/spaces";
import {
  AttachmentError,
  MAX_MCP_ATTACHMENT_BYTES,
  attachmentMarkdown,
  attachmentUrl,
  getAttachment,
  getAttachmentObject,
  listPostAttachments,
} from "@/db/attachments";
import { PostWriteError } from "@/db/post-write";
import { requireScope } from "../mcp-auth";
import { extractMarkdownOutline, postReadHint, searchPostCard, type PostView } from "./post-read";
import {
  IDENTIFIER_SCHEMA,
  MCP_ERROR_OUTPUT_FIELDS,
  SPACE_SCHEMA,
  hydratePost,
  listMcpActivity,
  publicPostUrl,
  toolFailure,
  toolResult,
  type McpToolContext,
} from "./shared";

export function registerReadTools({ server, origin, auth }: McpToolContext) {
  server.registerTool("list_categories", {
    title: "列出文章分类",
    description: "读取线上博客的全部可用分类。创建文章前可用它确认 category 参数。",
    inputSchema: {},
    outputSchema: { categories: z.array(z.object({
      id: z.number(), name: z.string(), slug: z.string(), color: z.string(),
    })).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      requireScope(auth, "xingyu.read");
      await ensureDatabase();
      const rows = await getDb().select({
        id: categories.id, name: categories.name, slug: categories.slug, color: categories.color,
      }).from(categories).orderBy(categories.id);
      return toolResult({ ok: true, categories: rows });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("list_spaces", {
    title: "浏览知识空间",
    description: "读取顶级空间或指定空间的直属子空间。空间层级不固定，可逐层浏览。",
    inputSchema: { parent: SPACE_SCHEMA.optional(), query: z.string().trim().max(100).optional() },
    outputSchema: {
      parent: z.object({ id: z.number(), name: z.string() }).nullable().optional(),
      spaces: z.array(z.record(z.string(), z.unknown())).optional(),
      ...MCP_ERROR_OUTPUT_FIELDS,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ parent, query }) => {
    try {
      requireScope(auth, "xingyu.read");
      if (query) {
        const matches = await searchSpaces(query);
        return toolResult({ ok: true, parent: null, spaces: matches.map((space) => ({ ...space, display_path: space.path.map((item) => item.name).join(" / ") })) });
      }
      const parentSpace = parent ? await resolveSpace(parent) : null;
      const rows = await listSpaceChildren(parentSpace?.id ?? null);
      return toolResult({ ok: true, parent: parentSpace ? { id: parentSpace.id, name: parentSpace.name } : null, spaces: rows });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("get_space", {
    title: "读取知识空间",
    description: "读取空间完整路径、直属子空间、后代数量与文章总数。",
    inputSchema: { space: SPACE_SCHEMA },
    outputSchema: { space: z.record(z.string(), z.unknown()).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ space }) => {
    try {
      requireScope(auth, "xingyu.read");
      const resolved = await resolveSpace(space);
      const overview = await getSpaceOverview(resolved.id);
      return toolResult({ ok: true, space: overview ? { ...overview, display_path: overview.path.map((item) => item.name).join(" / ") } : null });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("search_posts", {
    title: "搜索文章目录",
    description: "先用这个工具定位文章，不要直接读取全文。默认只返回标题、状态和 public_id；需要摘要时把 detail 设为 summary。查询至少 3 个字才会搜正文。确认一篇后再用 get_post。",
    inputSchema: {
      query: z.string().trim().max(200).optional().default(""),
      status: z.enum(["all", "draft", "published"]).optional().default("all"),
      category: z.string().trim().max(100).optional().default("all"),
      space: SPACE_SCHEMA.optional(),
      include_descendants: z.boolean().optional().default(true),
      detail: z.enum(["minimal", "summary"]).optional().default("minimal")
        .describe("minimal 只返回目录卡片；summary 才包含摘要和日期"),
      cursor: z.string().max(180).optional(),
      page_size: z.number().int().min(1).max(50).optional().default(12),
    },
    outputSchema: {
      detail: z.enum(["minimal", "summary"]).optional(),
      hint: z.string().optional(),
      posts: z.array(z.record(z.string(), z.unknown())).optional(),
      next_cursor: z.string().nullable().optional(),
      ...MCP_ERROR_OUTPUT_FIELDS,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, status, category, space, include_descendants, detail, cursor, page_size }) => {
    try {
      requireScope(auth, "xingyu.read");
      const resolvedSpace = space ? await resolveSpace(space) : null;
      const result = resolvedSpace
        ? await listSpacePosts({ spaceId: resolvedSpace.id, includeDescendants: include_descendants, query, status, category, cursor, limit: page_size })
        : await listAdminPosts({ query, status, category, cursor, limit: page_size, space: "all" });
      return toolResult({
        ok: true,
        detail,
        hint: "先根据目录确认 public_id。不要对候选文章批量调用 get_post 的 content 视图。",
        posts: result.rows.map((post) => searchPostCard(post, origin, detail)),
        next_cursor: result.nextCursor,
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("get_post", {
    title: "分层读取文章",
    description: "按需读取一篇文章。默认只返回标题大纲；确认后再用 view=excerpt 看摘要，或 view=content 取全文。修改、引用正文前必须 view=content。不要连续打开多篇全文。",
    inputSchema: {
      identifier: IDENTIFIER_SCHEMA,
      view: z.enum(["meta", "excerpt", "outline", "content"]).optional().default("outline")
        .describe("meta 仅元数据；excerpt 加摘要；outline 加标题大纲；content 才返回完整 Markdown"),
    },
    outputSchema: { hint: z.string().optional(), post: z.record(z.string(), z.unknown()).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ identifier, view }) => {
    try {
      requireScope(auth, "xingyu.read");
      const post = await hydratePost(identifier);
      const category = await getDb().select({
        name: categories.name, slug: categories.slug, color: categories.color,
      }).from(categories).where(eq(categories.id, post.categoryId)).limit(1);
      const spacePath = post.spaceId ? await getSpacePath(post.spaceId) : [];
      const selectedView = view as PostView;
      const body: Record<string, unknown> = {
        view: selectedView,
        public_id: post.publicId,
        version: post.version,
        title: post.title,
        slug: post.slug,
        status: post.status,
        featured: post.featured,
        visibility: post.spaceId ? "space" : "public",
        space: post.spaceId ? { id: post.spaceId, path: spacePath.map((item) => item.name), display_path: spacePath.map((item) => item.name).join(" / ") } : null,
        sort_order: post.spaceId ? post.sortOrder : null,
        category: category[0] ?? null,
        published_at: post.publishedAt,
        created_at: post.createdAt,
        updated_at: post.updatedAt,
        public_url: post.status === "published" && !post.spaceId ? publicPostUrl(origin, post) : null,
      };
      if (selectedView === "excerpt" || selectedView === "content") body.excerpt = post.excerpt;
      if (selectedView === "outline") body.outline = extractMarkdownOutline(post.content);
      if (selectedView === "content") body.content_markdown = post.content;
      const hint = postReadHint(selectedView);
      return toolResult({ ok: true, ...(hint ? { hint } : {}), post: body });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("get_page", {
    title: "读取独立页面",
    description: "读取星屿的接入页或关于页，包括独立标题、摘要和完整 Markdown。修改页面前应先调用。",
    inputSchema: {
      slug: z.enum(["connect", "about"]).describe("页面标识：connect 为接入页，about 为关于页"),
    },
    outputSchema: { page: z.record(z.string(), z.unknown()).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ slug }) => {
    try {
      requireScope(auth, "xingyu.read");
      const page = await getContentPage(slug);
      if (!page) throw new PostWriteError("页面不存在", 404);
      return toolResult({
        ok: true,
        page: {
          slug: page.slug,
          eyebrow: page.eyebrow,
          title: page.title,
          excerpt: page.excerpt,
          content_markdown: page.content,
          updated_at: page.updatedAt,
          public_url: `${origin}/${page.slug}`,
        },
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("list_mcp_activity", {
    title: "查看 AI 写作记录",
    description: "只读查看最近的 MCP 写入回执，包括文章、操作、状态变化、修改字段、客户端与时间。",
    inputSchema: { limit: z.number().int().min(1).max(50).optional().default(20) },
    outputSchema: { activities: z.array(z.record(z.string(), z.unknown())).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit }) => {
    try {
      requireScope(auth, "xingyu.read");
      return toolResult({ ok: true, activities: await listMcpActivity(limit) });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("list_attachments", {
    title: "列出文章已上传的附件",
    description: "读取一篇文章已经绑定的图片和文件，以及可插入正文的 Markdown 链接。文章有没有附件，先用这个工具确认。",
    inputSchema: { identifier: IDENTIFIER_SCHEMA },
    outputSchema: { attachments: z.array(z.record(z.string(), z.unknown())).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ identifier }) => {
    try {
      requireScope(auth, "xingyu.read");
      const post = await hydratePost(identifier);
      const rows = await listPostAttachments(post.id);
      return toolResult({
        ok: true,
        attachments: rows.map((attachment) => ({
          public_id: attachment.publicId,
          filename: attachment.originalName,
          content_type: attachment.contentType,
          size: attachment.size,
          sha256: attachment.sha256,
          markdown: attachmentMarkdown(attachment),
          url: `${origin}${attachmentUrl(attachment)}`,
          created_at: attachment.createdAt,
        })),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("download_attachment", {
    title: "下载已上传的文章附件",
    description: "通过附件 public_id 读取星屿上已有的图片或文件。返回 Base64、校验值和文件信息，便于继续处理或重新插入正文。",
    inputSchema: { public_id: z.string().regex(/^att_[a-f0-9]{32}$/i) },
    outputSchema: { attachment: z.record(z.string(), z.unknown()).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ public_id }) => {
    try {
      requireScope(auth, "xingyu.read");
      const attachment = await getAttachment(public_id.toLowerCase());
      if (!attachment) throw new AttachmentError("附件不存在", 404);
      if (attachment.size > MAX_MCP_ATTACHMENT_BYTES) {
        throw new AttachmentError("附件超过 MCP 的 8 MB 下载上限，请使用返回的 URL 在已登录后台下载", 413);
      }
      const object = await getAttachmentObject(attachment.objectKey);
      if (!object) throw new AttachmentError("附件文件不存在", 404);
      const bytes = new Uint8Array(await object.arrayBuffer());
      return toolResult({
        ok: true,
        attachment: {
          public_id: attachment.publicId,
          filename: attachment.originalName,
          content_type: attachment.contentType,
          size: attachment.size,
          sha256: attachment.sha256,
          content_base64: encodeBase64(bytes),
          url: `${origin}${attachmentUrl(attachment)}`,
        },
      });
    } catch (error) {
      return toolFailure(error);
    }
  });
}

function encodeBase64(bytes: Uint8Array) {
  let result = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(result);
}

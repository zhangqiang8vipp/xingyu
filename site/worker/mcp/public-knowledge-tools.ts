import { z } from "zod";
import { getPostByPublicId, listArchivePosts } from "@/db/queries";
import {
  AttachmentError,
  attachmentMarkdown,
  attachmentUrl,
  getAttachment,
  getAttachmentObject,
  listPostAttachments,
  MAX_MCP_ATTACHMENT_BYTES,
} from "@/db/attachments";
import { requireScope } from "../mcp-auth";
import { MCP_ERROR_OUTPUT_FIELDS, publicPostUrl, toolFailure, toolResult, type McpToolContext } from "./shared";

const generic = z.record(z.string(), z.unknown());

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}

export function registerPublicKnowledgeTools({ server, origin, auth }: McpToolContext) {
  server.registerTool("search_public_posts", {
    title: "搜索公开文章",
    description: "只搜索已发布且位于公开站点空间的文章；不会返回草稿或私人知识空间内容。先搜索目录，再按 public_id 读取需要的文章。",
    inputSchema: {
      query: z.string().trim().max(200).optional().default(""),
      cursor: z.string().max(180).optional(),
      page_size: z.number().int().min(1).max(50).optional().default(20),
    },
    outputSchema: { posts: z.array(generic).optional(), next_cursor: z.string().nullable().optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ query, cursor, page_size }) => {
    try {
      requireScope(auth, "xingyu.read");
      const result = await listArchivePosts({ query, cursor, limit: page_size });
      return toolResult({
        ok: true,
        posts: result.rows.map((post) => ({
          public_id: post.publicId,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          published_at: post.publishedAt,
          category: post.categoryName,
          public_url: publicPostUrl(origin, post),
          visibility: "public",
          can_edit: false,
        })),
        next_cursor: result.nextCursor,
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("get_public_post", {
    title: "读取公开文章",
    description: "通过 public_id 读取已发布公开文章的正文；私人空间文章、草稿和其他用户的个人内容不可读取。",
    inputSchema: { public_id: z.string().trim().min(1).max(180) },
    outputSchema: { post: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ public_id }) => {
    try {
      requireScope(auth, "xingyu.read");
      const post = await getPostByPublicId(public_id);
      if (!post) throw new Error("公开文章不存在");
      return toolResult({
        ok: true,
        post: {
          public_id: post.publicId,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content_markdown: post.content,
          published_at: post.publishedAt,
          category: post.categoryName,
          public_url: publicPostUrl(origin, post),
          visibility: "public",
          can_edit: false,
        },
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("list_public_attachments", {
    title: "列出公开文章附件",
    description: "只列出已发布公开文章绑定的附件，不会暴露私人文章或未发布文章的文件。",
    inputSchema: { public_id: z.string().trim().min(1).max(180) },
    outputSchema: { attachments: z.array(generic).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ public_id }) => {
    try {
      requireScope(auth, "xingyu.read");
      const post = await getPostByPublicId(public_id);
      if (!post) throw new Error("公开文章不存在");
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
          url: origin + attachmentUrl(attachment),
          created_at: attachment.createdAt,
        })),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  server.registerTool("download_public_attachment", {
    title: "下载公开文章附件",
    description: "通过附件 public_id 下载文件内容。仅允许 workspace 1 中绑定到已发布公开文章的附件，MCP 下载上限 8 MB。",
    inputSchema: { public_id: z.string().regex(/^att_[a-f0-9]{32}$/i) },
    outputSchema: { attachment: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ public_id }) => {
    try {
      requireScope(auth, "xingyu.read");
      const attachment = await getAttachment(public_id.toLowerCase());
      if (!attachment || attachment.workspaceId !== 1 || !attachment.postId
        || attachment.postStatus !== "published" || attachment.postSpaceId !== null) {
        throw new AttachmentError("公开附件不存在", 404);
      }
      if (attachment.size > MAX_MCP_ATTACHMENT_BYTES) {
        throw new AttachmentError("附件超过 MCP 的 8 MB 下载上限，请使用公开 URL 下载", 413);
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
          url: origin + attachmentUrl(attachment),
        },
      });
    } catch (error) {
      return toolFailure(error);
    }
  });
}

import { z } from "zod";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { scopedCreateDraft, scopedPost, scopedPosts, scopedUpdatePost, WorkspaceContentError } from "@/db/workspace-content";
import {
  AttachmentError,
  MAX_MCP_ATTACHMENT_BYTES,
  attachmentMarkdown,
  attachmentUrl,
  createAttachment,
  getAttachment,
  getAttachmentObject,
  listPostAttachments,
} from "@/db/attachments";
import { requireScope } from "../mcp-auth";
import { MCP_ERROR_OUTPUT_FIELDS, publicPostUrl, toolFailure, toolResult, type McpToolContext } from "./shared";

const generic = z.record(z.string(), z.unknown());
const identifier = z.string().trim().min(1).max(180);

async function personalContext(auth: McpToolContext["auth"], scope: "xingyu.read" | "xingyu.draft") {
  requireScope(auth, scope);
  if (!auth.userId) throw new WorkspaceContentError("个人知识空间 MCP 需要关联真实星屿账号，请重新授权", 403);
  const workspaceId = await ensurePersonalWorkspace(auth.userId);
  return { userId: auth.userId, workspaceId };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

function personalPostView(post: Awaited<ReturnType<typeof scopedPost>>) {
  return {
    public_id: post.publicId,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    content_markdown: post.content,
    status: post.status,
    version: post.version,
    updated_at: post.updatedAt,
    published_at: post.publishedAt,
    visibility: "personal",
    can_edit: true,
    public_url: null,
  };
}

export function registerPersonalKnowledgeTools({ server, origin, clientLabel, auth }: McpToolContext) {
  server.registerTool("list_my_posts", {
    title: "列出我的私人文章",
    description: "只返回当前账号个人工作区中归属于当前用户的文章。不会列出其他用户的文章、团队文章或公开站点文章。需要 xingyu.read。",
    inputSchema: { query: z.string().trim().max(120).optional().default(""), limit: z.number().int().min(1).max(50).optional().default(30) },
    outputSchema: { posts: z.array(generic).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => {
    try {
      const { userId, workspaceId } = await personalContext(auth, "xingyu.read");
      const posts = await scopedPosts(userId, workspaceId, query, limit);
      return toolResult({ ok: true, posts: posts.map((post) => ({ ...post, visibility: "personal", can_edit: true, public_url: null })) });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("get_my_post", {
    title: "读取我的私人文章",
    description: "读取当前账号自己的私人文章正文。其他人的私人文章、团队文章和公开站点文章不能通过此工具读取。需要 xingyu.read。",
    inputSchema: { identifier },
    outputSchema: { post: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ identifier: postIdentifier }) => {
    try {
      const { userId, workspaceId } = await personalContext(auth, "xingyu.read");
      const post = await scopedPost(userId, workspaceId, postIdentifier);
      return toolResult({ ok: true, post: personalPostView(post) });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("create_my_draft", {
    title: "创建私人草稿",
    description: "在当前账号的个人知识空间创建私密草稿。不会发布到站点首页，也不能设置公开发布状态。需要 xingyu.draft。",
    inputSchema: { title: z.string().trim().min(1).max(200), content_markdown: z.string().max(750000).optional().default(""), excerpt: z.string().max(1000).optional().default("") },
    outputSchema: { post: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ title, content_markdown, excerpt }) => {
    try {
      const { userId, workspaceId } = await personalContext(auth, "xingyu.draft");
      const post = await scopedCreateDraft(userId, workspaceId, { title, content: content_markdown, excerpt }, clientLabel, "MCP 创建私人草稿");
      return toolResult({ ok: true, post: personalPostView(post) });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("update_my_post", {
    title: "修改我的私人文章",
    description: "仅允许修改当前账号自己的个人文章，必须提供读取时的 version。不能通过此工具发布、撤回或修改公开站点文章。需要 xingyu.draft。",
    inputSchema: { identifier, expected_version: z.number().int().min(1), title: z.string().trim().min(1).max(200).optional(), content_markdown: z.string().max(750000).optional(), excerpt: z.string().max(1000).optional() },
    outputSchema: { post: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ identifier: postIdentifier, expected_version, title, content_markdown, excerpt }) => {
    try {
      const { userId, workspaceId } = await personalContext(auth, "xingyu.draft");
      const post = await scopedUpdatePost(userId, workspaceId, postIdentifier, {
        expectedVersion: expected_version, title, content: content_markdown, excerpt,
      }, clientLabel, "MCP 修改私人文章");
      return toolResult({ ok: true, post: personalPostView(post) });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("list_my_attachments", {
    title: "列出我的文章附件",
    description: "只列出当前账号自己文章绑定的附件；其他用户的私人文件不会返回。公开文章附件使用 list_public_attachments。需要 xingyu.read。",
    inputSchema: { identifier },
    outputSchema: { attachments: z.array(generic).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ identifier: postIdentifier }) => {
    try {
      const { userId, workspaceId } = await personalContext(auth, "xingyu.read");
      const post = await scopedPost(userId, workspaceId, postIdentifier);
      const rows = await listPostAttachments(post.id);
      return toolResult({ ok: true, attachments: rows.filter((row) => row.workspaceId === workspaceId).map((row) => ({
        public_id: row.publicId, filename: row.originalName, content_type: row.contentType, size: row.size, sha256: row.sha256,
        markdown: attachmentMarkdown(row), url: origin + attachmentUrl(row), created_at: row.createdAt, visibility: "personal",
      })) });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("download_my_attachment", {
    title: "下载我的文章附件",
    description: "只能下载绑定到当前账号自己文章的附件，MCP 下载上限 8 MB。公开附件使用 download_public_attachment。需要 xingyu.read。",
    inputSchema: { public_id: z.string().regex(/^att_[a-f0-9]{32}$/i) },
    outputSchema: { attachment: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ public_id }) => {
    try {
      const { userId, workspaceId } = await personalContext(auth, "xingyu.read");
      const attachment = await getAttachment(public_id.toLowerCase());
      if (!attachment || attachment.workspaceId !== workspaceId || !attachment.postId) throw new AttachmentError("私人附件不存在", 404);
      const post = await scopedPost(userId, workspaceId, attachment.postId);
      if (attachment.size > MAX_MCP_ATTACHMENT_BYTES) throw new AttachmentError("附件超过 MCP 的 8 MB 下载上限", 413);
      const object = await getAttachmentObject(attachment.objectKey);
      if (!object) throw new AttachmentError("附件文件不存在", 404);
      const bytes = new Uint8Array(await object.arrayBuffer());
      return toolResult({ ok: true, attachment: {
        public_id: attachment.publicId, filename: attachment.originalName, content_type: attachment.contentType, size: attachment.size, sha256: attachment.sha256,
        content_base64: encodeBase64(bytes), url: origin + attachmentUrl(attachment), article_public_id: post.publicId, visibility: "personal",
      } });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("upload_my_attachment", {
    title: "上传文件到我的文章",
    description: "只允许向当前账号自己的私人文章上传附件。必须关联一篇自己的文章；不能上传到公开站点或他人的文章。单文件不超过 8 MB。需要 xingyu.draft。",
    inputSchema: { post_identifier: identifier, filename: z.string().trim().min(1).max(240), content_type: z.string().trim().min(1).max(160), content_base64: z.string().min(1).max(12000000) },
    outputSchema: { attachment: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ post_identifier, filename, content_type, content_base64 }) => {
    try {
      const { userId, workspaceId } = await personalContext(auth, "xingyu.draft");
      const post = await scopedPost(userId, workspaceId, post_identifier);
      const bytes = decodeBase64(content_base64);
      if (bytes.byteLength > MAX_MCP_ATTACHMENT_BYTES) throw new AttachmentError("MCP 单个附件不能超过 8 MB", 413);
      const attachment = await createAttachment({
        name: filename, contentType: content_type, bytes, postId: post.id, workspaceId, actorUserId: userId,
        audit: { summary: "上传个人文章附件", clientLabel },
      });
      return toolResult({ ok: true, attachment: {
        public_id: attachment.publicId, filename: attachment.originalName, content_type: attachment.contentType, size: attachment.size, sha256: attachment.sha256,
        article_public_id: post.publicId, markdown: attachmentMarkdown(attachment), url: origin + attachmentUrl(attachment), visibility: "personal",
      } });
    } catch (error) { return toolFailure(error); }
  });
}

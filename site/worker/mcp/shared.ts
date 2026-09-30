import { eq, or } from "drizzle-orm";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "@/db";
import { ensureDatabase } from "@/db/bootstrap";
import { listMcpActivity, type McpActivityAction } from "@/db/mcp-activity";
import { getWritablePost, PostWriteError } from "@/db/post-write";
import { categories } from "@/db/schema";
import { scopeFailure, type McpAuth } from "../mcp-auth";

export const IDENTIFIER_SCHEMA = z.string().trim().min(1).max(180)
  .describe("文章的稳定 public_id、当前 slug 或后台数字 ID");
export const CATEGORY_SCHEMA = z.string().trim().min(1).max(100)
  .describe("分类 slug 或分类名称；不确定时先调用 list_categories");
export const SPACE_SCHEMA = z.string().trim().min(1).max(500)
  .describe("空间数字 ID，或使用 / 分隔的完整路径，例如“QSG / 研发团队 / 麒麟系统适配”");
export const CHANGE_SUMMARY_SCHEMA = z.string().trim().min(1).max(300)
  .describe("展示在权限确认和操作记录中的中文变更摘要，例如“补充部署章节并修正文末链接”");
export const RECEIPT_OUTPUT_SCHEMA = z.object({
  action: z.string(),
  activity_id: z.number().nullable(),
  summary: z.string(),
  changed_fields: z.array(z.string()),
  recorded_at: z.string().nullable(),
});

/**
 * Result fields shared by every MCP tool outputSchema.
 *
 * `toolFailure()` routes a ScopeError through `scopeFailure()`, which returns
 * `required_scope` next to `ok` and `error`. Every tool can raise a scope
 * error, so every outputSchema has to allow that field. Without it, strict
 * MCP clients reject the whole result with -32602 ("Structured content does
 * not match the tool's output schema") instead of surfacing
 * insufficient_scope to the caller, which turns a clear permission error into
 * an opaque protocol failure.
 */
export const MCP_ERROR_OUTPUT_FIELDS = {
  ok: z.boolean(),
  error: z.string().optional(),
  required_scope: z.string().optional(),
};

export type McpToolContext = {
  server: McpServer;
  origin: string;
  clientLabel: string;
  auth: McpAuth;
};

type ToolPayload = Record<string, unknown>;

export function toolResult(payload: ToolPayload, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

export function toolFailure(error: unknown) {
  return scopeFailure(error) ?? toolResult({
    ok: false,
    error: error instanceof Error ? error.message : "操作失败",
  }, true);
}

export function publicPostUrl(origin: string, post: { publicId: string; slug: string }) {
  return `${origin}/posts/${post.publicId}/${post.slug}`;
}

export function changedPostFields(
  current: Awaited<ReturnType<typeof hydratePost>>,
  next: {
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    categoryId: number;
    spaceId: number | null;
    sortOrder?: number;
    featured: boolean;
  },
) {
  return [
    current.title !== next.title ? "title" : null,
    current.slug !== next.slug ? "slug" : null,
    current.excerpt !== next.excerpt ? "excerpt" : null,
    current.content !== next.content ? "content_markdown" : null,
    current.categoryId !== next.categoryId ? "category" : null,
    current.spaceId !== next.spaceId ? "space" : null,
    next.sortOrder !== undefined && current.sortOrder !== next.sortOrder ? "sort_order" : null,
    current.featured !== next.featured ? "featured" : null,
  ].filter((field): field is string => field !== null);
}

export function activityReceipt(
  action: McpActivityAction,
  activity: { id: number; createdAt: string } | null | undefined,
  summary: string,
  changedFields: string[],
) {
  return {
    action,
    activity_id: activity?.id ?? null,
    summary,
    changed_fields: changedFields,
    recorded_at: activity?.createdAt ?? null,
  };
}

export async function resolveCategory(reference?: string) {
  await ensureDatabase();
  const db = getDb();
  if (!reference) {
    const rows = await db.select().from(categories).orderBy(categories.id).limit(1);
    if (!rows[0]) throw new PostWriteError("还没有可用分类，请先在后台创建分类");
    return rows[0];
  }
  const rows = await db.select().from(categories)
    .where(or(eq(categories.slug, reference), eq(categories.name, reference)))
    .limit(1);
  if (!rows[0]) throw new PostWriteError(`找不到分类“${reference}”，请先调用 list_categories`);
  return rows[0];
}

export async function hydratePost(identifier: string) {
  const post = await getWritablePost(identifier);
  if (!post) throw new PostWriteError("文章不存在", 404);
  return post;
}

export { listMcpActivity };

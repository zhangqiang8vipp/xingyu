import { env } from "cloudflare:workers";
import { accessibleSpaceIds } from "@/db/space-acl";

/**
 * Shared personal/public list for the unified /admin portal.
 * Cursor order is updated_at DESC, id DESC; both list sources use one query
 * to avoid losing articles beyond the first 50 entries of either source.
 * SQL checks ownership and public visibility BEFORE applying any cursor.
 */
export type KnowledgeListType = "mine" | "public" | "all";
export type KnowledgeListStatus = "all" | "draft" | "published";
type Cursor = { t: string; id: number };

export class KnowledgeListError extends Error {
  constructor(message: string) { super(message); }
}

function parseCursor(value: string | null): Cursor | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{5,320}$/.test(value)) throw new KnowledgeListError("无效分页游标");
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    const { t, id } = parsed as Partial<Cursor>;
    if (typeof t !== "string" || !/^[0-9T:+.Z -]{10,48}$/.test(t)
      || !Number.isSafeInteger(id) || Number(id) < 1) throw new Error("invalid values");
    return { t, id: Number(id) };
  } catch { throw new KnowledgeListError("无效分页游标"); }
}

function encodeCursor(row: { updatedAt: string; id: number }) {
  return btoa(JSON.stringify({ t: row.updatedAt, id: row.id }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

type KnowledgeRow = {
  id: number; publicId: string; title: string; slug: string;
  excerpt: string; status: string; version: number;
  spaceId: number | null; updatedAt: string; publishedAt: string | null;
  viewCount: number; featured: number; sortOrder: number;
  categoryId: number; categoryName: string; categorySlug: string;
  categoryColor: string; visibility: "personal" | "public";
};

export async function listKnowledgePage(input: {
  userId: number; workspaceId: number; type: KnowledgeListType;
  query: string; status: KnowledgeListStatus; category: string;
  cursor: string | null; limit: number; origin: string;
}) {
  const after = parseCursor(input.cursor);
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit) || 20));
  // workspaceGrant inside accessibleSpaceIds rejects forged workspace IDs.
  const visible = await accessibleSpaceIds(input.userId, input.workspaceId);
  const conditions: string[] = [];
  const args: unknown[] = [];
  const personal = ["p.workspace_id=?", "(p.author_id=? OR p.created_by=? OR (p.author_id IS NULL AND p.created_by IS NULL))"];
  const personalArgs: unknown[] = [input.workspaceId, input.userId, input.userId];
  if (visible !== null) {
    if (visible.length === 0) personal.push("0=1");
    else {
      personal.push("p.space_id IN (" + visible.map(() => "?").join(",") + ")");
      personalArgs.push(...visible);
    }
  }
  const publicClause = "(p.workspace_id=1 AND p.status='published' AND p.space_id IS NULL)";
  if (input.type === "mine") {
    conditions.push("(" + personal.join(" AND ") + ")");
    args.push(...personalArgs);
  } else if (input.type === "public") {
    conditions.push(publicClause);
  } else {
    conditions.push("((" + personal.join(" AND ") + ") OR " + publicClause + ")");
    args.push(...personalArgs);
  }
  // Personal articles remain private drafts in the user console. Published
  // here means public site articles, not a private post's internal status.
  if (input.status === "draft") {
    conditions.push("p.workspace_id=?");
    args.push(input.workspaceId);
  } else if (input.status === "published") {
    conditions.push("p.workspace_id=1");
  }
  if (input.category && input.category !== "all") {
    conditions.push("c.slug=?");
    args.push(input.category);
  }
  if (input.query) {
    const escaped = input.query.trim().slice(0, 120).replace(/[\\%_]/g, char => "\\" + char);
    const pattern = "%" + escaped + "%";
    conditions.push("(p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\' OR p.slug LIKE ? ESCAPE '\\')");
    args.push(pattern, pattern, pattern);
  }
  if (after) {
    conditions.push("(p.updated_at<? OR (p.updated_at=? AND p.id<?))");
    args.push(after.t, after.t, after.id);
  }
  const sql = "SELECT p.id,p.public_id AS publicId,p.title,p.slug,p.excerpt,p.status,p.version," +
    "p.space_id AS spaceId,p.updated_at AS updatedAt,p.published_at AS publishedAt," +
    "p.view_count AS viewCount,p.featured,p.sort_order AS sortOrder," +
    "p.category_id AS categoryId,c.name AS categoryName,c.slug AS categorySlug,c.color AS categoryColor," +
    "CASE WHEN p.workspace_id=1 THEN 'public' ELSE 'personal' END AS visibility " +
    "FROM posts p JOIN categories c ON c.id=p.category_id AND c.workspace_id=p.workspace_id " +
    "WHERE " + conditions.join(" AND ") + " ORDER BY p.updated_at DESC,p.id DESC LIMIT ?";
  const result = await env.DB.prepare(sql).bind(...args, limit + 1).all<KnowledgeRow>();
  const found = result.results ?? [];
  const page = found.slice(0, limit);
  const hasMore = found.length > limit;
  return {
    posts: page.map(row => ({
      ...row,
      status: row.visibility === "public" ? "published" : "draft",
      canEdit: row.visibility === "personal",
      ...(row.visibility === "public"
        ? { publicUrl: input.origin + "/posts/" + row.publicId + "/" + row.slug }
        : {}),
    })),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  };
}

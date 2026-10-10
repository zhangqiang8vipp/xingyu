import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { cache } from "react";
import { getDb } from ".";
import { ensureDatabase } from "./bootstrap";
import { categories, contentPages, posts, siteSettings } from "./schema";
import { getSpacePath } from "./spaces";
import { spacePathSql } from "./space-path-sql";
import { CONTENT_LIMITS, DEFAULT_ABOUT_PAGE, DEFAULT_CONNECT_PAGE, DEFAULT_SITE_SETTINGS } from "@/domain/site/config";
import { adminReaderSqlFilter, type AdminReaderContext } from "@/domain/reader/admin-reader-context";
import { createPublicReadSession, type PublicReadSession } from "./read-session";

export type PostFilters = {
  page?: number;
  pageSize?: number;
  query?: string;
  category?: string;
  status?: "draft" | "published" | "all";
};

export async function listPosts(filters: PostFilters = {}) {
  await ensureDatabase();
  const db = getDb();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(CONTENT_LIMITS.apiMaximum, Math.max(1, filters.pageSize ?? CONTENT_LIMITS.searchResults));
  // This generic reader belongs to the public content surface. Private
  // knowledge-space articles must only be reached through authenticated
  // admin/MCP queries, even if a future caller forgets to add the boundary.
  const conditions = [eq(posts.workspaceId,1),isNull(posts.spaceId)];

  if (filters.status && filters.status !== "all") conditions.push(eq(posts.status, filters.status));
  if (filters.category && filters.category !== "all") conditions.push(eq(categories.slug, filters.category));
  if (filters.query) {
    const needle = `%${filters.query}%`;
    conditions.push(or(like(posts.title, needle), like(posts.excerpt, needle), like(posts.slug, needle))!);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, totalRows] = await Promise.all([
    db.select({
      id: posts.id, publicId: posts.publicId, title: posts.title, slug: posts.slug, excerpt: posts.excerpt,
      status: posts.status, featured: posts.featured, viewCount: posts.viewCount,
      publishedAt: posts.publishedAt, updatedAt: posts.updatedAt,
      categoryId: posts.categoryId, categoryName: categories.name,
      categorySlug: categories.slug, categoryColor: categories.color,
    }).from(posts).leftJoin(categories, eq(posts.categoryId, categories.id))
      .where(where).orderBy(desc(posts.featured), desc(posts.publishedAt), desc(posts.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ value: sql<number>`count(*)` }).from(posts)
      .leftJoin(categories, eq(posts.categoryId, categories.id)).where(where),
  ]);

  const total = Number(totalRows[0]?.value ?? 0);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const getCategories = cache(async function getCategories() {
  await ensureDatabase();
  return getDb().select({ id: categories.id, name: categories.name, slug: categories.slug, color: categories.color })
    .from(categories).where(eq(categories.workspaceId,1)).orderBy(categories.id);
});

export async function listHomePosts(category = "all", requestedLimit: number = CONTENT_LIMITS.homeDefault) {
  await ensureDatabase();
  const limit = Math.min(CONTENT_LIMITS.homeMaximum, Math.max(1, requestedLimit));
  const conditions = [eq(posts.workspaceId,1),eq(posts.status, "published"),isNull(posts.spaceId)];
  if (category !== "all") conditions.push(eq(categories.slug, category));
  return getDb().select({
    id: posts.id, publicId: posts.publicId, title: posts.title, slug: posts.slug, excerpt: posts.excerpt,
    contentLength: sql<number>`length(${posts.content})`,
    status: posts.status, featured: posts.featured, viewCount: posts.viewCount,
    publishedAt: posts.publishedAt, updatedAt: posts.updatedAt,
    categoryId: posts.categoryId, categoryName: categories.name,
    categorySlug: categories.slug, categoryColor: categories.color,
  }).from(posts).leftJoin(categories, eq(posts.categoryId, categories.id))
    .where(and(...conditions)).orderBy(desc(posts.featured), desc(posts.publishedAt), desc(posts.id)).limit(limit);
}

export const getSiteSettings = cache(async function getSiteSettings() {
  await ensureDatabase();
  const rows = await getDb().select().from(siteSettings).where(eq(siteSettings.id, 1)).limit(1);
  return rows[0] ?? { ...DEFAULT_SITE_SETTINGS, updatedAt: new Date(0).toISOString() };
});

export async function getContentPage(slug: string) {
  await ensureDatabase();
  const rows = await getDb().select().from(contentPages).where(eq(contentPages.slug, slug)).limit(1);
  const fallback = slug === "about" ? DEFAULT_ABOUT_PAGE : slug === "connect" ? DEFAULT_CONNECT_PAGE : null;
  return rows[0] ?? (fallback ? { id: 0, ...fallback, updatedAt: new Date(0).toISOString() } : null);
}

export async function getAdminStats() {
  await ensureDatabase();
  const rows = await getDb().select({
    total: sql<number>`sum(case when ${posts.spaceId} is null then 1 else 0 end)`,
    published: sql<number>`sum(case when ${posts.spaceId} is null and ${posts.status} = 'published' then 1 else 0 end)`,
    drafts: sql<number>`sum(case when ${posts.spaceId} is null and ${posts.status} = 'draft' then 1 else 0 end)`,
    views: sql<number>`coalesce(sum(case when ${posts.spaceId} is null then ${posts.viewCount} else 0 end), 0)`,
    privateArticles: sql<number>`sum(case when ${posts.spaceId} is not null then 1 else 0 end)`,
  }).from(posts).where(eq(posts.workspaceId,1));
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    published: Number(row?.published ?? 0),
    drafts: Number(row?.drafts ?? 0),
    views: Number(row?.views ?? 0),
    privateArticles: Number(row?.privateArticles ?? 0),
  };
}

export async function getAdminPost(postId: number) {
  await ensureDatabase();
  const rows = await getDb().select().from(posts).where(and(eq(posts.id, postId),eq(posts.workspaceId,1))).limit(1);
  if (!rows[0]) return null;
  const path = rows[0].spaceId ? await getSpacePath(rows[0].spaceId) : [];
  return { ...rows[0], spacePath: path.map((item) => item.name).join(" / ") };
}

export type PublicPost = {
  id: number;
  publicId: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  publishedAt: string | null;
  viewCount: number;
  categoryName: string | null;
  categorySlug: string | null;
  categoryColor: string | null;
};

const publicPostSelection = `SELECT
  p.id,
  p.public_id AS publicId,
  p.title,
  p.slug,
  p.excerpt,
  p.content,
  p.published_at AS publishedAt,
  p.view_count AS viewCount,
  c.name AS categoryName,
  c.slug AS categorySlug,
  c.color AS categoryColor
  FROM posts p
  LEFT JOIN categories c ON p.category_id = c.id`;

async function getPublicReadSession(session?: PublicReadSession) {
  if (session) return session;
  await ensureDatabase();
  return createPublicReadSession();
}

async function readPublicPostBySlug(session: PublicReadSession, slug: string) {
  return session.first<PublicPost>(
    `${publicPostSelection}
      WHERE p.slug = ? AND p.status = 'published' AND p.space_id IS NULL AND p.workspace_id = 1
      LIMIT 1`,
    [slug],
  );
}

async function readPublicPostByPublicId(session: PublicReadSession, publicId: string) {
  return session.first<PublicPost>(
    `${publicPostSelection}
      WHERE p.public_id = ? AND p.status = 'published' AND p.space_id IS NULL AND p.workspace_id = 1
      LIMIT 1`,
    [publicId],
  );
}

async function readPublicPostById(session: PublicReadSession, id: number) {
  return session.first<PublicPost>(
    `${publicPostSelection}
      WHERE p.id = ? AND p.status = 'published' AND p.space_id IS NULL AND p.workspace_id = 1
      LIMIT 1`,
    [id],
  );
}

export async function getPostBySlug(slug: string, session?: PublicReadSession) {
  return readPublicPostBySlug(await getPublicReadSession(session), slug);
}

export async function getPostByPublicId(publicId: string, session?: PublicReadSession) {
  return readPublicPostByPublicId(await getPublicReadSession(session), publicId);
}

/** Resolves current slugs, historical slugs, and bare public IDs for legacy links. */
export async function resolvePublicPost(identifier: string, session?: PublicReadSession) {
  const reader = await getPublicReadSession(session);
  const direct = await readPublicPostByPublicId(reader, identifier)
    ?? await readPublicPostBySlug(reader, identifier);
  if (direct) return direct;

  const history = await reader.first<{ postId: number }>(
    "SELECT post_id AS postId FROM post_slug_history WHERE slug = ? LIMIT 1",
    [identifier],
  );
  if (!history) return null;
  return readPublicPostById(reader, history.postId);
}

export async function getNextPublishedPost(
  publishedAt: string | null,
  id: number,
  session?: PublicReadSession,
) {
  return getAdjacentPublishedPost(publishedAt, id, "older", session);
}

export async function getPreviousPublishedPost(
  publishedAt: string | null,
  id: number,
  session?: PublicReadSession,
) {
  return getAdjacentPublishedPost(publishedAt, id, "newer", session);
}

export type AdminReaderPost={
  id:number;
  publicId:string;
  title:string;
  slug:string;
  excerpt:string;
  content:string;
  status:"draft"|"published";
  viewCount:number;
  publishedAt:string|null;
  updatedAt:string;
  categoryName:string|null;
  categoryColor:string|null;
  spaceId:number|null;
  spacePath:string|null;
};

const adminReaderSelection=`SELECT
  p.id,p.public_id AS publicId,p.title,p.slug,p.excerpt,p.content,p.status,
  p.view_count AS viewCount,p.published_at AS publishedAt,p.updated_at AS updatedAt,
  c.name AS categoryName,c.color AS categoryColor,p.space_id AS spaceId,
  CASE WHEN p.space_id IS NULL THEN NULL ELSE ${spacePathSql} END AS spacePath
  FROM posts p LEFT JOIN categories c ON p.category_id=c.id`;

/** Authenticated reading uses the same shape as public reading without weakening public queries. */
export async function getAdminReaderPost(identifier:string){
  await ensureDatabase();
  return await env.DB.prepare(`${adminReaderSelection} WHERE p.workspace_id=1 AND (p.public_id=? OR p.slug=?) LIMIT 1`)
    .bind(identifier,identifier).first<AdminReaderPost>();
}

export async function getPreviousAdminPost(updatedAt:string,id:number,readerContext?:AdminReaderContext){
  return getAdjacentAdminPost(updatedAt,id,"newer",readerContext);
}

export async function getNextAdminPost(updatedAt:string,id:number,readerContext?:AdminReaderContext){
  return getAdjacentAdminPost(updatedAt,id,"older",readerContext);
}

async function getAdjacentAdminPost(updatedAt:string,id:number,direction:"older"|"newer",readerContext?:AdminReaderContext){
  await ensureDatabase();
  if(readerContext?.source==="spaces"&&(readerContext.range==="space"||readerContext.range==="private")){
    const allSpaces=readerContext.range==="private";
    const roots=allSpaces
      ? "SELECT id,printf('%010d/',sibling_rank),printf('/%d/',id) FROM ranked WHERE parent_id IS NULL"
      : "SELECT id,'',printf('/%d/',id) FROM spaces WHERE id=? AND workspace_id=1";
    const scope=allSpaces||readerContext.includeDescendants?"":"AND h.id=?";
    const params:Array<string|number>=allSpaces?[]:[readerContext.spaceId!];
    if(scope)params.push(readerContext.spaceId!);
    const neighbor=await env.DB.prepare(`WITH RECURSIVE ranked AS (
        SELECT id,parent_id,row_number() OVER (
          PARTITION BY parent_id ORDER BY sort_order ASC,name COLLATE NOCASE ASC,id ASC
        ) AS sibling_rank FROM spaces WHERE workspace_id=1
      ), hierarchy(id,order_path,visited) AS (
        ${roots}
        UNION ALL
        SELECT child.id,h.order_path||printf('%010d/',child.sibling_rank),h.visited||printf('%d/',child.id)
        FROM ranked child JOIN hierarchy h ON child.parent_id=h.id
        WHERE instr(h.visited,printf('/%d/',child.id))=0
      ), ordered AS (
        SELECT p.id,row_number() OVER (ORDER BY h.order_path ASC,p.sort_order ASC,p.id ASC) AS position
        FROM posts p JOIN hierarchy h ON h.id=p.space_id WHERE p.workspace_id=1 ${scope}
      )
      SELECT neighbor.id FROM ordered current
      JOIN ordered neighbor ON neighbor.position=current.position+?
      WHERE current.id=? LIMIT 1`).bind(...params,direction==="older"?1:-1,id).first<{id:number}>();
    return neighbor?env.DB.prepare(`${adminReaderSelection} WHERE p.id=? AND p.workspace_id=1 LIMIT 1`).bind(neighbor.id).first<AdminReaderPost>():null;
  }
  const older=direction==="older";
  const operator=older?"<":">";
  const order=older?"DESC":"ASC";
  const filter=adminReaderSqlFilter(readerContext);
  return await env.DB.prepare(`${adminReaderSelection}
    WHERE p.workspace_id=1 AND (p.updated_at ${operator} ? OR (p.updated_at=? AND p.id ${operator} ?))${filter.sql}
    ORDER BY p.updated_at ${order},p.id ${order} LIMIT 1`)
    .bind(updatedAt,updatedAt,id,...filter.bindings).first<AdminReaderPost>();
}

export type PublicAdjacentPost = {
  id: number;
  publicId: string;
  title: string;
  slug: string;
  excerpt: string;
  publishedAt: string | null;
  categoryName: string | null;
  categoryColor: string | null;
};

const adjacentPublicPostSelection = `SELECT
  p.id,
  p.public_id AS publicId,
  p.title,
  p.slug,
  p.excerpt,
  p.published_at AS publishedAt,
  c.name AS categoryName,
  c.color AS categoryColor
  FROM posts p
  LEFT JOIN categories c ON p.category_id = c.id`;

/** A single cursor query powers both directions so their ordering rules cannot drift apart. */
async function getAdjacentPublishedPost(
  publishedAt: string | null,
  id: number,
  direction: "older" | "newer",
  session?: PublicReadSession,
) {
  if (!publishedAt) return null;
  const reader = await getPublicReadSession(session);
  const older = direction === "older";
  const operator = older ? "<" : ">";
  const order = older ? "DESC" : "ASC";
  return reader.first<PublicAdjacentPost>(
    `${adjacentPublicPostSelection}
      WHERE p.status = 'published'
        AND p.workspace_id = 1
        AND p.space_id IS NULL
        AND (p.published_at ${operator} ? OR (p.published_at = ? AND p.id ${operator} ?))
      ORDER BY p.published_at ${order}, p.id ${order}
      LIMIT 1`,
    [publishedAt, publishedAt, id],
  );
}

export type CursorPost = {
  id: number;
  version: number;
  publicId: string;
  title: string;
  slug: string;
  excerpt: string;
  status: "draft" | "published";
  featured: boolean;
  viewCount: number;
  publishedAt: string | null;
  updatedAt: string;
  categoryId: number;
  categoryName: string | null;
  categorySlug: string | null;
  categoryColor: string | null;
  spaceId: number | null;
  spacePath: string | null;
};

type RawCursorPost = Omit<CursorPost, "featured"> & { featured: number };

type CursorFilters = {
  cursor?: string;
  limit?: number;
  query?: string;
  category?: string;
  status?: "draft" | "published" | "all";
  space?: "all"|"public"|"private"|number;
};

export async function listArchivePosts(filters: CursorFilters = {}) {
  return listPostsByCursor({ ...filters, status: "published", sort: "published" });
}

export async function listAdminPosts(filters: CursorFilters = {}) {
  return listPostsByCursor({ ...filters, sort: "updated" });
}

async function listPostsByCursor(filters: CursorFilters & { sort: "published" | "updated" }) {
  await ensureDatabase();
  const limit = Math.min(CONTENT_LIMITS.apiMaximum, Math.max(1, filters.limit ?? CONTENT_LIMITS.adminBatch));
  const query = filters.query?.trim() ?? "";
  const useFts = Array.from(query).length >= 3;
  const params: Array<string | number> = [];
  const conditions: string[] = ["p.workspace_id = 1"];
  let from = "FROM posts p LEFT JOIN categories c ON p.category_id = c.id";

  if (useFts) {
    from += " JOIN posts_fts ON posts_fts.rowid = p.id";
    conditions.push("posts_fts MATCH ?");
    params.push(`"${query.replace(/"/g, '""')}"`);
  } else if (query) {
    conditions.push("(p.title LIKE ? OR p.excerpt LIKE ? OR p.slug LIKE ?)");
    const needle = `%${query}%`;
    params.push(needle, needle, needle);
  }
  if (filters.status && filters.status !== "all") {
    conditions.push("p.status = ?");
    params.push(filters.status);
  }
  if (filters.category && filters.category !== "all") {
    conditions.push("c.slug = ?");
    params.push(filters.category);
  }
  if(filters.sort==="published")conditions.push("p.space_id IS NULL");
  if(filters.space==="public")conditions.push("p.space_id IS NULL");
  if(filters.space==="private")conditions.push("p.space_id IS NOT NULL");
  if(typeof filters.space==="number"){
    conditions.push("p.space_id = ?");
    params.push(filters.space);
  }

  const cursor = decodeCursor(filters.cursor);
  const sortColumn = filters.sort === "published" ? "p.published_at" : "p.updated_at";
  if (cursor) {
    conditions.push(`(${sortColumn} < ? OR (${sortColumn} = ? AND p.id < ?))`);
    params.push(cursor.value, cursor.value, cursor.id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const statement = env.DB.prepare(`SELECT
    p.id, p.version, p.public_id AS publicId, p.title, p.slug, p.excerpt, p.status, p.featured, p.view_count AS viewCount,
    p.published_at AS publishedAt, p.updated_at AS updatedAt, p.category_id AS categoryId,
    c.name AS categoryName, c.slug AS categorySlug, c.color AS categoryColor,
    p.space_id AS spaceId,
    CASE WHEN p.space_id IS NULL THEN NULL ELSE ${spacePathSql} END AS spacePath
    ${from} ${where}
    ORDER BY ${sortColumn} DESC, p.id DESC
    LIMIT ?`).bind(...params, limit + 1);
  const result = await statement.all<RawCursorPost>();
  const allRows: CursorPost[] = (result.results ?? []).map((row: RawCursorPost) => ({
    ...row,
    featured: Boolean(row.featured),
  }));
  const hasMore = allRows.length > limit;
  const rows = allRows.slice(0, limit);
  const last = rows[rows.length - 1];
  const cursorValue = filters.sort === "published" ? last?.publishedAt : last?.updatedAt;
  return { rows, hasMore, nextCursor: hasMore && last && cursorValue ? encodeCursor(cursorValue, last.id) : null };
}

function encodeCursor(value: string, id: number) {
  return btoa(`${value}|${id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(cursor?: string) {
  if (!cursor || cursor.length > 180) return null;
  try {
    const normalized = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const separator = decoded.lastIndexOf("|");
    const value = decoded.slice(0, separator);
    const id = Number(decoded.slice(separator + 1));
    if (separator < 1 || !value || !Number.isInteger(id) || id < 1) return null;
    return { value, id };
  } catch {
    return null;
  }
}

export type PostPayload = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  categoryId: number;
  spaceId: number | null;
  sortOrder?: number;
  status: "draft" | "published";
  featured: boolean;
  publishedAt: string | null;
};

export function parsePostPayload(payload: Record<string, unknown>): PostPayload {
  const title = String(payload.title ?? "").trim();
  const spaceId = Number.isInteger(Number(payload.spaceId)) && Number(payload.spaceId) > 0 ? Number(payload.spaceId) : null;
  return {
    title,
    slug: slugify(String(payload.slug ?? "") || title),
    excerpt: String(payload.excerpt ?? ""),
    content: String(payload.content ?? ""),
    categoryId: Number(payload.categoryId) || 1,
    spaceId,
    sortOrder:payload.sortOrder===undefined?undefined:Number(payload.sortOrder),
    status: payload.status === "published" ? "published" : "draft",
    featured: spaceId===null&&Boolean(payload.featured),
    publishedAt: normalizeDate(payload.publishedAt),
  };
}

export function slugify(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}-]+/gu, "").replace(/-+/g, "-") || `post-${Date.now()}`;
}

export function normalizeDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

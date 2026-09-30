import { eq } from "drizzle-orm";
import { getDb } from ".";
import { ensureDatabase } from "./bootstrap";
import { contentPages, siteSettings } from "./schema";
import { CONTENT_LIMITS } from "@/domain/site/config";

export class SiteContentError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function updateSiteSettings(payload: Record<string, unknown>) {
  await ensureDatabase();
  const values: Partial<typeof siteSettings.$inferInsert> = { updatedAt: new Date().toISOString() };
  const textFields = [
    "brandName", "brandLatin", "authorName", "avatarUrl", "tagline", "description",
    "heroLead", "heroTail", "homeSectionTitle", "homeAboutTitle", "homeAboutCopy",
    "footerText", "seoTitle", "seoDescription",
  ] as const;
  for (const key of textFields) {
    if (payload[key] != null) values[key] = String(payload[key]).trim();
  }
  if (payload.homePostLimit != null) {
    values.homePostLimit = Math.min(
      CONTENT_LIMITS.homeMaximum,
      Math.max(1, Number(payload.homePostLimit) || CONTENT_LIMITS.homeDefault),
    );
  }
  const [updated] = await getDb().update(siteSettings).set(values)
    .where(eq(siteSettings.id, 1)).returning();
  if (!updated) throw new Error("站点设置缺失，更新未保存");
  return updated;
}

export async function upsertContentPage(slug: string, payload: Record<string, unknown>) {
  await ensureDatabase();
  const values: Partial<typeof contentPages.$inferInsert> = { updatedAt: new Date().toISOString() };
  for (const key of ["eyebrow", "title", "excerpt", "content"] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const value = String(payload[key] ?? "");
      values[key] = key === "content" ? value : value.trim();
    }
  }
  if (values.title === "") throw new SiteContentError("页面标题不能为空");
  const [updated] = await getDb().update(contentPages).set(values)
    .where(eq(contentPages.slug, slug)).returning();
  if (updated) return updated;
  if (!values.title) throw new SiteContentError("新页面需要标题");
  const [created] = await getDb().insert(contentPages).values({
    slug,
    title: values.title,
    eyebrow: values.eyebrow ?? "",
    excerpt: values.excerpt ?? "",
    content: values.content ?? "",
    updatedAt: values.updatedAt,
  }).returning();
  return created;
}
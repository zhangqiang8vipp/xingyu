import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from ".";
import { ensureDatabase } from "./bootstrap";
import { isUniqueConstraintError } from "./constraint-error";
import { categories } from "./schema";
import { slugify } from "@/domain/posts/post-input";

type CategoryInput = { name?: string; slug?: string; color?: string };

export class CategoryServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function categoryValues(payload: CategoryInput) {
  const name = payload.name?.trim();
  if (!name) throw new CategoryServiceError("分类名称不能为空", 400);
  return {
    name,
    slug: slugify(payload.slug || name),
    color: payload.color || "#0071e3",
  };
}

export async function createCategory(payload: CategoryInput) {
  await ensureDatabase();
  try {
    const [category] = await getDb().insert(categories).values(categoryValues(payload)).returning();
    return category;
  } catch (error) {
    if (error instanceof CategoryServiceError) throw error;
    if (isUniqueConstraintError(error, "categories.slug")) throw new CategoryServiceError("这个分类已经存在", 409);
    throw error;
  }
}

export async function updateCategory(categoryId: number, payload: CategoryInput) {
  await ensureDatabase();
  try {
    const values: Partial<typeof categories.$inferInsert> = {};
    if (payload.name !== undefined) {
      const name = payload.name?.trim();
      if (!name) throw new CategoryServiceError("分类名称不能为空", 400);
      values.name = name;
    }
    if (payload.slug !== undefined) {
      if (!payload.slug?.trim() && !values.name) throw new CategoryServiceError("分类 Slug 不能为空", 400);
      values.slug = slugify(payload.slug || values.name!);
    }
    if (payload.color !== undefined) values.color = payload.color || "#0071e3";
    if (Object.keys(values).length === 0) throw new CategoryServiceError("没有可更新的分类字段", 400);
    const [category] = await getDb().update(categories).set(values).where(eq(categories.id, categoryId)).returning();
    if (!category) throw new CategoryServiceError("分类不存在", 404);
    return category;
  } catch (error) {
    if (error instanceof CategoryServiceError) throw error;
    if (isUniqueConstraintError(error, "categories.slug")) throw new CategoryServiceError("分类名称或 Slug 已存在", 409);
    throw error;
  }
}

export async function deleteCategory(categoryId: number) {
  await ensureDatabase();
  const deleted = await env.DB.prepare(`DELETE FROM categories WHERE id = ?
    AND NOT EXISTS (SELECT 1 FROM posts WHERE category_id = ?)`).bind(categoryId, categoryId).run();
  if (deleted.meta.changes > 0) return;
  const remaining = await getDb().select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (remaining[0]) throw new CategoryServiceError("该分类仍有文章，暂时不能删除", 409);
  throw new CategoryServiceError("分类不存在", 404);
}
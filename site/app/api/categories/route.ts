import { getCategories } from "@/db/queries";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { CategoryServiceError, createCategory } from "@/db/categories";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  return Response.json({ categories: await getCategories() });
}

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const payload = await request.json() as { name?: string; slug?: string; color?: string };
  try {
    return Response.json({ category: await createCategory(payload) }, { status: 201 });
  } catch (error) {
    if (error instanceof CategoryServiceError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "分类创建失败" }, { status: 500 });
  }
}

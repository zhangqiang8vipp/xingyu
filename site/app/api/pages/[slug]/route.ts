import { getContentPage } from "@/db/queries";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { SiteContentError, upsertContentPage } from "@/db/site-content";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const { slug } = await params;
  const page = await getContentPage(slug);
  return page ? Response.json({ page }) : Response.json({ error: "页面不存在" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const { slug } = await params;
  const payload = await request.json() as Record<string, unknown>;
  try {
    return Response.json({ page: await upsertContentPage(slug, payload) });
  } catch (error) {
    if (error instanceof SiteContentError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "页面保存失败" }, { status: 500 });
  }
}

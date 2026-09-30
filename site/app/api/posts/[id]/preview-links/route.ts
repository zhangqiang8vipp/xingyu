import { createPostPreviewToken, listPostPreviewTokens, PreviewTokenError, revokePostPreviewToken } from "@/db/post-preview-tokens";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";

const ALLOWED_LIFETIMES = new Set([24 * 60 * 60, 7 * 24 * 60 * 60, 30 * 24 * 60 * 60]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const postId = Number((await params).id);
  if (!Number.isInteger(postId) || postId < 1) return Response.json({ error: "文章不存在" }, { status: 404 });
  return Response.json({ links: await listPostPreviewTokens(postId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const postId = Number((await params).id);
  const payload = await request.json().catch(() => ({})) as { lifetimeSeconds?: number };
  const lifetimeSeconds = Number(payload.lifetimeSeconds ?? 7 * 24 * 60 * 60);
  if (!ALLOWED_LIFETIMES.has(lifetimeSeconds)) return Response.json({ error: "预览期限不受支持" }, { status: 400 });
  try {
    const created = await createPostPreviewToken(postId, lifetimeSeconds);
    const origin = new URL(request.url).origin;
    return Response.json({ link: created.link, url: `${origin}/preview/${created.token}` }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PreviewTokenError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "预览链接生成失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const postId = Number((await params).id);
  const payload = await request.json().catch(() => ({})) as { previewId?: number };
  const previewId = Number(payload.previewId);
  if (!Number.isInteger(postId) || !Number.isInteger(previewId)) return Response.json({ error: "预览链接不存在" }, { status: 404 });
  const revoked = await revokePostPreviewToken(postId, previewId);
  return revoked ? Response.json({ ok: true }) : Response.json({ error: "预览链接已失效" }, { status: 404 });
}

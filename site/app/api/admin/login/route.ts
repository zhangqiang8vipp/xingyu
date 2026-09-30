import { clearAdminLoginFailures, createLocalAdminSession, getAdminLoginLimit, isPasswordLoginConfigured, recordAdminLoginFailure, verifyLocalAdminPassword } from "@/server/auth/admin-auth";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "请求来源无效" }, { status: 403 });
  if (!isPasswordLoginConfigured()) return Response.json({ error: "后台密码尚未配置" }, { status: 503, headers: { "Cache-Control":"no-store" } });
  const limit = await getAdminLoginLimit(request);
  if (!limit.allowed) return Response.json({ error: "尝试次数过多，请稍后再试" }, { status:429, headers:{ "Cache-Control":"no-store", "Retry-After":String(limit.retryAfter) } });
  const payload = await request.json().catch(() => ({})) as { password?: string };
  if (!(await verifyLocalAdminPassword(String(payload.password ?? "")))) {
    await recordAdminLoginFailure(limit);
    return Response.json({ error: "密码或凭据不正确" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await clearAdminLoginFailures(limit.identifier);
  await createLocalAdminSession();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

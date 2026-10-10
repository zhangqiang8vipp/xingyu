import { identityRateLimit, normalizeEmail, signInWithEmail } from "@/server/auth/identity";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "无效请求来源" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return Response.json({ error: "请求过大" }, { status: 413 });
  const data = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = typeof data.email === "string" ? normalizeEmail(data.email) : null;
  const password = typeof data.password === "string" ? data.password : "";
  if (!email || password.length > 256) return Response.json({ error: "邮箱或密码错误" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const rate = await identityRateLimit(request, email);
  if (!rate.allowed) return Response.json({ error: "尝试次数过多，请稍后再试" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rate.retryAfter) } });
  const user = await signInWithEmail(email, password);
  if (!user) return Response.json({ error: "邮箱或密码错误" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

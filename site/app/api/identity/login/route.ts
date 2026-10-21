import { clearSuccessfulLoginLimits, identityRateLimit, normalizeEmail, signInWithEmail, type LoginPerformance } from "@/server/auth/identity";

const ms = (value: number) => Math.round(value * 10) / 10;
export async function POST(request: Request) {
  const started = performance.now();
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "无效请求来源" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return Response.json({ error: "请求过大" }, { status: 413 });
  const data = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = typeof data.email === "string" ? normalizeEmail(data.email) : null;
  const password = typeof data.password === "string" ? data.password : "";
  if (!email || password.length > 256) return Response.json({ error: "邮箱或密码错误" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const rateStart = performance.now();
  const rate = await identityRateLimit(request, email);
  const rateMs = ms(performance.now() - rateStart);
  if (!rate.allowed) return Response.json({ error: "尝试次数过多，请稍后再试" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rate.retryAfter) } });
  const authStart = performance.now();
  const result: { phases: LoginPerformance | null } = { phases: null };
  const user = await signInWithEmail(email, password, metrics => { result.phases = metrics; });
  const authMs = ms(performance.now() - authStart);
  if (!user) return Response.json({ error: "邮箱或密码错误" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  // The pre-auth reservation is always atomic; only a successful password
  // check forgives it. This prevents repeated legitimate sign-ins locking out
  // an account, without weakening throttling for incorrect passwords.
  const clearStart = performance.now();
  await clearSuccessfulLoginLimits(request, email).catch(error => {
    console.error("identity_login_limit_clear_failed", error instanceof Error ? error.name : "unknown");
  });
  const clearMs = ms(performance.now() - clearStart);
  const totalMs = ms(performance.now() - started);
  const phases = result.phases;
  // No email, IP, user ID, credential or bearer secret is logged or exposed.
  console.log(JSON.stringify({
    event: "identity_login_performance", rateMs, authMs, clearMs, totalMs,
    ...(phases ?? {}),
  }));
  const parts: Array<[string,number]> = [
    ["rate-limit", rateMs],
    ["authentication", authMs],
    ["limit-cleanup", clearMs],
    ["total", totalMs],
    ...(phases ? [
      ["identity-db", phases.identityQueryMs],
      ["password-hash", phases.passwordVerifyMs],
      ["workspace", phases.workspaceMs],
      ["session-db", phases.sessionMs],
    ] as Array<[string, number]> : []),
  ];
  return Response.json({ ok: true }, { headers: {
    "Cache-Control": "no-store",
    "Server-Timing": parts.map(([name, value]) => name + ";dur=" + value.toFixed(1)).join(", "),
  } });
}

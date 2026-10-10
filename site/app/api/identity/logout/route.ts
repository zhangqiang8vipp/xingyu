import { logoutIdentity } from "@/server/auth/identity";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "无效请求来源" }, { status: 403 });
  await logoutIdentity();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

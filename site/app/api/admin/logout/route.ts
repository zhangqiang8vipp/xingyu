import { clearLocalAdminSession } from "@/server/auth/admin-auth";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "请求来源无效" }, { status: 403 });
  await clearLocalAdminSession();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

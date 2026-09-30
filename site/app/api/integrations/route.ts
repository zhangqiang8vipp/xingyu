import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { ensureDatabase } from "@/db/bootstrap";
import { listMcpConnections, revokeMcpConnection } from "@/db/integrations";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  await ensureDatabase();
  return Response.json({ connections: await listMcpConnections() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  await ensureDatabase();
  const payload = await request.json().catch(() => ({})) as { action?: string; clientId?: string; subject?: string };
  if (payload.action !== "revoke" || !payload.clientId) {
    return Response.json({ error: "请指定要撤销的客户端" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await revokeMcpConnection(payload.clientId, payload.subject);
    return Response.json({ ok: true, connections: await listMcpConnections() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "撤销失败" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

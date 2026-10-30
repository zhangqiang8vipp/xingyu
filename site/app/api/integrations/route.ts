import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { ensureDatabase } from "@/db/bootstrap";
import { getBetaActivationSignal } from "@/db/activation";
import { listMcpConnections, revokeMcpConnection, renameMcpConnection, cleanupInactiveMcpConnections } from "@/db/integrations";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  await ensureDatabase();
  const connections = await listMcpConnections();
  const activation = await getBetaActivationSignal(connections);
  return Response.json({ connections, activation }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  await ensureDatabase();
  const payload = await request.json().catch(() => ({})) as { action?: string; clientId?: string; subject?: string };
  if (payload.action !== "revoke" || !payload.clientId) {
    return Response.json({ error: "请指定要撤销的连接" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await revokeMcpConnection(payload.clientId, payload.subject);
    const connections = await listMcpConnections();
    const activation = await getBetaActivationSignal(connections);
    return Response.json({ ok: true, connections, activation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "撤销失败" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

/** Local aliases: one shared client heading or one Xingyu grant nickname. */
export async function PATCH(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({error:"请求来源无效"},{status:403,headers:{"Cache-Control":"no-store"}});
  if(Number(request.headers.get("content-length")??0)>2048)return Response.json({error:"请求过大"},{status:413});
  await ensureDatabase();
  const body=await request.json().catch(()=>({})) as {clientId?:unknown;subject?:unknown;label?:unknown};
  if(typeof body.clientId!=="string"||typeof body.label!=="string"||
    (body.subject!==undefined&&typeof body.subject!=="string"))
    return Response.json({error:"客户端和名称不能为空"},{status:400});
  try{
    await renameMcpConnection(body.clientId,body.subject as string|undefined,body.label);
    return Response.json({ok:true,connections:await listMcpConnections()},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"重命名失败"},
      {status:400,headers:{"Cache-Control":"no-store"}});
  }
}

/** Permanent purge is explicit and ONLY includes revoked grants and unused
 * dynamic registrations. Live consents, credentials and built-in apps survive. */
export async function DELETE(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({error:"请求来源无效"},{status:403,headers:{"Cache-Control":"no-store"}});
  if(Number(request.headers.get("content-length")??0)>2048)return Response.json({error:"请求过大"},{status:413});
  await ensureDatabase();
  const body=await request.json().catch(()=>({})) as {clientId?:unknown;subject?:unknown};
  if((body.clientId!==undefined&&typeof body.clientId!=="string")||
    (body.subject!==undefined&&typeof body.subject!=="string")||
    (body.subject!==undefined&&body.clientId===undefined))
    return Response.json({error:"清理参数无效"},{status:400});
  try{
    const cleaned=await cleanupInactiveMcpConnections(body.clientId as string|undefined,body.subject as string|undefined);
    return Response.json({ok:true,cleaned,connections:await listMcpConnections()},
      {headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"清理失败"},
      {status:400,headers:{"Cache-Control":"no-store"}});
  }
}

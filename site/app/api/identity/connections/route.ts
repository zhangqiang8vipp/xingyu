import { env } from "cloudflare:workers";
import { identityFromRequest, userSubject } from "@/server/auth/identity-session";
import { revokeConsent } from "@/db/oauth";

const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function GET(request:Request){
  const identity=await identityFromRequest(request);
  if(!identity)return Response.json({error:"请先登录"},{status:401,headers});
  const subject=userSubject(identity.userId);
  const rows=await env.DB.prepare(
    "SELECT c.client_id AS clientId,cl.client_name AS clientName,c.resource,c.granted_scopes AS scopes,c.granted_at AS grantedAt "+
    "FROM oauth_consents c JOIN oauth_clients cl ON cl.client_id=c.client_id "+
    "WHERE c.subject=? AND c.revoked_at IS NULL ORDER BY c.granted_at DESC"
  ).bind(subject).all();
  return Response.json({connections:rows.results??[]},{headers});
}
export async function DELETE(request:Request){
  if(request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"无效请求来源"},{status:403,headers});
  const identity=await identityFromRequest(request);
  if(!identity)return Response.json({error:"请先登录"},{status:401,headers});
  if(Number(request.headers.get("content-length")??0)>1024)return Response.json({error:"请求体过大"},{status:413,headers});
  const body=await request.json().catch(()=>({})) as {client_id?:unknown};
  const clientId=typeof body.client_id==="string"?body.client_id:"";
  if(!/^[a-zA-Z0-9._-]{1,120}$/.test(clientId))return Response.json({error:"无效客户端"},{status:400,headers});
  const subject=userSubject(identity.userId);
  const exists=await env.DB.prepare("SELECT id FROM oauth_consents WHERE client_id=? AND subject=? AND revoked_at IS NULL LIMIT 1")
    .bind(clientId,subject).first();
  if(!exists)return Response.json({error:"连接不存在"},{status:404,headers});
  await revokeConsent(clientId,subject);
  return Response.json({ok:true},{headers});
}

import { identityFromRequest } from "@/server/auth/identity-session";
import { createPersonalAccessToken, listPersonalAccessTokens, parsePatLifetime,
  parsePatScopes, revokePersonalAccessToken } from "@/db/personal-access-tokens";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function error(message:string,status:number){return Response.json({error:message},{status,headers});}
function sameOrigin(request:Request){return request.headers.get("origin")===new URL(request.url).origin;}
export async function GET(request:Request){
  const user=await identityFromRequest(request);
  if(!user)return error("请先登录",401);
  const tokens=await listPersonalAccessTokens(user.userId);
  return Response.json({tokens:tokens.map(item=>({...item,scopes:item.scope.split(" ")}))},{headers});
}
export async function POST(request:Request){
  if(!sameOrigin(request))return error("无效请求来源",403);
  const user=await identityFromRequest(request);
  if(!user)return error("请先登录",401);
  if(Number(request.headers.get("content-length")??0)>2048)return error("请求体过大",413);
  const raw=await request.text();
  if(raw.length>2048)return error("请求体过大",413);
  let body:unknown;
  try{body=JSON.parse(raw);}catch{return error("无效请求",400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return error("无效请求",400);
  const data=body as Record<string,unknown>;
  const name=typeof data.name==="string"?data.name.trim():"";
  const scopes=parsePatScopes(data.scopes);
  const lifetime=parsePatLifetime(data.lifetime);
  if(name.length<2||name.length>60||/[\u0000-\u001f\u007f]/.test(name))return error("名称需要 2 至 60 个字符",400);
  if(!scopes||!lifetime)return error("权限或有效期无效",400);
  const created=await createPersonalAccessToken({userId:user.userId,name,scopes,lifetime,origin:new URL(request.url).origin});
  if(!created)return error("最多保留 30 个有效 Token，请先撤销不使用的 Token",409);
  return Response.json({created},{status:201,headers});
}
export async function DELETE(request:Request){
  if(!sameOrigin(request))return error("无效请求来源",403);
  const user=await identityFromRequest(request);
  if(!user)return error("请先登录",401);
  if(Number(request.headers.get("content-length")??0)>1024)return error("请求体过大",413);
  const raw=await request.text();
  if(raw.length>1024)return error("请求体过大",413);
  let body:unknown;
  try{body=JSON.parse(raw);}catch{return error("无效请求",400);}
  const id=body&&typeof body==="object"&&!Array.isArray(body)?(body as {id?:unknown}).id:null;
  if(!Number.isSafeInteger(id)||Number(id)<=0)return error("无效 Token",400);
  const ok=await revokePersonalAccessToken(user.userId,Number(id));
  if(!ok)return error("Token 不存在或已撤销",404);
  return Response.json({ok:true},{headers});
}

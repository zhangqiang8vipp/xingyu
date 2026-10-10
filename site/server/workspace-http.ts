import { env } from "cloudflare:workers";
import { identityFromRequest } from "@/server/auth/identity-session";
import { workspaceGrant, WorkspaceAccessError } from "@/db/workspace-access";
import { WorkspaceContentError } from "@/db/workspace-content";
import { AttachmentError } from "@/db/attachments";

type Context={ userId:number; workspaceId:number; request:Request };
const noStore={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export function apiJson(body:unknown,status=200){return Response.json(body,{status,headers:noStore});}
export async function withWorkspace(request:Request,rawId:string,fn:(ctx:Context)=>Promise<Response>) {
  try {
    if (!["GET","HEAD","OPTIONS"].includes(request.method) && request.headers.get("origin")!==new URL(request.url).origin)
      return apiJson({error:"无效请求来源"},403);
    const user=await identityFromRequest(request);
    if(!user)return apiJson({error:"请先登录"},401);
    const workspaceId=Number(rawId);
    if(!Number.isSafeInteger(workspaceId)||workspaceId<1)return apiJson({error:"工作区不存在"},404);
    await workspaceGrant(user.userId,workspaceId,request.method==="GET"?"read":"write");
    return await fn({userId:user.userId,workspaceId,request});
  } catch(error){
    if(error instanceof WorkspaceContentError||error instanceof WorkspaceAccessError||error instanceof AttachmentError)
      return apiJson({error:error.message},error.status);
    console.error("workspace.api.error",error instanceof Error?error.name:"unknown");
    // Diagnostic details are available in isolated development only, never on the production public API.
    const diagnostic=env.APP_ENV==="development"
      ? {debug:error instanceof Error?error.name+": "+error.message:typeof error}
      : {};
    return apiJson({error:"工作区操作失败",...diagnostic},500);
  }
}
export async function readJson(request:Request,maxBytes=800000) {
  const length=Number(request.headers.get("content-length")??0);
  if(length>maxBytes)throw new WorkspaceContentError("请求体过大");
  return request.json().catch(()=>{throw new WorkspaceContentError("JSON 格式无效");});
}
export function workspacePath(raw:string){const n=Number(raw);return Number.isSafeInteger(n)&&n>0?n:-1;}

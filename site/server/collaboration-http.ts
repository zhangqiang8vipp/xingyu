import { identityFromRequest } from "@/server/auth/identity-session";
import { CollaborationError } from "@/db/workspace-collaboration";
import { WorkspaceAccessError } from "@/db/workspace-access";
import { WorkspaceContentError } from "@/db/workspace-content";
import { apiJson } from "@/server/workspace-http";

/** Used only for accepting/leaving workspaces; never grants access to content. */
export async function withAccountRequest(request:Request,callback:(userId:number)=>Promise<Response>) {
  if(!["GET","HEAD"].includes(request.method)&&request.headers.get("origin")!==new URL(request.url).origin)
    return apiJson({error:"无效请求来源"},403);
  const identity=await identityFromRequest(request);
  if(!identity)return apiJson({error:"请先登录"},401);
  try{return await callback(identity.userId);}
  catch(error){
    if(error instanceof CollaborationError||error instanceof WorkspaceAccessError||error instanceof WorkspaceContentError)
      return apiJson({error:error.message},error.status);
    console.error("collaboration.account.failed",error instanceof Error?error.name:"unknown");
    return apiJson({error:"请求处理失败"},500);
  }
}

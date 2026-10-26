import { identityFromRequest } from "@/server/auth/identity-session";
import { SpaceCollaborationError } from "@/db/space-collaboration";
import { WorkspaceContentError } from "@/db/workspace-content";
import { apiJson } from "@/server/workspace-http";

export async function withSpaceRequest(request:Request,handler:(userId:number)=>Promise<Response>){
  if(!["GET","HEAD"].includes(request.method)&&request.headers.get("origin")!==new URL(request.url).origin)
    return apiJson({error:"无效请求来源"},403);
  const user=await identityFromRequest(request);
  if(!user)return apiJson({error:"请先登录"},401);
  try{return await handler(user.userId);}
  catch(e){
    if(e instanceof SpaceCollaborationError||e instanceof WorkspaceContentError)return apiJson({error:e.message},e.status);
    console.error("space.collaboration.failed",e instanceof Error?e.name:"unknown");
    return apiJson({error:"空间协作操作失败"},500);
  }
}

import { changeMemberRole,removeMember } from "@/db/workspace-collaboration";
import { apiJson,readJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string;userId:string}>};
export async function PATCH(request:Request,{params}:Params) {
  const {id,userId}=await params;
  return withWorkspace(request,id,async({userId:actorId,workspaceId})=>{
    const body=await readJson(request,4096) as {role?:unknown};
    return apiJson({member:await changeMemberRole(actorId,workspaceId,Number(userId),body.role)});
  });
}
export async function DELETE(request:Request,{params}:Params) {
  const {id,userId}=await params;
  return withWorkspace(request,id,async({userId:actorId,workspaceId})=>{
    await removeMember(actorId,workspaceId,Number(userId));
    return apiJson({ok:true});
  });
}

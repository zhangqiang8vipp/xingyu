import { revokeInvitation } from "@/db/workspace-collaboration";
import { apiJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string;inviteId:string}>};
export async function DELETE(request:Request,{params}:Params) {
  const {id,inviteId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    await revokeInvitation(userId,workspaceId,Number(inviteId));
    return apiJson({ok:true});
  });
}

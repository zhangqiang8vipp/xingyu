import {revokeOrganizationInvitation} from "@/db/organization-invitations";
import {withOrganization} from "@/server/organization-http";
import {apiJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string;inviteId:string}>};
export async function DELETE(request:Request,{params}:Params){
  const {id,inviteId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    await revokeOrganizationInvitation(userId,orgId,Number(inviteId));
    return apiJson({ok:true});
  });
}

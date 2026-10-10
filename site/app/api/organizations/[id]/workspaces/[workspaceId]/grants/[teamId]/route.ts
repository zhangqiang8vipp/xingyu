import {revokeWorkspaceTeamGrant} from "@/db/team-workspaces";
import {withOrganization} from "@/server/organization-http";
import {apiJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string;workspaceId:string;teamId:string}>};
export async function DELETE(request:Request,{params}:Params){
  const {id,workspaceId,teamId}=await params;
  return withOrganization(request,id,"read",async({userId,orgId})=>{
    await revokeWorkspaceTeamGrant(userId,orgId,Number(workspaceId),Number(teamId));
    return apiJson({ok:true});
  });
}

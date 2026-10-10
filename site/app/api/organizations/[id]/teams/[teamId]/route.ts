import {updateOrganizationTeam,deleteOrganizationTeam} from "@/db/team-workspaces";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string;teamId:string}>};
export async function PATCH(request:Request,{params}:Params){
  const {id,teamId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {name?:unknown};
    return apiJson({team:await updateOrganizationTeam(userId,orgId,Number(teamId),data.name)});
  });
}
export async function DELETE(request:Request,{params}:Params){
  const {id,teamId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    await deleteOrganizationTeam(userId,orgId,Number(teamId));
    return apiJson({ok:true});
  });
}

import {listWorkspaceTeamGrants,setWorkspaceTeamGrant} from "@/db/team-workspaces";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string;workspaceId:string}>};
export async function GET(request:Request,{params}:Params){
  const {id,workspaceId}=await params;
  return withOrganization(request,id,"read",async({userId,orgId})=>
    apiJson({grants:await listWorkspaceTeamGrants(userId,orgId,Number(workspaceId))}));
}
export async function POST(request:Request,{params}:Params){
  const {id,workspaceId}=await params;
  return withOrganization(request,id,"read",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {teamId?:unknown;role?:unknown};
    return apiJson({grant:await setWorkspaceTeamGrant(userId,orgId,Number(workspaceId),
      typeof data.teamId==="number"?data.teamId:-1,data.role)},201);
  });
}

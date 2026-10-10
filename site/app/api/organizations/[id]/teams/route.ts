import {listOrganizationTeams,createOrganizationTeam} from "@/db/team-workspaces";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"read",async({userId,orgId})=>
    apiJson(await listOrganizationTeams(userId,orgId)));
}
export async function POST(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {name?:unknown};
    return apiJson({team:await createOrganizationTeam(userId,orgId,data.name)},201);
  });
}

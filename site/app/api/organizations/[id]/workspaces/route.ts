import {createOrganizationWorkspace,listOrganizationWorkspaces} from "@/db/team-workspaces";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"read",async({userId,orgId})=>
    apiJson({workspaces:await listOrganizationWorkspaces(userId,orgId)}));
}
export async function POST(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"owner",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {name?:unknown};
    return apiJson({workspace:await createOrganizationWorkspace(userId,orgId,data.name)},201);
  });
}

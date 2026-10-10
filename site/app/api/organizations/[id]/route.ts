import { renameOrganization } from "@/db/organization-access";
import { apiJson,readJson } from "@/server/workspace-http";
import { withOrganization } from "@/server/organization-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"read",async({grant})=>apiJson({organization:grant}));
}
export async function PATCH(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {name?:unknown};
    return apiJson({organization:await renameOrganization(userId,orgId,data.name)});
  });
}

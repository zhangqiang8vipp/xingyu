import { listOrganizationMembers } from "@/db/organization-access";
import { withOrganization } from "@/server/organization-http";
import { apiJson } from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"read",async({userId,orgId})=>
    apiJson({members:await listOrganizationMembers(userId,orgId)}));
}

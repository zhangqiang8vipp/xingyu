import { listMyOrganizations,createOrganization } from "@/db/organization-access";
import { apiJson,readJson } from "@/server/workspace-http";
import { withAccountRequest } from "@/server/collaboration-http";
export async function GET(request:Request){
  return withAccountRequest(request,async userId=>
    apiJson({organizations:await listMyOrganizations(userId)}));
}
export async function POST(request:Request){
  return withAccountRequest(request,async userId=>{
    const data=await readJson(request,4096) as {name?:unknown};
    return apiJson({organization:await createOrganization(userId,data.name)},201);
  });
}

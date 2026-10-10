import {listOrganizationUnits,createOrganizationUnit} from "@/db/organization-units";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"read",async({userId,orgId})=>
    apiJson(await listOrganizationUnits(userId,orgId)));
}
export async function POST(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {name?:unknown;parentId?:unknown;sortOrder?:unknown};
    return apiJson({unit:await createOrganizationUnit(userId,orgId,data)},201);
  });
}

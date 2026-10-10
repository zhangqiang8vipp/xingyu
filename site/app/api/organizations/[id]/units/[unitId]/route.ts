import {updateOrganizationUnit,deleteOrganizationUnit} from "@/db/organization-units";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string;unitId:string}>};
export async function PATCH(request:Request,{params}:Params){
  const {id,unitId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {name?:unknown;parentId?:unknown;sortOrder?:unknown};
    return apiJson({unit:await updateOrganizationUnit(userId,orgId,Number(unitId),data)});
  });
}
export async function DELETE(request:Request,{params}:Params){
  const {id,unitId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    await deleteOrganizationUnit(userId,orgId,Number(unitId));
    return apiJson({ok:true});
  });
}

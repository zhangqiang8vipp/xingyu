import {changeOrganizationRole,removeOrganizationMember} from "@/db/organization-access";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string;userId:string}>};
export async function PATCH(request:Request,{params}:Params){
  const {id,userId}=await params;
  return withOrganization(request,id,"manage",async({userId:actorId,orgId})=>{
    const data=await readJson(request,4096) as {role?:unknown};
    return apiJson({member:await changeOrganizationRole(actorId,orgId,Number(userId),data.role)});
  });
}
export async function DELETE(request:Request,{params}:Params){
  const {id,userId}=await params;
  return withOrganization(request,id,"manage",async({userId:actorId,orgId})=>{
    await removeOrganizationMember(actorId,orgId,Number(userId));
    return apiJson({ok:true});
  });
}

import {addUnitMember,removeUnitMember} from "@/db/organization-units";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string;unitId:string}>};
export async function POST(request:Request,{params}:Params){
  const {id,unitId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {userId?:unknown};
    await addUnitMember(userId,orgId,Number(unitId),typeof data.userId==="number"?data.userId:-1);
    return apiJson({ok:true});
  });
}
export async function DELETE(request:Request,{params}:Params){
  const {id,unitId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {userId?:unknown};
    await removeUnitMember(userId,orgId,Number(unitId),typeof data.userId==="number"?data.userId:-1);
    return apiJson({ok:true});
  });
}

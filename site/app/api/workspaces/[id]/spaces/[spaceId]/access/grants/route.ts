import {setSpacePrincipal,removeSpacePrincipal} from "@/db/space-acl";
import {apiJson,readJson,withWorkspace} from "@/server/workspace-http";
type Params={params:Promise<{id:string;spaceId:string}>};
export async function POST(request:Request,{params}:Params){
  const {id,spaceId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const data=await readJson(request,4096) as {principalType?:unknown;principalId?:unknown;role?:unknown};
    const idValue=typeof data.principalId==="number"?data.principalId:-1;
    return apiJson({access:await setSpacePrincipal(userId,workspaceId,Number(spaceId),data.principalType,idValue,data.role)},201);
  });
}
export async function DELETE(request:Request,{params}:Params){
  const {id,spaceId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const data=await readJson(request,4096) as {principalType?:unknown;principalId?:unknown};
    const idValue=typeof data.principalId==="number"?data.principalId:-1;
    return apiJson({access:await removeSpacePrincipal(userId,workspaceId,Number(spaceId),data.principalType,idValue)});
  });
}

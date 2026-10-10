import {listSpacePolicy,setSpacePolicy} from "@/db/space-acl";
import {apiJson,readJson,withWorkspace} from "@/server/workspace-http";
type Params={params:Promise<{id:string;spaceId:string}>};
export async function GET(request:Request,{params}:Params){
  const {id,spaceId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>
    apiJson({access:await listSpacePolicy(userId,workspaceId,Number(spaceId))}));
}
export async function PUT(request:Request,{params}:Params){
  const {id,spaceId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const data=await readJson(request,4096) as {restricted?:unknown};
    return apiJson({access:await setSpacePolicy(userId,workspaceId,Number(spaceId),data.restricted)});
  });
}

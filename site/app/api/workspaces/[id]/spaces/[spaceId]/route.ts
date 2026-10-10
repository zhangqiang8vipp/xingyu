import { editScopedSpace,removeEmptyScopedSpace } from "@/db/workspace-content";
import { apiJson,readJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string;spaceId:string}>};
export async function PATCH(request:Request,{params}:Params){
  const {id,spaceId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const b=await readJson(request,4096) as {name?:string;parent_id?:number|null;sort_order?:number};
    const space=await editScopedSpace(userId,workspaceId,Number(spaceId),{
      name:b.name,parentId:b.parent_id,sortOrder:b.sort_order,
    });return apiJson({space});
  });
}
export async function DELETE(request:Request,{params}:Params){
  const {id,spaceId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>apiJson({
    result:await removeEmptyScopedSpace(userId,workspaceId,Number(spaceId))
  }));
}

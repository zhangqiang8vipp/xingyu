import { newScopedSpace,scopedSpaces } from "@/db/workspace-content";
import { apiJson,readJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const q=new URL(request.url).searchParams.get("parent_id");
    const parent=q==="all"?undefined:q===null||q==="null"?null:Number(q);
    return apiJson({spaces:await scopedSpaces(userId,workspaceId,parent)});
  });
}
export async function POST(request:Request,{params}:Params){
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const b=await readJson(request,4096) as {name?:string;parent_id?:number|null};
    const space=await newScopedSpace(userId,workspaceId,{name:b.name??"",parentId:b.parent_id});
    return apiJson({space},201);
  });
}

import { scopedStatusChange,WorkspaceContentError } from "@/db/workspace-content";
import { apiJson,readJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string;postId:string}>};
export async function POST(request:Request,{params}:Params){
  const {id,postId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const b=await readJson(request) as {expected_version:number;status:string};
    if(b.status!=="draft"&&b.status!=="published")throw new WorkspaceContentError("状态无效");
    const post=await scopedStatusChange(userId,workspaceId,postId,b.expected_version,b.status,"web:"+userId,"网页修改状态");
    return apiJson({post});
  });
}

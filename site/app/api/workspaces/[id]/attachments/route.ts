import { scopedAttachmentList } from "@/db/workspace-media";
import { apiJson,withWorkspace } from "@/server/workspace-http";
import { handleWorkspaceUpload } from "@/server/workspace-upload";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const postId=new URL(request.url).searchParams.get("post")||"";
    if(!postId)return apiJson({error:"缺少文章标识"},400);
    return apiJson({attachments:await scopedAttachmentList(userId,workspaceId,postId)});
  });
}
export async function POST(request:Request,{params}:Params){
  const {id}=await params;
  return handleWorkspaceUpload(request,id);
}

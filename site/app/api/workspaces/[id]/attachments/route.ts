import { scopedAttachmentList,scopedUploadAttachment } from "@/db/workspace-media";
import { apiJson,withWorkspace } from "@/server/workspace-http";
import { WorkspaceContentError } from "@/db/workspace-content";
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
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    if(Number(request.headers.get("content-length")??0)>12_000_000)return apiJson({error:"附件过大"},413);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))
      return apiJson({error:"请使用 multipart/form-data 上传附件"},415);
    const data=await request.formData().catch(()=>{throw new WorkspaceContentError("附件表单格式无效");});
    const file=data.get("file");
    if(!(file instanceof File))return apiJson({error:"请选择文件"},400);
    if(file.size>8*1024*1024)return apiJson({error:"单文件最大 8 MB"},413);
    const post=data.get("post_identifier");
    const attachment=await scopedUploadAttachment(userId,workspaceId,{
      name:file.name,contentType:file.type,bytes:new Uint8Array(await file.arrayBuffer()),
      postIdentifier:typeof post==="string"&&post.trim()?post.trim():undefined,
    });
    return apiJson({attachment:{
      public_id:attachment.publicId,filename:attachment.originalName,
      content_type:attachment.contentType,size:attachment.size,
      url:"/api/workspaces/"+workspaceId+"/attachments/"+attachment.publicId,
    }},201);
  });
}

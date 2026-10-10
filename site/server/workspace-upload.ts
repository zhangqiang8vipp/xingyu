import { scopedUploadAttachment } from "@/db/workspace-media";
import { WorkspaceContentError } from "@/db/workspace-content";
import { apiJson, withWorkspace } from "@/server/workspace-http";

/**
 * A single upload implementation shared by Next's route and the raw Worker.
 * Vinext treats multipart POSTs as Server Actions before they can reach
 * some App Router handlers. The Worker delegates only this exact upload path,
 * while withWorkspace enforces identity, Origin, and tenant membership.
 */
export async function handleWorkspaceUpload(request:Request, rawWorkspaceId:string):Promise<Response> {
  return withWorkspace(request,rawWorkspaceId,async({userId,workspaceId})=>{
    const len=Number(request.headers.get("content-length")??0);
    if(!Number.isFinite(len)||len>12_000_000)return apiJson({error:"附件过大"},413);
    if(!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))
      return apiJson({error:"请使用 multipart/form-data 上传附件"},415);
    const form=await request.formData().catch(()=>{throw new WorkspaceContentError("附件表单格式无效");});
    const file=form.get("file");
    if(!(file instanceof File))return apiJson({error:"请选择文件"},400);
    if(file.size>8*1024*1024)return apiJson({error:"单文件最大 8 MB"},413);
    const post=form.get("post_identifier");
    const record=await scopedUploadAttachment(userId,workspaceId,{
      name:file.name,
      contentType:file.type,
      bytes:new Uint8Array(await file.arrayBuffer()),
      postIdentifier:typeof post==="string"&&post.trim()?post.trim():undefined,
    });
    return apiJson({attachment:{
      public_id:record.publicId,filename:record.originalName,
      content_type:record.contentType,size:record.size,
      url:"/api/workspaces/"+workspaceId+"/attachments/"+record.publicId,
    }},201);
  });
}

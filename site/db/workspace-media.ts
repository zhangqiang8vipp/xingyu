import { env } from "cloudflare:workers";
import { workspaceGrant } from "@/db/workspace-access";
import { assertSpacePermission } from "@/db/space-acl";
import { createAttachment, getAttachmentObject, validateAttachmentInput, MAX_MCP_ATTACHMENT_BYTES } from "@/db/attachments";
import { scopedPost, WorkspaceContentError } from "@/db/workspace-content";

export async function scopedAttachmentList(userId:number,workspaceId:number,postIdentifier:string) {
  const post=await scopedPost(userId,workspaceId,postIdentifier);
  const list=await env.DB.prepare("SELECT public_id AS publicId,original_name AS originalName,content_type AS contentType,size,sha256,created_at AS createdAt FROM attachments WHERE workspace_id=? AND post_id=? ORDER BY id")
    .bind(workspaceId,post.id).all();
  return list.results??[];
}
export async function scopedUploadAttachment(userId:number,workspaceId:number,input:{
  name:string;contentType:string;bytes:Uint8Array;postIdentifier?:string;summary?:string;clientLabel?:string;
}) {
  const grant=await workspaceGrant(userId,workspaceId,"write");
  const post=input.postIdentifier?await scopedPost(userId,workspaceId,input.postIdentifier):null;
  if(post)await assertSpacePermission(userId,workspaceId,post.spaceId,"write");
  if(!post&&grant.kind==="organization"&&grant.role!=="owner"&&grant.role!=="admin")
    throw new WorkspaceContentError("组织工作区普通成员上传附件时必须关联可编辑的文章",403);
  validateAttachmentInput(input.name,input.contentType,input.bytes.length,MAX_MCP_ATTACHMENT_BYTES);
  return createAttachment({
    workspaceId,actorUserId:userId,name:input.name,contentType:input.contentType,bytes:input.bytes,
    postId:post?.id??null,
    audit:{summary:input.summary??"上传附件",clientLabel:input.clientLabel??"web:"+userId},
  });
}
export async function scopedAttachment(userId:number,workspaceId:number,publicId:string) {
  await workspaceGrant(userId,workspaceId,"read");
  if(!/^att_[a-f0-9]{32}$/i.test(publicId))throw new WorkspaceContentError("附件不存在",404);
  const row=await env.DB.prepare("SELECT public_id AS publicId,object_key AS objectKey,post_id AS postId,original_name AS originalName,content_type AS contentType,size,sha256 FROM attachments WHERE workspace_id=? AND public_id=?")
    .bind(workspaceId,publicId.toLowerCase()).first<{publicId:string;objectKey:string;postId:number|null;originalName:string;contentType:string;size:number;sha256:string}>();
  if(!row)throw new WorkspaceContentError("附件不存在",404);
  if(row.postId!==null){
    const post=await scopedPost(userId,workspaceId,String(row.postId));
    await assertSpacePermission(userId,workspaceId,post.spaceId,"read");
  }else{
    const grant=await workspaceGrant(userId,workspaceId,"read");
    if(grant.kind==="organization"&&grant.role!=="owner"&&grant.role!=="admin")
      throw new WorkspaceContentError("未关联文章的附件仅允许工作区管理员访问",404);
  }
  return row;
}
export async function scopedAttachmentObject(userId:number,workspaceId:number,publicId:string) {
  const row=await scopedAttachment(userId,workspaceId,publicId);
  const object=await getAttachmentObject(row.objectKey);
  if(!object)throw new WorkspaceContentError("附件文件不存在",404);
  return {meta:row,object};
}

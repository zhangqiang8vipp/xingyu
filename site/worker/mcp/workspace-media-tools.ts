import { z } from "zod";
import { scopedPost } from "@/db/workspace-content";
import { scopedUploadAttachment } from "@/db/workspace-media";
import { attachmentMarkdown } from "@/db/attachments";
import { requireScope } from "../mcp-auth";
import { IDENTIFIER_SCHEMA,CHANGE_SUMMARY_SCHEMA,MCP_ERROR_OUTPUT_FIELDS,toolResult,toolFailure,type McpToolContext } from "./shared";
import { WORKSPACE_ID_SCHEMA,attachmentLink } from "./workspace-tool-context";
import { resolveWorkspace } from "@/db/workspace-access";

const obj=z.record(z.string(),z.unknown());
function decodeBase64(raw:string) {
  if(raw.length>12_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))throw new Error("无效的 Base64 附件内容");
  const binary=atob(raw);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
export function registerWorkspaceMediaTools({server,origin,clientLabel,auth}:McpToolContext) {
  server.registerTool("upload_attachment",{
    title:"上传工作区私有附件",
    description:"上传文件至当前工作区私有 R2 路径；单文件最多 8MB，可绑定已有文章。",
    inputSchema:{
      workspace_id:WORKSPACE_ID_SCHEMA,
      filename:z.string().trim().min(1).max(240),
      content_type:z.string().trim().min(1).max(160),
      content_base64:z.string().min(1).max(12_000_000),
      post_identifier:IDENTIFIER_SCHEMA.optional(),
      change_summary:CHANGE_SUMMARY_SCHEMA.optional().default("上传工作区附件"),
    },
    outputSchema:{attachment:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false},
  },async({workspace_id,filename,content_type,content_base64,post_identifier,change_summary})=>{
    try {
      if(!auth.userId)throw new Error("请重新授权");
      const ws=await resolveWorkspace(auth.userId,workspace_id,"write");
      const post=post_identifier?await scopedPost(auth.userId,ws,post_identifier):null;
      requireScope(auth,post?.status==="published"&&post.spaceId===null?"xingyu.publish":"xingyu.draft");
      const record=await scopedUploadAttachment(auth.userId,ws,{
        name:filename,contentType:content_type,bytes:decodeBase64(content_base64),postIdentifier:post_identifier,
        summary:change_summary,clientLabel,
      });
      const link=attachmentLink(ws,record.publicId);
      return toolResult({ok:true,workspace_id:ws,attachment:{
        public_id:record.publicId,filename:record.originalName,content_type:record.contentType,
        size:record.size,sha256:record.sha256,url:origin+link,
        markdown:attachmentMarkdown(record),visibility:"workspace_private",
      },receipt:{action:"upload_attachment",activity_id:record.activity?.id??null,summary:change_summary,
        changed_fields:["attachments"],recorded_at:record.activity?.createdAt??null}});
    } catch(error){return toolFailure(error);}
  });
}

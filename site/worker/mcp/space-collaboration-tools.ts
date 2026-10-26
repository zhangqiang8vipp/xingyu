import { z } from "zod";
import { requireScope } from "@/worker/mcp-auth";
import { MCP_ERROR_OUTPUT_FIELDS,toolResult,toolFailure,type McpToolContext } from "./shared";
import {
 listCollaborativeSpaces,spaceAccess,listCollaborativeChildren,listCollaborativeDocuments,
 listSpaceMembers,listSpaceInvitations,sendSpaceInvitation,revokeSpaceInvitation,
 setSpaceMemberRole,removeSpaceMember,setSpaceInheritance,createCollaborativeChildSpace,
 removeCollaborativeEmptySpace,createCollaborativeDocument,getCollaborativeDocument,
 listDocumentRevisions,getDocumentRevision,listDocumentProposals,getDocumentProposal,proposeDocumentChange,
 resolveDocumentProposal,restoreDocumentRevision,
} from "@/db/space-collaboration";

const id=z.number().int().positive();
const docId=z.string().trim().min(1).max(100);
const role=z.enum(["admin","editor","viewer"]);
const output={result:z.record(z.string(),z.unknown()).optional(),...MCP_ERROR_OUTPUT_FIELDS};
export function registerSpaceCollaborationTools({server,auth,origin,clientLabel}:McpToolContext){
  async function execute(scope:"xingyu.read"|"xingyu.draft",call:(userId:number)=>Promise<unknown>){
    try{
      requireScope(auth,scope);
      if(!auth.userId)throw new Error("需要关联真实星屿账号的 MCP OAuth 或 PAT");
      return toolResult({ok:true,result:await call(auth.userId)});
    }catch(error){return toolFailure(error);}
  }
  const readable={readOnlyHint:true};
  const write={readOnlyHint:false,destructiveHint:false,idempotentHint:false};
  const sensitive={readOnlyHint:false,destructiveHint:true,idempotentHint:false};
  server.registerTool("list_collaboration_spaces",{
    title:"查看我受邀的知识空间",
    description:"仅列出当前账号获得直接空间邀请的知识空间，不继承任何整个组织或其他工作区的访问权限。",
    inputSchema:{},outputSchema:output,annotations:readable,
  },async()=>execute("xingyu.read",userId=>listCollaborativeSpaces(userId)));
  server.registerTool("get_collaboration_space",{
    title:"查询空间协作权限",
    description:"确认某空间的实际权限；不向未获授权的用户泄露空间名称。",
    inputSchema:{space_id:id},outputSchema:output,annotations:readable,
  },async({space_id})=>execute("xingyu.read",userId=>spaceAccess(userId,space_id)));
  server.registerTool("list_collaboration_children",{
    title:"查看可访问的子知识空间",description:"只返回有实际空间权限的子空间。",
    inputSchema:{space_id:id},outputSchema:output,annotations:readable,
  },async({space_id})=>execute("xingyu.read",userId=>listCollaborativeChildren(userId,space_id)));
  server.registerTool("list_collaboration_documents",{
    title:"列出协作文档",description:"根据受邀知识空间权限列出文档。",
    inputSchema:{space_id:id},outputSchema:output,annotations:readable,
  },async({space_id})=>execute("xingyu.read",userId=>listCollaborativeDocuments(userId,space_id)));
  server.registerTool("create_collaboration_child_space",{
    title:"创建协作子空间",description:"需要当前空间编辑权限；新子空间默认继承父空间的协作者权限。",
    inputSchema:{parent_space_id:id,name:z.string().trim().min(1).max(100)},outputSchema:output,annotations:write,
  },async({parent_space_id,name})=>execute("xingyu.draft",userId=>createCollaborativeChildSpace(userId,parent_space_id,name)));
  server.registerTool("delete_collaboration_empty_space",{
    title:"删除空协作子空间",description:"必须经明确确认；仅允许管理者删除完全为空的子空间，不能递归删除文章。",
    inputSchema:{space_id:id},outputSchema:output,annotations:sensitive,
  },async({space_id})=>execute("xingyu.draft",userId=>removeCollaborativeEmptySpace(userId,space_id)));
  server.registerTool("list_space_collaborators",{
    title:"查看空间协作者及邮件邀请",description:"仅空间管理员可查看，邮箱不能被外部成员读取。",
    inputSchema:{space_id:id},outputSchema:output,annotations:readable,
  },async({space_id})=>execute("xingyu.read",async userId=>({
    members:await listSpaceMembers(userId,space_id),invitations:await listSpaceInvitations(userId,space_id),
  })));
  server.registerTool("invite_space_member",{
    title:"通过邮箱邀请空间协作者",
    description:"仅授权一个空间及其未限制继承的子空间，不授予工作区权限。发邮件前必须由用户明确确认邮箱、空间和角色。",
    inputSchema:{space_id:id,email:z.string().trim().email().max(254),role},outputSchema:output,annotations:sensitive,
  },async({space_id,email,role})=>execute("xingyu.draft",userId=>sendSpaceInvitation(userId,space_id,email,role,origin)));
  server.registerTool("revoke_space_invitation",{
    title:"撤销未接受的空间邀请",description:"敏感权限操作，必须得到用户确认。",
    inputSchema:{space_id:id,invitation_id:id},outputSchema:output,annotations:sensitive,
  },async({space_id,invitation_id})=>execute("xingyu.draft",userId=>revokeSpaceInvitation(userId,space_id,invitation_id)));
  server.registerTool("set_space_collaborator_role",{
    title:"修改空间协作者权限",description:"变更空间访问控制，必须得到用户明确确认。",
    inputSchema:{space_id:id,user_id:id,role},outputSchema:output,annotations:sensitive,
  },async({space_id,user_id,role})=>execute("xingyu.draft",userId=>setSpaceMemberRole(userId,space_id,user_id,role)));
  server.registerTool("remove_space_collaborator",{
    title:"移除空间协作者",description:"移除后该用户及其 AI 客户端的该空间邀请权限立即失效；需要用户确认。",
    inputSchema:{space_id:id,user_id:id},outputSchema:output,annotations:sensitive,
  },async({space_id,user_id})=>execute("xingyu.draft",userId=>removeSpaceMember(userId,space_id,user_id)));
  server.registerTool("set_space_inheritance",{
    title:"设置子空间是否继承邀请权限",description:"enabled=false 将禁止从父空间继承访问权限；直接受邀者不受影响。",
    inputSchema:{space_id:id,enabled:z.boolean()},outputSchema:output,annotations:sensitive,
  },async({space_id,enabled})=>execute("xingyu.draft",userId=>setSpaceInheritance(userId,space_id,enabled)));
  server.registerTool("create_collaboration_document",{
    title:"在受邀空间创建协作文档",
    description:"创建私人草稿，不会自动公开发布。需要空间编辑权限。",
    inputSchema:{space_id:id,title:z.string().trim().min(1).max(200),content_markdown:z.string().max(750000).default("")},
    outputSchema:output,annotations:write,
  },async({space_id,title,content_markdown})=>execute("xingyu.draft",userId=>
    createCollaborativeDocument(userId,space_id,title,content_markdown,clientLabel)));
  server.registerTool("get_collaboration_document",{
    title:"读取协作文档与版本",description:"修改前必须先读取完整正文和当前 version，后续提交使用 base_version。",
    inputSchema:{public_id:docId},outputSchema:output,annotations:readable,
  },async({public_id})=>execute("xingyu.read",userId=>getCollaborativeDocument(userId,public_id)));
  server.registerTool("propose_document_change",{
    title:"提交带基础版本的 AI/人工文档改动",
    description:"三方比较已提交版本与提案：独立章节自动合并；重叠修改创建冲突提案，禁止静默覆盖。",
    inputSchema:{public_id:docId,base_version:id,content_markdown:z.string().max(750000),
      change_summary:z.string().trim().min(1).max(300)},outputSchema:output,
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
  },async({public_id,base_version,content_markdown,change_summary})=>execute("xingyu.draft",userId=>
    proposeDocumentChange(userId,public_id,base_version,content_markdown,clientLabel,change_summary)));
  server.registerTool("list_document_revisions",{
    title:"查询文档修改历史",description:"返回不可变版本号、修改者和时间；恢复历史版本须单独确认。",
    inputSchema:{public_id:docId},outputSchema:output,annotations:readable,
  },async({public_id})=>execute("xingyu.read",userId=>listDocumentRevisions(userId,public_id)));
  server.registerTool("get_document_revision",{
    title:"读取文档历史版本",description:"只读取有权限文档的历史正文。",
    inputSchema:{public_id:docId,version:id},outputSchema:output,annotations:readable,
  },async({public_id,version})=>execute("xingyu.read",userId=>getDocumentRevision(userId,public_id,version)));
  server.registerTool("list_document_conflicts",{
    title:"查询尚未解决的文档冲突",description:"列出冲突版本标识；不会代替用户做强制覆盖。",
    inputSchema:{public_id:docId},outputSchema:output,annotations:readable,
  },async({public_id})=>execute("xingyu.read",userId=>listDocumentProposals(userId,public_id)));
  server.registerTool("get_document_conflict",{
    title:"供管理员审阅完整冲突提案",
    description:"仅读取指定空间管理员可见的未解决冲突，包含提案全文。必须与当前文档及基础版本比较后再确认合并。",
    inputSchema:{public_id:docId,proposal_id:z.string().uuid()},outputSchema:output,annotations:readable,
  },async({public_id,proposal_id})=>execute("xingyu.read",userId=>getDocumentProposal(userId,public_id,proposal_id)));

  server.registerTool("resolve_document_conflict",{
    title:"提交已确认的冲突解决方案",
    description:"仅空间管理员可执行，要求当前文档 expected_version 并由用户明确审阅解决后的完整 Markdown。不得自行强制覆盖。",
    inputSchema:{public_id:docId,proposal_id:z.string().uuid(),expected_version:id,
      resolved_markdown:z.string().max(750000)},outputSchema:output,annotations:sensitive,
  },async({public_id,proposal_id,expected_version,resolved_markdown})=>execute("xingyu.draft",userId=>
    resolveDocumentProposal(userId,public_id,proposal_id,expected_version,resolved_markdown,clientLabel)));
  server.registerTool("restore_document_revision",{
    title:"恢复历史文档版本",
    description:"管理员敏感操作，恢复会写入新版本而不擦除原历史；必须明确得到用户确认。",
    inputSchema:{public_id:docId,revision:id,expected_version:id},outputSchema:output,annotations:sensitive,
  },async({public_id,revision,expected_version})=>execute("xingyu.draft",userId=>
    restoreDocumentRevision(userId,public_id,revision,expected_version,clientLabel)));
}

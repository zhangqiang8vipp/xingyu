import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import { workspaceGrant, WorkspaceAccessError } from "@/db/workspace-access";
import { getMailSettings, sendTransactionalEmail, MailDeliveryError } from "@/server/mail-delivery";
import { sessionDigest } from "@/server/auth/identity-session";
import { normalizeEmail } from "@/server/auth/identity";
import { createPostPublicId } from "@/db/public-id";
import { mergeMarkdown } from "@/domain/posts/three-way-merge.mjs";

export type SpaceCollaborationRole="owner"|"admin"|"editor"|"viewer";
export class SpaceCollaborationError extends Error {
  constructor(message:string,readonly status:400|403|404|409|429|503=400){super(message);}
}
type Space = {id:number;workspaceId:number;parentId:number|null;name:string};
type SpaceAccess=Space&{role:SpaceCollaborationRole;canManage:boolean;canWrite:boolean};
type DocumentRow={id:number;workspaceId:number;spaceId:number|null;publicId:string;title:string;content:string;version:number;status:string};
type Invitation={id:number;spaceId:number;workspaceId:number;email:string;role:string;expiresAt:number;invitedBy:number};
const ROLE_LEVEL:{[role:string]:number}={viewer:1,editor:2,admin:3,owner:4};
const VALID_ROLES=new Set(["admin","editor","viewer"]);
const INVITE_TTL=7*24*3600;
const now=()=>Math.floor(Date.now()/1000);
const isId=(value:number)=>Number.isSafeInteger(value)&&value>0;
const ensureId=(value:number)=>{if(!isId(value))throw new SpaceCollaborationError("资源 ID 无效",404);return value;};
const contentLimit=(content:string)=>{
  if(typeof content!=="string"||content.length>750000)throw new SpaceCollaborationError("文档正文长度不能超过 750000 字符");
  return content;
};
const titleLimit=(title:string)=>{
  if(typeof title!=="string"||!title.trim()||title.trim().length>200)throw new SpaceCollaborationError("文档标题长度必须为 1–200 字符");
  return title.trim();
};
const summarize=(text:string)=>typeof text==="string"?text.trim().slice(0,300):"";
const safeClient=(clientLabel:string)=>String(clientLabel||"web").slice(0,160);
const roleOf=(s:string)=>VALID_ROLES.has(s)?s as "admin"|"editor"|"viewer":null;

const LINEAGE_SQL=[
  "WITH RECURSIVE lineage(id,parent_id,workspace_id) AS (",
  "SELECT id,parent_id,workspace_id FROM spaces WHERE id=?",
  "UNION ALL SELECT p.id,p.parent_id,p.workspace_id FROM spaces p JOIN lineage c ON p.id=c.parent_id",
  "WHERE p.workspace_id=c.workspace_id AND COALESCE((SELECT inherit_permissions",
  "FROM space_collaboration_settings settings WHERE settings.space_id=c.id),1)=1",
  ") SELECT m.role FROM lineage l JOIN space_collaboration_members m",
  "ON m.space_id=l.id AND m.workspace_id=l.workspace_id",
  "JOIN users u ON u.id=m.user_id AND u.status='active'",
  "WHERE m.user_id=?"
].join(" ");
const LINEAGE_EXISTS_SQL=[
  "EXISTS(WITH RECURSIVE lineage(id,parent_id,workspace_id) AS (",
  "SELECT id,parent_id,workspace_id FROM spaces WHERE id=?",
  "UNION ALL SELECT p.id,p.parent_id,p.workspace_id FROM spaces p JOIN lineage c ON p.id=c.parent_id",
  "WHERE p.workspace_id=c.workspace_id AND COALESCE((SELECT inherit_permissions FROM space_collaboration_settings",
  "settings WHERE settings.space_id=c.id),1)=1",
  ") SELECT 1 FROM lineage l JOIN space_collaboration_members m ON m.space_id=l.id",
  "AND m.workspace_id=l.workspace_id JOIN users u ON u.id=m.user_id AND u.status='active'",
  "WHERE m.user_id=? AND m.role IN (%ROLES%))"
].join(" ");
function gateSql(action:"write"|"manage"){
  const roles=action==="manage"?"'admin'":"'admin','editor'";
  const original=action==="manage"?"'owner','admin'":"'owner','admin'";
  return "(EXISTS(SELECT 1 FROM workspace_effective_grants g WHERE g.workspace_id=? AND g.user_id=? AND g.role IN ("+original+")) OR "+
    LINEAGE_EXISTS_SQL.replace("%ROLES%",roles)+")";
}
function gateParams(workspaceId:number,userId:number,spaceId:number){return [workspaceId,userId,spaceId,userId];}
async function readSpace(spaceId:number):Promise<Space>{
  await ensureDatabase();ensureId(spaceId);
  const row=await env.DB.prepare("SELECT s.id,s.workspace_id AS workspaceId,s.parent_id AS parentId,s.name FROM spaces s JOIN workspaces w ON w.id=s.workspace_id AND w.status='active' WHERE s.id=?").bind(spaceId).first<Space>();
  if(!row)throw new SpaceCollaborationError("知识空间不存在",404);
  return row;
}
async function effectiveRole(userId:number,space:Space):Promise<SpaceCollaborationRole|null>{
  if(!isId(userId))return null;
  let base:SpaceCollaborationRole|null=null;
  try{
    const role=(await workspaceGrant(userId,space.workspaceId)).role;
    // Space collaborators must not gain the whole workspace. Existing org
    // Editor/Viewer routes retain their own ACL; the collaboration API only
    // grants existing workspace managers or explicitly invited users.
    if(role==="owner"||role==="admin")base=role;
  }catch(e){if(!(e instanceof WorkspaceAccessError))throw e;}
  const result=await env.DB.prepare(LINEAGE_SQL).bind(space.id,userId).all<{role:string}>();
  for(const row of result.results??[]){
    if(ROLE_LEVEL[row.role]>(base?ROLE_LEVEL[base]:0))base=row.role as SpaceCollaborationRole;
  }
  return base;
}
export async function spaceAccess(userId:number,spaceId:number,action:"read"|"write"|"manage"="read"):Promise<SpaceAccess>{
  const space=await readSpace(spaceId);
  const role=await effectiveRole(userId,space);
  if(!role)throw new SpaceCollaborationError("知识空间不存在或未获得邀请",404);
  if(action==="write"&&ROLE_LEVEL[role]<2)throw new SpaceCollaborationError("没有编辑权限",403);
  if(action==="manage"&&ROLE_LEVEL[role]<3)throw new SpaceCollaborationError("没有成员管理权限",403);
  return {...space,role,canManage:ROLE_LEVEL[role]>=3,canWrite:ROLE_LEVEL[role]>=2};
}
export async function listCollaborativeSpaces(userId:number){
  await ensureDatabase();
  // Direct membership grants are the only cross-workspace discovery route.
  const rows=await env.DB.prepare("SELECT DISTINCT s.id,s.name,s.workspace_id AS workspaceId,w.name AS workspaceName FROM space_collaboration_members m JOIN spaces s ON s.id=m.space_id AND s.workspace_id=m.workspace_id JOIN workspaces w ON w.id=s.workspace_id AND w.status='active' WHERE m.user_id=? ORDER BY s.id DESC LIMIT 100")
    .bind(userId).all<{id:number;name:string;workspaceId:number;workspaceName:string}>();
  const result=[];
  for(const row of rows.results??[]){
    const allowed=await spaceAccess(userId,row.id).catch(()=>null);
    if(allowed)result.push({...row,role:allowed.role});
  }
  return result;
}
export async function listSpaceMembers(userId:number,spaceId:number){
  await spaceAccess(userId,spaceId,"manage");
  const rows=await env.DB.prepare("SELECT m.user_id AS userId,u.display_name AS name,m.role,m.created_at AS joinedAt,(SELECT i.subject FROM user_identities i WHERE i.user_id=m.user_id AND i.provider='email' ORDER BY i.id LIMIT 1) AS email FROM space_collaboration_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY m.created_at,m.user_id")
    .bind(spaceId).all();
  return rows.results??[];
}
export async function listSpaceInvitations(userId:number,spaceId:number){
  await spaceAccess(userId,spaceId,"manage");
  const rows=await env.DB.prepare("SELECT id,email,role,expires_at AS expiresAt,created_at AS createdAt FROM space_collaboration_invites WHERE space_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY id DESC LIMIT 100")
    .bind(spaceId,now()).all();
  return rows.results??[];
}
export async function setSpaceInheritance(userId:number,spaceId:number,enabled:boolean){
  const access=await spaceAccess(userId,spaceId,"manage");
  if(typeof enabled!=="boolean")throw new SpaceCollaborationError("继承设置无效");
  const gate=gateSql("manage");
  const result=await env.DB.prepare("INSERT INTO space_collaboration_settings(space_id,workspace_id,inherit_permissions) SELECT ?,?,? WHERE "+gate+
    " ON CONFLICT(space_id) DO UPDATE SET inherit_permissions=excluded.inherit_permissions RETURNING space_id")
    .bind(spaceId,access.workspaceId,enabled?1:0,...gateParams(access.workspaceId,userId,spaceId)).first();
  if(!result)throw new SpaceCollaborationError("管理权限已经变化",403);
  return {spaceId,inheritPermissions:enabled};
}
export async function readSpaceInheritance(userId:number,spaceId:number){
  await spaceAccess(userId,spaceId,"manage");
  const row=await env.DB.prepare("SELECT inherit_permissions AS value FROM space_collaboration_settings WHERE space_id=?")
    .bind(spaceId).first<{value:number}>();
  return {spaceId,inheritPermissions:row?.value!==0};
}
export async function sendSpaceInvitation(userId:number,spaceId:number,emailInput:string,roleInput:string,origin:string){
  const access=await spaceAccess(userId,spaceId,"manage");
  const role=roleOf(roleInput);
  if(!role)throw new SpaceCollaborationError("邀请角色必须为 admin/editor/viewer");
  if(role==="admin"&&access.role!=="owner")throw new SpaceCollaborationError("只有工作区所有者可以邀请空间管理员",403);
  const email=normalizeEmail(emailInput);
  if(!email)throw new SpaceCollaborationError("邮箱格式无效");
  let mail:ReturnType<typeof getMailSettings>;
  try{mail=getMailSettings();}catch(e){if(e instanceof MailDeliveryError)throw new SpaceCollaborationError(e.message,503);throw e;}
  if(mail.base.origin!==origin)throw new SpaceCollaborationError("邮件发信域名不匹配",503);
  const user=await env.DB.prepare("SELECT m.user_id FROM space_collaboration_members m JOIN user_identities i ON i.user_id=m.user_id AND i.provider='email' WHERE m.space_id=? AND i.subject=? LIMIT 1")
    .bind(spaceId,email).first();
  if(user)throw new SpaceCollaborationError("该邮箱已经是此空间的协作者",409);
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM space_collaboration_invites WHERE space_id=? AND created_at>datetime('now','-1 day')")
    .bind(spaceId).first<{n:number}>();
  if((count?.n??0)>=50)throw new SpaceCollaborationError("该空间今日邀请次数已达上限",429);
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token=btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
  const hash=await sessionDigest(token);
  const expiry=now()+INVITE_TTL,stamp=now();
  const gate=gateSql("manage");
  const res=await env.DB.batch([
    env.DB.prepare("UPDATE space_collaboration_invites SET revoked_at=? WHERE space_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL")
      .bind(stamp,spaceId,email),
    env.DB.prepare("INSERT INTO space_collaboration_invites(space_id,workspace_id,email,role,token_hash,invited_by,expires_at) SELECT ?,?,?,?,?,?,? WHERE "+gate+" RETURNING id")
      .bind(spaceId,access.workspaceId,email,role,hash,userId,expiry,...gateParams(access.workspaceId,userId,spaceId)),
  ]);
  const id=(res[1]?.results?.[0] as {id?:number}|undefined)?.id;
  if(!id)throw new SpaceCollaborationError("邀请权限已改变",403);
  const url=new URL("/space-invite",mail.base);url.searchParams.set("token",token);
  try{
    await sendTransactionalEmail(mail,{to:email,subject:"星屿知识空间邀请："+access.name,
      text:"你受邀协作星屿知识空间「"+access.name+"」。\n角色："+role+
      "\n请用此邮箱注册或登录，再在 7 天内接受邀请：\n"+url.toString()+
      "\n此邀请只授权对应知识空间，不会授权整个工作区。"});
  }catch(e){
    await env.DB.prepare("UPDATE space_collaboration_invites SET revoked_at=? WHERE id=? AND accepted_at IS NULL").bind(now(),id).run();
    if(e instanceof MailDeliveryError)throw new SpaceCollaborationError("邀请邮件发送失败",503);
    throw e;
  }
  return {id,spaceId,email,role,expiresAt:expiry};
}
export async function previewSpaceInvitation(userId:number,token:string){
  await ensureDatabase();
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))throw new SpaceCollaborationError("邀请链接无效",404);
  const hash=await sessionDigest(token);
  const row=await env.DB.prepare("SELECT i.id,i.space_id AS spaceId,s.name AS spaceName,i.email,i.role,i.expires_at AS expiresAt,i.invited_by AS invitedBy,i.workspace_id AS workspaceId FROM space_collaboration_invites i JOIN spaces s ON s.id=i.space_id AND s.workspace_id=i.workspace_id JOIN users u ON u.id=? AND u.status='active' JOIN user_identities identity ON identity.user_id=u.id AND identity.provider='email' AND identity.subject=i.email WHERE i.token_hash=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? LIMIT 1")
    .bind(userId,hash,now()).first<Invitation&{spaceName:string}>();
  if(!row)throw new SpaceCollaborationError("邀请已过期，或登录邮箱与受邀邮箱不符",404);
  const actor=await spaceAccess(row.invitedBy,row.spaceId,"manage").catch(()=>null);
  if(!actor)throw new SpaceCollaborationError("发起者的邀请权限已失效",404);
  if(row.role==="admin"&&actor.role!=="owner")throw new SpaceCollaborationError("管理员邀请已失效",404);
  return row;
}
export async function acceptSpaceInvitation(userId:number,token:string){
  const invited=await previewSpaceInvitation(userId,token);
  const stamp=now(),hash=await sessionDigest(token);
  const res=await env.DB.batch([
    env.DB.prepare("UPDATE space_collaboration_invites SET accepted_at=?,accepted_by=? WHERE id=? AND token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM user_identities e JOIN users u ON u.id=e.user_id WHERE e.user_id=? AND e.provider='email' AND e.subject=space_collaboration_invites.email AND u.status='active') RETURNING id")
      .bind(stamp,userId,invited.id,hash,stamp,userId),
    env.DB.prepare("INSERT INTO space_collaboration_members(space_id,workspace_id,user_id,role,invited_by) SELECT space_id,workspace_id,?,role,invited_by FROM space_collaboration_invites WHERE id=? AND accepted_at=? AND accepted_by=? AND changes()=1 ON CONFLICT(space_id,user_id) DO UPDATE SET role=excluded.role RETURNING user_id")
      .bind(userId,invited.id,stamp,userId),
  ]);
  if(!res[0]?.results?.length||!res[1]?.results?.length)throw new SpaceCollaborationError("邀请已使用或权限已发生变化",409);
  return {spaceId:invited.spaceId,spaceName:invited.spaceName,role:invited.role};
}
export async function revokeSpaceInvitation(userId:number,spaceId:number,invitationId:number){
  const access=await spaceAccess(userId,spaceId,"manage");ensureId(invitationId);
  const result=await env.DB.prepare("UPDATE space_collaboration_invites SET revoked_at=? WHERE id=? AND space_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND "+gateSql("manage")+" RETURNING id")
    .bind(now(),invitationId,spaceId,...gateParams(access.workspaceId,userId,spaceId)).first();
  if(!result)throw new SpaceCollaborationError("邀请不存在或没有撤销权限",404);
  return {revoked:true};
}
export async function setSpaceMemberRole(userId:number,spaceId:number,targetId:number,roleInput:string){
  const access=await spaceAccess(userId,spaceId,"manage");ensureId(targetId);
  const role=roleOf(roleInput);if(!role)throw new SpaceCollaborationError("成员角色无效");
  if(role==="admin"&&access.role!=="owner")throw new SpaceCollaborationError("只有工作区所有者可以指定管理员",403);
  const current=await env.DB.prepare("SELECT role FROM space_collaboration_members WHERE space_id=? AND user_id=?")
    .bind(spaceId,targetId).first<{role:string}>();
  if(!current)throw new SpaceCollaborationError("协作者不存在",404);
  if(current.role==="admin"&&access.role!=="owner")throw new SpaceCollaborationError("无法变更另一位管理员",403);
  const row=await env.DB.prepare("UPDATE space_collaboration_members SET role=? WHERE space_id=? AND user_id=? AND role=? AND "+gateSql("manage")+" RETURNING user_id")
    .bind(role,spaceId,targetId,current.role,...gateParams(access.workspaceId,userId,spaceId)).first();
  if(!row)throw new SpaceCollaborationError("权限已改变",409);
  return {userId:targetId,role};
}
export async function removeSpaceMember(userId:number,spaceId:number,targetId:number){
  const access=await spaceAccess(userId,spaceId,"manage");ensureId(targetId);
  const current=await env.DB.prepare("SELECT role FROM space_collaboration_members WHERE space_id=? AND user_id=?")
    .bind(spaceId,targetId).first<{role:string}>();
  if(!current)throw new SpaceCollaborationError("协作者不存在",404);
  if(current.role==="admin"&&access.role!=="owner")throw new SpaceCollaborationError("管理员只能由工作区所有者移除",403);
  const deleted=await env.DB.prepare("DELETE FROM space_collaboration_members WHERE space_id=? AND user_id=? AND "+gateSql("manage")+" RETURNING user_id")
    .bind(spaceId,targetId,...gateParams(access.workspaceId,userId,spaceId)).first();
  if(!deleted)throw new SpaceCollaborationError("没有移除权限",403);
  return {removed:true,userId:targetId};
}
export async function createCollaborativeChildSpace(userId:number,parentSpaceId:number,nameInput:string){
  const parent=await spaceAccess(userId,parentSpaceId,"write");
  const name=typeof nameInput==="string"?nameInput.trim():"";
  if(!name||name.length>100)throw new SpaceCollaborationError("子空间名称无效");
  const slug="collab-"+crypto.randomUUID();
  const result=await env.DB.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) SELECT ?,?,?,? WHERE "+gateSql("write")+" RETURNING id")
    .bind(parent.workspaceId,parentSpaceId,name,slug,...gateParams(parent.workspaceId,userId,parentSpaceId)).first<{id:number}>();
  if(!result)throw new SpaceCollaborationError("空间写入权限已改变",403);
  return {id:result.id,name,parentId:parentSpaceId,workspaceId:parent.workspaceId};
}
export async function listCollaborativeChildren(userId:number,parentSpaceId:number){
  await spaceAccess(userId,parentSpaceId);
  const rows=await env.DB.prepare("SELECT id,name,parent_id AS parentId FROM spaces WHERE parent_id=? ORDER BY sort_order,id LIMIT 200")
    .bind(parentSpaceId).all<{id:number;name:string;parentId:number}>();
  const result=[];
  for(const row of rows.results??[]){if(await spaceAccess(userId,row.id).catch(()=>null))result.push(row);}
  return result;
}
export async function removeCollaborativeEmptySpace(userId:number,spaceId:number){
  const access=await spaceAccess(userId,spaceId,"manage");
  if(access.parentId===null)throw new SpaceCollaborationError("根空间不可从协作入口删除",403);
  const result=await env.DB.prepare("DELETE FROM spaces WHERE id=? AND workspace_id=? AND NOT EXISTS(SELECT 1 FROM spaces s WHERE s.parent_id=?) AND NOT EXISTS(SELECT 1 FROM posts p WHERE p.space_id=?) AND "+gateSql("manage")+" RETURNING id")
    .bind(spaceId,access.workspaceId,spaceId,spaceId,...gateParams(access.workspaceId,userId,spaceId)).first();
  if(!result)throw new SpaceCollaborationError("只能删除没有子空间或文章的空间",409);
  return {deleted:true};
}
export async function listCollaborativeDocuments(userId:number,spaceId:number){
  const space=await spaceAccess(userId,spaceId);
  const rows=await env.DB.prepare("SELECT public_id AS publicId,title,version,status,updated_at AS updatedAt FROM posts WHERE workspace_id=? AND space_id=? ORDER BY updated_at DESC,id DESC LIMIT 100")
    .bind(space.workspaceId,spaceId).all();
  return rows.results??[];
}
export async function createCollaborativeDocument(userId:number,spaceId:number,titleInput:string,contentInput:string,clientLabel:string){
  const space=await spaceAccess(userId,spaceId,"write");
  const title=titleLimit(titleInput),content=contentLimit(contentInput);
  const category=await env.DB.prepare("SELECT id FROM categories WHERE workspace_id=? ORDER BY id LIMIT 1").bind(space.workspaceId).first<{id:number}>();
  if(!category)throw new SpaceCollaborationError("该工作区还没有分类");
  const publicId=createPostPublicId();
  const slug="collab-"+crypto.randomUUID();
  const gate=gateSql("write");
  const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO posts(workspace_id,public_id,title,slug,content,excerpt,category_id,space_id,status,author_id,created_by,updated_by) SELECT ?,?,?,?,?,?,?,?,'draft',?,?,? WHERE "+gate+" RETURNING id")
      .bind(space.workspaceId,publicId,title,slug,content,"",category.id,spaceId,userId,userId,userId,...gateParams(space.workspaceId,userId,spaceId)),
    env.DB.prepare("INSERT INTO mcp_activity(workspace_id,action,post_id,public_id,title,changed_fields,summary,client_label) SELECT workspace_id,'create_draft',id,public_id,title,'[\"content\"]','创建协作文档',? FROM posts WHERE public_id=? AND changes()=1")
      .bind(safeClient(clientLabel),publicId),
  ]);
  if(!result[0]?.results?.length)throw new SpaceCollaborationError("没有创建文档的权限",403);
  return getCollaborativeDocument(userId,publicId);
}
async function rawDocument(identifier:string):Promise<DocumentRow>{
  await ensureDatabase();
  const row=await env.DB.prepare("SELECT id,workspace_id AS workspaceId,space_id AS spaceId,public_id AS publicId,title,content,version,status FROM posts WHERE public_id=? LIMIT 1")
    .bind(identifier).first<DocumentRow>();
  if(!row||row.spaceId===null)throw new SpaceCollaborationError("文档不存在",404);
  return row;
}
export async function getCollaborativeDocument(userId:number,identifier:string){
  const post=await rawDocument(identifier);
  const access=await spaceAccess(userId,post.spaceId!);
  return {...post,spaceName:access.name,canManage:access.canManage,canWrite:access.canWrite};
}
export async function listDocumentRevisions(userId:number,identifier:string,limit=30){
  const post=await rawDocument(identifier);await spaceAccess(userId,post.spaceId!);
  const num=Math.max(1,Math.min(100,Number.isInteger(limit)?limit:30));
  const rows=await env.DB.prepare("SELECT version,title,actor_user_id AS actorUserId,created_at AS createdAt,length(content) AS contentLength FROM document_revisions WHERE post_id=? AND workspace_id=? ORDER BY version DESC LIMIT ?")
    .bind(post.id,post.workspaceId,num).all();
  return rows.results??[];
}
export async function getDocumentRevision(userId:number,identifier:string,version:number){
  const post=await rawDocument(identifier);await spaceAccess(userId,post.spaceId!);ensureId(version);
  const rev=await env.DB.prepare("SELECT version,title,content,actor_user_id AS actorUserId,created_at AS createdAt FROM document_revisions WHERE post_id=? AND workspace_id=? AND version=?")
    .bind(post.id,post.workspaceId,version).first();
  if(!rev)throw new SpaceCollaborationError("历史版本不存在",404);
  return rev;
}
export async function listDocumentProposals(userId:number,identifier:string){
  const post=await rawDocument(identifier);await spaceAccess(userId,post.spaceId!);
  const rows=await env.DB.prepare("SELECT id,base_version AS baseVersion,head_version AS headVersion,actor_user_id AS actorUserId,client_label AS clientLabel,created_at AS createdAt FROM document_merge_proposals WHERE post_id=? AND status='pending' ORDER BY created_at DESC LIMIT 30")
    .bind(post.id).all();
  return rows.results??[];
}
export async function proposeDocumentChange(userId:number,identifier:string,baseVersion:number,proposedContent:string,clientLabel:string,summaryInput="更新协作文档"){
  ensureId(baseVersion);const content=contentLimit(proposedContent);
  const post=await rawDocument(identifier),access=await spaceAccess(userId,post.spaceId!,"write");
  if(baseVersion>post.version)throw new SpaceCollaborationError("提交版本不可能晚于当前版本",409);
  const base=await env.DB.prepare("SELECT content FROM document_revisions WHERE post_id=? AND workspace_id=? AND version=?")
    .bind(post.id,post.workspaceId,baseVersion).first<{content:string}>();
  if(!base)throw new SpaceCollaborationError("基础版本快照不存在，请刷新文档",409);
  const merged=mergeMarkdown(base.content,post.content,content);
  if(merged.status==="conflict"){
    const id=crypto.randomUUID();
    const gate=gateSql("write");
    const result=await env.DB.prepare("INSERT INTO document_merge_proposals(id,post_id,workspace_id,space_id,base_version,head_version,proposed_content,actor_user_id,client_label) SELECT ?,?,?,?,?,?,?,?,? WHERE "+gate+" RETURNING id")
      .bind(id,post.id,post.workspaceId,post.spaceId,baseVersion,post.version,content,userId,safeClient(clientLabel),...gateParams(post.workspaceId,userId,post.spaceId!)).first();
    if(!result)throw new SpaceCollaborationError("写入权限已失效",403);
    return {status:"conflict" as const,proposalId:id,baseVersion,currentVersion:post.version,reason:merged.reason,conflicts:merged.conflicts??[]};
  }
  if(merged.content===post.content)return {status:"unchanged" as const,version:post.version};
  const gate=gateSql("write"),summary=summarize(summaryInput)||"更新协作文档";
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE posts SET content=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND space_id=? AND version=? AND "+gate+" RETURNING version")
      .bind(merged.content,userId,post.id,post.workspaceId,post.spaceId,post.version,...gateParams(post.workspaceId,userId,post.spaceId!)),
    env.DB.prepare("INSERT INTO mcp_activity(workspace_id,action,post_id,public_id,title,changed_fields,summary,client_label) SELECT workspace_id,'update_post',id,public_id,title,'[\"content\"]',?,? FROM posts WHERE id=? AND workspace_id=? AND version=? AND changes()=1")
      .bind(summary,safeClient(clientLabel),post.id,post.workspaceId,post.version+1),
  ]);
  const saved=(result[0]?.results?.[0] as {version?:number}|undefined)?.version;
  if(!saved)throw new SpaceCollaborationError("文档刚刚发生并发更新，请重新读取后提交",409);
  return {status:"merged" as const,version:saved,autoMerged:baseVersion!==post.version,content:merged.content};
}
export async function resolveDocumentProposal(userId:number,identifier:string,proposalId:string,expectedVersion:number,resolvedContent:string,clientLabel:string){
  const post=await rawDocument(identifier);
  const access=await spaceAccess(userId,post.spaceId!,"manage");
  ensureId(expectedVersion);contentLimit(resolvedContent);
  const proposal=await env.DB.prepare("SELECT id FROM document_merge_proposals WHERE id=? AND post_id=? AND workspace_id=? AND space_id=? AND status='pending'")
    .bind(proposalId,post.id,post.workspaceId,post.spaceId).first();
  if(!proposal)throw new SpaceCollaborationError("待处理冲突不存在",404);
  if(expectedVersion!==post.version)throw new SpaceCollaborationError("解决冲突前文档已有更新，请重新审阅",409);
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE posts SET content=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND space_id=? AND version=? AND "+gateSql("manage")+" RETURNING version")
      .bind(resolvedContent,userId,post.id,post.workspaceId,post.spaceId,expectedVersion,...gateParams(post.workspaceId,userId,post.spaceId!)),
    env.DB.prepare("UPDATE document_merge_proposals SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE id=? AND post_id=? AND status='pending' AND changes()=1 RETURNING id")
      .bind(proposalId,post.id),
    env.DB.prepare("INSERT INTO mcp_activity(workspace_id,action,post_id,public_id,title,changed_fields,summary,client_label) SELECT workspace_id,'update_post',id,public_id,title,'[\"content\"]',?,? FROM posts WHERE id=? AND workspace_id=? AND version=? AND changes()=1")
      .bind("人工确认合并冲突 "+proposalId,safeClient(clientLabel),post.id,post.workspaceId,post.version+1),
  ]);
  if(!result[0]?.results?.length||!result[1]?.results?.length)throw new SpaceCollaborationError("冲突或文档版本已经改变",409);
  return {status:"resolved" as const,version:(result[0].results[0] as {version:number}).version,proposalId};
}
export async function restoreDocumentRevision(userId:number,identifier:string,revision:number,expectedVersion:number,clientLabel:string){
  const post=await rawDocument(identifier),access=await spaceAccess(userId,post.spaceId!,"manage");
  ensureId(revision);ensureId(expectedVersion);
  if(post.version!==expectedVersion)throw new SpaceCollaborationError("文档已更新，请重新检查后恢复",409);
  const previous=await env.DB.prepare("SELECT content FROM document_revisions WHERE post_id=? AND workspace_id=? AND version=?")
    .bind(post.id,post.workspaceId,revision).first<{content:string}>();
  if(!previous)throw new SpaceCollaborationError("版本不存在",404);
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE posts SET content=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND space_id=? AND version=? AND "+gateSql("manage")+" RETURNING version")
      .bind(previous.content,userId,post.id,post.workspaceId,post.spaceId,expectedVersion,...gateParams(post.workspaceId,userId,post.spaceId!)),
    env.DB.prepare("INSERT INTO mcp_activity(workspace_id,action,post_id,public_id,title,changed_fields,summary,client_label) SELECT workspace_id,'update_post',id,public_id,title,'[\"content\"]',?,? FROM posts WHERE id=? AND workspace_id=? AND version=? AND changes()=1")
      .bind("恢复历史版本 "+revision,safeClient(clientLabel),post.id,post.workspaceId,post.version+1)
  ]);
  if(!result[0]?.results?.length)throw new SpaceCollaborationError("文档写入冲突",409);
  return {status:"restored" as const,version:(result[0].results[0] as {version:number}).version};
}

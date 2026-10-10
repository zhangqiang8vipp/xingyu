import { env } from "cloudflare:workers";
import { bytesToBase64Url } from "@/db/admin-session";
import { ensureDatabase } from "@/db/bootstrap";
import { normalizeEmail } from "@/server/auth/identity";
import { sessionDigest } from "@/server/auth/identity-session";
import { getMailSettings, sendTransactionalEmail, MailDeliveryError } from "@/server/mail-delivery";
import { workspaceGrant, type WorkspaceRole } from "@/db/workspace-access";

export type InviteRole="admin"|"editor"|"viewer";
export type WorkspaceMember={userId:number;name:string;email:string|null;role:WorkspaceRole;joinedAt:string};
export class CollaborationError extends Error {
  constructor(message:string,readonly status:400|403|404|409|429|503=400){super(message);}
}
const INVITE_SECONDS=7*24*60*60;
const now=()=>Math.floor(Date.now()/1000);
const validId=(n:number)=>Number.isSafeInteger(n)&&n>0;
const validRole=(v:unknown):v is InviteRole=>v==="admin"||v==="editor"||v==="viewer";
const cleanWorkspaceName=(s:string)=>{
  const name=s.trim();
  if(!name||name.length>80||/[\u0000-\u001f]/.test(name))throw new CollaborationError("工作区名称应为 1–80 个字符");
  return name;
};
function emailAddress(raw:string){
  const email=normalizeEmail(raw);
  if(!email)throw new CollaborationError("邮箱格式无效");
  return email;
}
async function sharedManager(userId:number,workspaceId:number) {
  const grant=await workspaceGrant(userId,workspaceId,"manage");
  if(grant.kind!=="shared")throw new CollaborationError("个人工作区不可邀请成员，请创建共享工作区",403);
  return grant;
}

export async function createSharedWorkspace(userId:number,nameInput:string) {
  await ensureDatabase();
  if(!validId(userId))throw new CollaborationError("请先登录",403);
  const name=cleanWorkspaceName(nameInput);
  const current=await env.DB.prepare("SELECT COUNT(*) AS count FROM workspaces WHERE owner_user_id=? AND kind='shared' AND status='active'")
    .bind(userId).first<{count:number}>();
  if((current?.count??0)>=20)throw new CollaborationError("每个账号最多创建 20 个共享工作区",429);
  const slug="shared-"+crypto.randomUUID();
  const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO workspaces(kind,owner_user_id,slug,name,status) SELECT 'shared',id,?,?,'active' FROM users WHERE id=? AND status='active' RETURNING id")
      .bind(slug,name,userId),
    env.DB.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,status) SELECT id,?,'owner','active' FROM workspaces WHERE slug=? AND owner_user_id=?")
      .bind(userId,slug,userId),
    env.DB.prepare("INSERT INTO categories(workspace_id,name,slug,color) SELECT id,'协作笔记',?,'#4f728d' FROM workspaces WHERE slug=? AND owner_user_id=?")
      .bind(slug+"-notes",slug,userId),
    env.DB.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) SELECT id,NULL,'协作知识库',? FROM workspaces WHERE slug=? AND owner_user_id=?")
      .bind(slug+"-root",slug,userId),
  ]);
  const id=(result[0]?.results?.[0] as {id?:number}|undefined)?.id;
  if(!id)throw new CollaborationError("共享工作区创建失败",503);
  return workspaceGrant(userId,id,"manage");
}

export async function listSharedMembers(userId:number,workspaceId:number):Promise<WorkspaceMember[]> {
  await workspaceGrant(userId,workspaceId,"read");
  const rows=await env.DB.prepare(
    "SELECT m.user_id AS userId,u.display_name AS name,m.role,m.created_at AS joinedAt,"+
    "(SELECT i.subject FROM user_identities i WHERE i.user_id=u.id AND i.provider='email' ORDER BY i.id LIMIT 1) AS email "+
    "FROM workspace_memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id "+
    "WHERE m.workspace_id=? AND m.status='active' AND u.status='active' "+
    "AND (w.kind<>'personal' OR m.user_id=w.owner_user_id) ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, m.user_id",
  ).bind(workspaceId).all<WorkspaceMember>();
  return rows.results??[];
}

export async function listPendingInvites(userId:number,workspaceId:number) {
  await sharedManager(userId,workspaceId);
  const result=await env.DB.prepare(
    "SELECT id,email,role,invited_by AS invitedBy,expires_at AS expiresAt,created_at AS createdAt "+
    "FROM workspace_invitations WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? "+
    "ORDER BY created_at DESC,id DESC LIMIT 100",
  ).bind(workspaceId,now()).all();
  return result.results??[];
}

export async function inviteToWorkspace(actorId:number,workspaceId:number,emailInput:string,roleInput:unknown,origin:string) {
  const grant=await sharedManager(actorId,workspaceId);
  if(!validRole(roleInput))throw new CollaborationError("邀请角色无效");
  if(roleInput==="admin"&&grant.role!=="owner")throw new CollaborationError("只有所有者可以邀请管理员",403);
  const email=emailAddress(emailInput);
  let mail:ReturnType<typeof getMailSettings>;
  try{mail=getMailSettings();}catch(error){
    if(error instanceof MailDeliveryError)throw new CollaborationError(error.message,503);
    throw error;
  }
  if(mail.base.origin!==origin)throw new CollaborationError("发信域名与当前站点不一致",503);
  const current=await env.DB.prepare(
    "SELECT 1 FROM workspace_memberships m JOIN user_identities i ON i.user_id=m.user_id "+
    "JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.status='active' "+
    "AND i.provider='email' AND i.subject=? AND u.status='active' LIMIT 1"
  ).bind(workspaceId,email).first();
  if(current)throw new CollaborationError("此用户已是工作区成员",409);
  const recent=await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM workspace_invitations WHERE workspace_id=? "+
    "AND created_at>datetime('now','-1 day')",
  ).bind(workspaceId).first<{count:number}>();
  if((recent?.count??0)>=50)throw new CollaborationError("当天邀请次数已达上限",429);
  const raw=bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const hash=await sessionDigest(raw);
  const timestamp=now(),expiry=timestamp+INVITE_SECONDS;
  const authSql="EXISTS(SELECT 1 FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id "+
    "WHERE m.workspace_id=? AND m.user_id=? AND m.status='active' AND w.status='active' "+
    "AND w.kind='shared' AND (m.role='owner' OR (m.role='admin' AND ?<>'admin')))";
  const results=await env.DB.batch([
    env.DB.prepare("UPDATE workspace_invitations SET revoked_at=? WHERE workspace_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL AND "+authSql)
      .bind(timestamp,workspaceId,email,workspaceId,actorId,roleInput),
    env.DB.prepare("INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by,expires_at) "+
      "SELECT w.id,?,?,?,?,? FROM workspaces w WHERE w.id=? AND w.kind='shared' AND w.status='active' AND "+authSql+" RETURNING id")
      .bind(email,roleInput,hash,actorId,expiry,workspaceId,workspaceId,actorId,roleInput),
  ]);
  const inviteId=(results[1]?.results?.[0] as {id?:number}|undefined)?.id;
  if(!inviteId)throw new CollaborationError("邀请权限已变化，请重新操作",403);
  const url=new URL("/invite",mail.base);
  url.searchParams.set("token",raw);
  try {
    await sendTransactionalEmail(mail,{
      to:email,
      subject:"你受邀加入星屿工作区："+grant.name,
      text:"你已收到加入星屿共享工作区「"+grant.name+"」的邀请。\n角色："+roleInput+
      "\n请使用该邮箱注册或登录星屿，然后打开链接接受邀请（7 天有效）：\n"+
      url.toString()+"\n若非你本人操作，请忽略。",
    });
  } catch(error) {
    await env.DB.prepare("UPDATE workspace_invitations SET revoked_at=? WHERE id=? AND accepted_at IS NULL")
      .bind(now(),inviteId).run();
    if(error instanceof MailDeliveryError)throw new CollaborationError("邀请邮件发送失败，请稍后重试",503);
    throw error;
  }
  return {id:inviteId,email,role:roleInput,expiresAt:expiry};
}

export async function previewInvitation(userId:number,token:string) {
  if(!/^[a-zA-Z0-9_-]{40,60}$/.test(token))throw new CollaborationError("邀请链接无效",404);
  await ensureDatabase();
  const row=await env.DB.prepare(
    "SELECT w.id AS workspaceId,w.name AS workspaceName,i.email,i.role,i.expires_at AS expiresAt "+
    "FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id "+
    "JOIN users u ON u.id=? JOIN user_identities uid ON uid.user_id=u.id "+
    "WHERE i.token_hash=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? "+
    "AND w.kind='shared' AND w.status='active' AND u.status='active' AND uid.provider='email' AND uid.subject=i.email "+
    "AND EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.user_id=i.invited_by AND m.workspace_id=w.id "+
    "AND m.status='active' AND (m.role='owner' OR (m.role='admin' AND i.role<>'admin'))) LIMIT 1",
  ).bind(userId,await sessionDigest(token),now()).first<{workspaceId:number;workspaceName:string;email:string;role:InviteRole;expiresAt:number}>();
  if(!row)throw new CollaborationError("邀请已失效，或当前账号邮箱与受邀邮箱不一致",404);
  return row;
}

export async function acceptInvitation(userId:number,token:string) {
  const preview=await previewInvitation(userId,token);
  const hashed=await sessionDigest(token);
  const timestamp=now();
  const r=await env.DB.batch([
    env.DB.prepare(
      "UPDATE workspace_invitations SET accepted_by=?,accepted_at=? WHERE token_hash=? AND accepted_at IS NULL "+
      "AND revoked_at IS NULL AND expires_at>? "+
      "AND EXISTS(SELECT 1 FROM user_identities x JOIN users u ON u.id=x.user_id WHERE x.user_id=? "+
      "AND x.provider='email' AND x.subject=workspace_invitations.email AND u.status='active') "+
      "AND EXISTS(SELECT 1 FROM workspaces w JOIN workspace_memberships m ON m.workspace_id=w.id "+
      "WHERE w.id=workspace_invitations.workspace_id AND w.kind='shared' AND w.status='active' "+
      "AND m.user_id=workspace_invitations.invited_by AND m.status='active' "+
      "AND (m.role='owner' OR (m.role='admin' AND workspace_invitations.role<>'admin'))) "+
      "AND NOT EXISTS(SELECT 1 FROM workspace_memberships existing WHERE existing.workspace_id=workspace_invitations.workspace_id "+
      "AND existing.user_id=? AND existing.status='active') RETURNING workspace_id",
    ).bind(userId,timestamp,hashed,timestamp,userId,userId),
    env.DB.prepare(
      "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) "+
      "SELECT workspace_id,? ,role,'active' FROM workspace_invitations "+
      "WHERE token_hash=? AND accepted_by=? AND accepted_at=? AND changes()=1 "+
      "ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active'",
    ).bind(userId,hashed,userId,timestamp),
  ]);
  if(!r[0]?.results?.length||!r[1]?.meta?.changes)throw new CollaborationError("邀请已失效或账号权限不符合要求",409);
  return {workspaceId:preview.workspaceId,workspaceName:preview.workspaceName,role:preview.role};
}

export async function revokeInvitation(userId:number,workspaceId:number,invitationId:number) {
  const grant=await sharedManager(userId,workspaceId);
  if(!validId(invitationId))throw new CollaborationError("邀请不存在",404);
  const r=await env.DB.prepare(
    "UPDATE workspace_invitations SET revoked_at=? WHERE id=? AND workspace_id=? AND accepted_at IS NULL "+
    "AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.workspace_id=? "+
    "AND m.user_id=? AND m.status='active' AND (m.role='owner' OR (m.role='admin' AND workspace_invitations.role<>'admin'))) RETURNING id",
  ).bind(now(),invitationId,workspaceId,workspaceId,userId).first();
  if(!r)throw new CollaborationError(grant.role==="admin"?"没有权限撤销该邀请":"邀请不存在或已处理",403);
}

export async function changeMemberRole(actorId:number,workspaceId:number,targetId:number,newRole:unknown) {
  const grant=await sharedManager(actorId,workspaceId);
  if(!validId(targetId)||!validRole(newRole))throw new CollaborationError("成员或角色无效");
  if(newRole==="admin"&&grant.role!=="owner")throw new CollaborationError("只有所有者可以设置管理员",403);
  const current=await env.DB.prepare(
    "SELECT m.role FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id "+
    "WHERE m.workspace_id=? AND m.user_id=? AND m.status='active' AND w.kind='shared'",
  ).bind(workspaceId,targetId).first<{role:WorkspaceRole}>();
  if(!current)throw new CollaborationError("成员不存在",404);
  if(current.role==="owner")throw new CollaborationError("不能修改工作区所有者",403);
  if(current.role==="admin"&&grant.role!=="owner")throw new CollaborationError("管理员不能修改其他管理员",403);
  const row=await env.DB.prepare(
    "UPDATE workspace_memberships SET role=? WHERE workspace_id=? AND user_id=? AND status='active' "+
    "AND role=? AND EXISTS(SELECT 1 FROM workspaces w JOIN workspace_memberships m ON m.workspace_id=w.id "+
    "WHERE w.id=? AND w.kind='shared' AND w.status='active' AND m.user_id=? AND m.status='active' "+
    "AND (m.role='owner' OR (m.role='admin' AND ?<>'admin' AND ?<>'admin'))) RETURNING role",
  ).bind(newRole,workspaceId,targetId,current.role,workspaceId,actorId,newRole,current.role).first();
  if(!row)throw new CollaborationError("角色或操作权限已发生变化",409);
  return {role:newRole};
}

export async function removeMember(actorId:number,workspaceId:number,targetId:number) {
  const grant=await sharedManager(actorId,workspaceId);
  if(!validId(targetId))throw new CollaborationError("成员不存在",404);
  const row=await env.DB.prepare(
    "SELECT m.role FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id "+
    "WHERE m.workspace_id=? AND m.user_id=? AND m.status='active' AND w.kind='shared'",
  ).bind(workspaceId,targetId).first<{role:WorkspaceRole}>();
  if(!row)throw new CollaborationError("成员不存在",404);
  if(row.role==="owner"||(grant.role==="admin"&&row.role==="admin"))throw new CollaborationError("不能移除该成员",403);
  const deleted=await env.DB.prepare(
    "DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND role=? "+
    "AND EXISTS(SELECT 1 FROM workspace_memberships manager WHERE manager.workspace_id=? "+
    "AND manager.user_id=? AND manager.status='active' AND "+
    "(manager.role='owner' OR (manager.role='admin' AND ?<>'admin'))) RETURNING user_id",
  ).bind(workspaceId,targetId,row.role,workspaceId,actorId,row.role).first();
  if(!deleted)throw new CollaborationError("权限已发生变化，请重试",409);
}

export async function leaveSharedWorkspace(userId:number,workspaceId:number) {
  await ensureDatabase();
  if(!validId(userId)||!validId(workspaceId))throw new CollaborationError("工作区不存在",404);
  const removed=await env.DB.prepare(
    "DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND role<>'owner' "+
    "AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=? AND w.kind='shared' AND w.status='active') RETURNING user_id",
  ).bind(workspaceId,userId,workspaceId).first();
  if(!removed)throw new CollaborationError("不能退出个人工作区或当前账号不属于该共享工作区",403);
}

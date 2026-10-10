import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import { bytesToBase64Url } from "@/db/admin-session";
import { sessionDigest } from "@/server/auth/identity-session";
import { normalizeEmail } from "@/server/auth/identity";
import { getMailSettings,sendTransactionalEmail,MailDeliveryError } from "@/server/mail-delivery";
import { orgGrant } from "@/db/organization-access";
import { OrganizationError,validId } from "@/db/organization-errors";
export type OrgInviteRole="admin"|"member";
const TTL_SECONDS=7*24*60*60;
const now=()=>Math.floor(Date.now()/1000);
const isToken=(raw:string)=>/^[a-zA-Z0-9_-]{40,60}$/.test(raw);
const roleAllowed=(role:unknown):role is OrgInviteRole=>role==="member"||role==="admin";
function inviteEmail(raw:unknown) {
  const email=typeof raw==="string"?normalizeEmail(raw):"";
  if(!email)throw new OrganizationError("受邀邮箱格式无效");
  return email;
}

export async function listOrganizationInvitations(actorId:number,orgId:number) {
  await orgGrant(actorId,orgId,"manage");
  const rows=await env.DB.prepare(
    "SELECT id,email,role,invited_by AS invitedBy,expires_at AS expiresAt,created_at AS createdAt "+
    "FROM organization_invitations WHERE organization_id=? AND accepted_at IS NULL "+
    "AND revoked_at IS NULL AND expires_at>? ORDER BY id DESC LIMIT 100",
  ).bind(orgId,now()).all();
  return rows.results??[];
}
export async function inviteOrganizationMember(actorId:number,orgId:number,emailInput:unknown,roleInput:unknown,origin:string) {
  const actor=await orgGrant(actorId,orgId,"manage");
  if(!roleAllowed(roleInput))throw new OrganizationError("邀请角色必须是 Admin 或 Member");
  if(roleInput==="admin"&&actor.role!=="owner")throw new OrganizationError("只有组织所有者可邀请管理员",403);
  const email=inviteEmail(emailInput);
  let mail:ReturnType<typeof getMailSettings>;
  try{mail=getMailSettings();}
  catch(error){if(error instanceof MailDeliveryError)throw new OrganizationError(error.message,503);throw error;}
  if(origin!==mail.base.origin)throw new OrganizationError("发信域名与当前站点不一致",503);
  const member=await env.DB.prepare(
    "SELECT 1 FROM organization_memberships m JOIN user_identities i ON i.user_id=m.user_id "+
    "JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.status='active' "+
    "AND i.provider='email' AND i.subject=? AND u.status='active' LIMIT 1",
  ).bind(orgId,email).first();
  if(member)throw new OrganizationError("此邮箱已属于组织成员",409);
  const cnt=await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM organization_invitations WHERE organization_id=? "+
    "AND created_at>datetime('now','-1 day')",
  ).bind(orgId).first<{n:number}>();
  if((cnt?.n??0)>=50)throw new OrganizationError("组织当天邀请次数已达上限",429);
  const token=bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest=await sessionDigest(token);
  const expires=now()+TTL_SECONDS;
  const authorized="EXISTS(SELECT 1 FROM organization_memberships a JOIN organizations o ON o.id=a.organization_id "+
    "WHERE a.organization_id=? AND a.user_id=? AND a.status='active' AND o.status='active' "+
    "AND (a.role='owner' OR (a.role='admin' AND ?='member')))";
  const batch=await env.DB.batch([
    env.DB.prepare(
      "UPDATE organization_invitations SET revoked_at=? WHERE organization_id=? AND email=? "+
      "AND accepted_at IS NULL AND revoked_at IS NULL AND "+authorized,
    ).bind(now(),orgId,email,orgId,actorId,roleInput),
    env.DB.prepare(
      "INSERT INTO organization_invitations(organization_id,email,role,token_hash,invited_by,expires_at) "+
      "SELECT o.id,?,?,?,?,? FROM organizations o WHERE o.id=? AND o.status='active' AND "+
      authorized+" RETURNING id",
    ).bind(email,roleInput,digest,actorId,expires,orgId,orgId,actorId,roleInput),
  ]);
  const invitationId=(batch[1]?.results?.[0] as {id?:number}|undefined)?.id;
  if(!invitationId)throw new OrganizationError("邀请权限发生变化",403);
  const link=new URL("/organization-invite",mail.base);
  link.searchParams.set("token",token);
  try{
    await sendTransactionalEmail(mail,{
      to:email,subject:"你受邀加入星屿组织："+actor.name,
      text:"你收到了加入星屿组织「"+actor.name+"」的邀请。\n角色："+roleInput+
      "\n请使用对应邮箱注册/登录星屿后接受邀请（7 天有效）：\n"+link.toString()+
      "\n如果不是你本人操作，请忽略。",
    });
  }catch(error){
    await env.DB.prepare(
      "UPDATE organization_invitations SET revoked_at=? WHERE id=? AND accepted_at IS NULL",
    ).bind(now(),invitationId).run();
    if(error instanceof MailDeliveryError)throw new OrganizationError("组织邀请邮件发送失败",503);
    throw error;
  }
  return {id:invitationId,email,role:roleInput,expiresAt:expires};
}

export async function previewOrganizationInvitation(userId:number,token:string) {
  if(!isToken(token))throw new OrganizationError("邀请链接无效",404);
  validId(userId);await ensureDatabase();
  const row=await env.DB.prepare(
    "SELECT o.id AS organizationId,o.name AS organizationName,i.email,i.role,i.expires_at AS expiresAt "+
    "FROM organization_invitations i JOIN organizations o ON o.id=i.organization_id "+
    "JOIN users u ON u.id=? JOIN user_identities e ON e.user_id=u.id "+
    "WHERE i.token_hash=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? "+
    "AND o.status='active' AND u.status='active' AND e.provider='email' AND e.subject=i.email "+
    "AND EXISTS(SELECT 1 FROM organization_memberships manager WHERE manager.organization_id=o.id "+
    "AND manager.user_id=i.invited_by AND manager.status='active' "+
    "AND (manager.role='owner' OR (manager.role='admin' AND i.role='member'))) LIMIT 1",
  ).bind(userId,await sessionDigest(token),now())
    .first<{organizationId:number;organizationName:string;email:string;role:OrgInviteRole;expiresAt:number}>();
  if(!row)throw new OrganizationError("邀请已失效，或当前账号邮箱与受邀邮箱不符",404);
  return row;
}
export async function acceptOrganizationInvitation(userId:number,token:string) {
  const preview=await previewOrganizationInvitation(userId,token);
  const digest=await sessionDigest(token),ts=now();
  const changes=await env.DB.batch([
    env.DB.prepare(
      "UPDATE organization_invitations SET accepted_by=?,accepted_at=? "+
      "WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? "+
      "AND EXISTS(SELECT 1 FROM user_identities e JOIN users u ON u.id=e.user_id "+
      "WHERE e.user_id=? AND e.provider='email' AND e.subject=organization_invitations.email AND u.status='active') "+
      "AND EXISTS(SELECT 1 FROM organizations o JOIN organization_memberships manager "+
      "ON manager.organization_id=o.id WHERE o.id=organization_invitations.organization_id AND o.status='active' "+
      "AND manager.user_id=organization_invitations.invited_by AND manager.status='active' "+
      "AND (manager.role='owner' OR (manager.role='admin' AND organization_invitations.role='member'))) "+
      "AND NOT EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=organization_invitations.organization_id "+
      "AND m.user_id=? AND m.status='active') RETURNING organization_id",
    ).bind(userId,ts,digest,ts,userId,userId),
    env.DB.prepare(
      "INSERT INTO organization_memberships(organization_id,user_id,role,status) "+
      "SELECT organization_id,?,role,'active' FROM organization_invitations "+
      "WHERE token_hash=? AND accepted_by=? AND accepted_at=? AND changes()=1 "+
      "ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,status='active'",
    ).bind(userId,digest,userId,ts),
  ]);
  if(!changes[0]?.results?.length||!changes[1]?.meta?.changes)
    throw new OrganizationError("邀请已被使用，或权限条件已发生变化",409);
  return {organizationId:preview.organizationId,organizationName:preview.organizationName,role:preview.role};
}
export async function revokeOrganizationInvitation(actorId:number,orgId:number,inviteId:number) {
  await orgGrant(actorId,orgId,"manage");validId(inviteId);
  const revoked=await env.DB.prepare(
    "UPDATE organization_invitations SET revoked_at=? WHERE id=? AND organization_id=? "+
    "AND accepted_at IS NULL AND revoked_at IS NULL "+
    "AND EXISTS(SELECT 1 FROM organization_memberships a JOIN organizations o ON o.id=a.organization_id "+
    "WHERE a.organization_id=? AND a.user_id=? AND a.status='active' AND o.status='active' "+
    "AND (a.role='owner' OR (a.role='admin' AND organization_invitations.role='member'))) RETURNING id",
  ).bind(now(),inviteId,orgId,orgId,actorId).first();
  if(!revoked)throw new OrganizationError("邀请不存在或无撤销权限",403);
}

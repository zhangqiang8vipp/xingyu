import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import { OrganizationError,validId,cleanName } from "./organization-errors";

export type OrgRole="owner"|"admin"|"member";
export type OrganizationGrant={id:number;name:string;slug:string;ownerUserId:number;role:OrgRole};
type Member={userId:number;name:string;email:string|null;role:OrgRole;joinedAt:string};

export async function orgGrant(userId:number,organizationId:number,action:"read"|"manage"|"owner"="read") {
  validId(userId);validId(organizationId);
  await ensureDatabase();
  const org=await env.DB.prepare(
    "SELECT o.id,o.name,o.slug,o.owner_user_id AS ownerUserId,m.role "+
    "FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id "+
    "JOIN users u ON u.id=m.user_id WHERE o.id=? AND m.user_id=? AND m.status='active' "+
    "AND o.status='active' AND u.status='active'",
  ).bind(organizationId,userId).first<OrganizationGrant>();
  if(!org)throw new OrganizationError("组织不存在或无访问权限",404);
  if(action==="owner"&&org.role!=="owner")throw new OrganizationError("仅组织所有者可执行该操作",403);
  if(action==="manage"&&org.role==="member")throw new OrganizationError("没有组织管理权限",403);
  return org;
}
export async function listMyOrganizations(userId:number):Promise<OrganizationGrant[]> {
  validId(userId);await ensureDatabase();
  const rows=await env.DB.prepare(
    "SELECT o.id,o.name,o.slug,o.owner_user_id AS ownerUserId,m.role "+
    "FROM organizations o JOIN organization_memberships m ON m.organization_id=o.id "+
    "JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.status='active' "+
    "AND o.status='active' AND u.status='active' ORDER BY o.id",
  ).bind(userId).all<OrganizationGrant>();
  return rows.results??[];
}
export async function createOrganization(userId:number,inputName:unknown) {
  validId(userId);await ensureDatabase();
  const name=cleanName(inputName,"组织名称",100);
  // Avoid unbounded tenant creation with a stable per-owner cap.
  const owned=await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM organizations WHERE owner_user_id=? AND status='active'",
  ).bind(userId).first<{n:number}>();
  if((owned?.n??0)>=10)throw new OrganizationError("每位用户最多创建 10 个组织",429);
  const slug="org-"+crypto.randomUUID();
  const batch=await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations(slug,name,owner_user_id) SELECT ?,?,u.id "+
      "FROM users u WHERE u.id=? AND u.status='active' RETURNING id",
    ).bind(slug,name,userId),
    env.DB.prepare(
      "INSERT INTO organization_memberships(organization_id,user_id,role) "+
      "SELECT id,?,'owner' FROM organizations WHERE slug=? AND owner_user_id=?",
    ).bind(userId,slug,userId),
  ]);
  const id=(batch[0]?.results?.[0] as {id?:number}|undefined)?.id;
  if(!id||!batch[1]?.meta?.changes)throw new OrganizationError("组织创建失败",503);
  return orgGrant(userId,id,"owner");
}
export async function renameOrganization(userId:number,orgId:number,inputName:unknown) {
  await orgGrant(userId,orgId,"manage");
  const name=cleanName(inputName,"组织名称",100);
  const row=await env.DB.prepare(
    "UPDATE organizations SET name=? WHERE id=? AND status='active' "+
    "AND EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=organizations.id "+
    "AND m.user_id=? AND m.status='active' AND m.role IN ('owner','admin')) RETURNING id",
  ).bind(name,orgId,userId).first();
  if(!row)throw new OrganizationError("组织管理权限已发生变化",403);
  return orgGrant(userId,orgId);
}
export async function listOrganizationMembers(userId:number,orgId:number):Promise<Member[]> {
  await orgGrant(userId,orgId);
  const rows=await env.DB.prepare(
    "SELECT m.user_id AS userId,u.display_name AS name,m.role,m.created_at AS joinedAt,"+
    "(SELECT i.subject FROM user_identities i WHERE i.user_id=u.id AND i.provider='email' ORDER BY i.id LIMIT 1) AS email "+
    "FROM organization_memberships m JOIN users u ON u.id=m.user_id "+
    "WHERE m.organization_id=? AND m.status='active' AND u.status='active' "+
    "ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,m.user_id",
  ).bind(orgId).all<Member>();
  return rows.results??[];
}
export async function changeOrganizationRole(actorId:number,orgId:number,targetId:number,role:unknown) {
  const actor=await orgGrant(actorId,orgId,"manage");
  validId(targetId);
  if(role!=="admin"&&role!=="member")throw new OrganizationError("角色只能选择 Admin 或 Member");
  const current=await env.DB.prepare(
    "SELECT role FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='active'",
  ).bind(orgId,targetId).first<{role:OrgRole}>();
  if(!current)throw new OrganizationError("组织成员不存在",404);
  if(current.role==="owner")throw new OrganizationError("不能修改组织所有者",403);
  if(actor.role!=="owner"&&(current.role==="admin"||role==="admin"))
    throw new OrganizationError("管理员无法管理其他管理员",403);
  const updated=await env.DB.prepare(
    "UPDATE organization_memberships SET role=? WHERE organization_id=? AND user_id=? "+
    "AND status='active' AND role=? AND EXISTS(SELECT 1 FROM organization_memberships a "+
    "WHERE a.organization_id=? AND a.user_id=? AND a.status='active' "+
    "AND (a.role='owner' OR (a.role='admin' AND ?='member' AND ?='member'))) RETURNING role",
  ).bind(role,orgId,targetId,current.role,orgId,actorId,role,current.role).first();
  if(!updated)throw new OrganizationError("成员角色或权限已变化",409);
  return {role};
}
export async function removeOrganizationMember(actorId:number,orgId:number,targetId:number) {
  const actor=await orgGrant(actorId,orgId,"manage");validId(targetId);
  const member=await env.DB.prepare(
    "SELECT role FROM organization_memberships WHERE organization_id=? AND user_id=? AND status='active'",
  ).bind(orgId,targetId).first<{role:OrgRole}>();
  if(!member)throw new OrganizationError("成员不存在",404);
  if(member.role==="owner"||(actor.role==="admin"&&member.role==="admin"))
    throw new OrganizationError("不允许移除该成员",403);
  const removed=await env.DB.prepare(
    "DELETE FROM organization_memberships WHERE organization_id=? AND user_id=? AND role=? "+
    "AND EXISTS(SELECT 1 FROM organization_memberships a WHERE a.organization_id=? AND a.user_id=? "+
    "AND a.status='active' AND (a.role='owner' OR (a.role='admin' AND ?='member'))) RETURNING user_id",
  ).bind(orgId,targetId,member.role,orgId,actorId,member.role).first();
  if(!removed)throw new OrganizationError("成员管理权限已变化",409);
}
export async function leaveOrganization(userId:number,orgId:number) {
  validId(userId);validId(orgId);await ensureDatabase();
  const row=await env.DB.prepare(
    "DELETE FROM organization_memberships WHERE organization_id=? AND user_id=? AND role<>'owner' "+
    "AND EXISTS(SELECT 1 FROM organizations WHERE id=? AND status='active') RETURNING user_id",
  ).bind(orgId,userId,orgId).first();
  if(!row)throw new OrganizationError("无法退出组织，所有者必须先办理所有权转移",403);
}

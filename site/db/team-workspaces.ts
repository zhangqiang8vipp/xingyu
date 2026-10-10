import { env } from "cloudflare:workers";
import { orgGrant } from "@/db/organization-access";
import { workspaceGrant } from "@/db/workspace-access";
import { OrganizationError,validId,cleanName,siblingConflict } from "@/db/organization-errors";

export type TeamRole="editor"|"viewer";
const roleCheck=(r:unknown):r is TeamRole=>r==="editor"||r==="viewer";
async function teamFor(userId:number,orgId:number,teamId:number,action:"read"|"manage"="read") {
  await orgGrant(userId,orgId,action);
  validId(teamId);
  const team=await env.DB.prepare(
    "SELECT id,organization_id AS organizationId,name,slug FROM teams WHERE organization_id=? AND id=?",
  ).bind(orgId,teamId).first<{id:number;organizationId:number;name:string;slug:string}>();
  if(!team)throw new OrganizationError("团队不存在",404);
  return team;
}
async function organizationWorkspace(userId:number,orgId:number,workspaceId:number,action:"read"|"manage"="manage") {
  await orgGrant(userId,orgId,"read");
  validId(workspaceId);
  const linked=await env.DB.prepare(
    "SELECT 1 FROM organization_workspaces ow JOIN organizations o ON o.id=ow.organization_id "+
    "JOIN workspaces w ON w.id=ow.workspace_id WHERE ow.organization_id=? AND ow.workspace_id=? "+
    "AND w.kind='organization' AND w.status='active' AND o.status='active'",
  ).bind(orgId,workspaceId).first();
  if(!linked)throw new OrganizationError("组织工作区不存在",404);
  await workspaceGrant(userId,workspaceId,action);
  return workspaceId;
}
export async function listOrganizationTeams(userId:number,orgId:number) {
  await orgGrant(userId,orgId);
  const [teams,members]=await Promise.all([
    env.DB.prepare("SELECT id,organization_id AS organizationId,name,slug FROM teams WHERE organization_id=? ORDER BY id")
      .bind(orgId).all(),
    env.DB.prepare("SELECT tm.team_id AS teamId,tm.user_id AS userId "+
      "FROM team_memberships tm JOIN organization_memberships om ON om.organization_id=tm.organization_id "+
      "AND om.user_id=tm.user_id AND om.status='active' JOIN users u ON u.id=tm.user_id AND u.status='active' "+
      "WHERE tm.organization_id=? ORDER BY tm.team_id,tm.user_id").bind(orgId).all(),
  ]);
  return {teams:teams.results??[],memberships:members.results??[]};
}
export async function createOrganizationTeam(userId:number,orgId:number,nameInput:unknown) {
  await orgGrant(userId,orgId,"manage");
  const name=cleanName(nameInput,"团队名称");
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM teams WHERE organization_id=?")
    .bind(orgId).first<{n:number}>();
  if((count?.n??0)>=100)throw new OrganizationError("组织团队数量已达上限",429);
  const slug="team-"+crypto.randomUUID();
  const row=await env.DB.prepare(
    "INSERT INTO teams(organization_id,name,slug) SELECT o.id,?,? FROM organizations o "+
    "WHERE o.id=? AND o.status='active' AND EXISTS(SELECT 1 FROM organization_memberships m "+
    "WHERE m.organization_id=o.id AND m.user_id=? AND m.status='active' AND m.role IN ('owner','admin')) RETURNING id",
  ).bind(name,slug,orgId,userId).first<{id:number}>();
  if(!row)throw new OrganizationError("组织权限已变化",409);
  return teamFor(userId,orgId,row.id);
}
export async function updateOrganizationTeam(userId:number,orgId:number,teamId:number,nameInput:unknown) {
  await teamFor(userId,orgId,teamId,"manage");
  const name=cleanName(nameInput,"团队名称");
  const result=await env.DB.prepare(
    "UPDATE teams SET name=? WHERE organization_id=? AND id=? AND EXISTS("+
    "SELECT 1 FROM organization_memberships m WHERE m.organization_id=? AND m.user_id=? "+
    "AND m.status='active' AND m.role IN ('owner','admin')) RETURNING id",
  ).bind(name,orgId,teamId,orgId,userId).first();
  if(!result)throw new OrganizationError("团队管理权限已变化",409);
  return teamFor(userId,orgId,teamId);
}
export async function deleteOrganizationTeam(userId:number,orgId:number,teamId:number) {
  await teamFor(userId,orgId,teamId,"manage");
  const row=await env.DB.prepare(
    "DELETE FROM teams WHERE id=? AND organization_id=? AND "+
    "NOT EXISTS(SELECT 1 FROM team_memberships m WHERE m.team_id=teams.id) AND "+
    "NOT EXISTS(SELECT 1 FROM workspace_team_grants g WHERE g.team_id=teams.id) AND "+
    "NOT EXISTS(SELECT 1 FROM space_principal_grants s WHERE s.principal_type='team' AND s.principal_id=teams.id) "+
    "AND EXISTS(SELECT 1 FROM organization_memberships a WHERE a.organization_id=? AND a.user_id=? "+
    "AND a.status='active' AND a.role IN ('owner','admin')) RETURNING id",
  ).bind(teamId,orgId,orgId,userId).first();
  if(!row)throw new OrganizationError("团队存在成员或授权，请先撤销",409);
}
export async function setTeamMember(userId:number,orgId:number,teamId:number,targetId:number,enable:boolean) {
  await teamFor(userId,orgId,teamId,"manage");validId(targetId);
  if(enable) {
    try {
      const result=await env.DB.prepare(
        "INSERT OR IGNORE INTO team_memberships(organization_id,team_id,user_id) "+
        "SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM organization_memberships m JOIN users u ON u.id=m.user_id "+
        "WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND u.status='active') "+
        "AND EXISTS(SELECT 1 FROM organization_memberships a WHERE a.organization_id=? "+
        "AND a.user_id=? AND a.status='active' AND a.role IN ('owner','admin'))",
      ).bind(orgId,teamId,targetId,orgId,targetId,orgId,userId).run();
      if(!result.meta.changes) {
        const exists=await env.DB.prepare(
          "SELECT 1 FROM team_memberships WHERE organization_id=? AND team_id=? AND user_id=?",
        ).bind(orgId,teamId,targetId).first();
        if(!exists)throw new OrganizationError("只能添加该组织的有效成员",403);
      }
    }catch(e){siblingConflict(e);}
  }else{
    const gone=await env.DB.prepare(
      "DELETE FROM team_memberships WHERE organization_id=? AND team_id=? AND user_id=? "+
      "AND EXISTS(SELECT 1 FROM organization_memberships a WHERE a.organization_id=? "+
      "AND a.user_id=? AND a.status='active' AND a.role IN ('owner','admin')) RETURNING user_id",
    ).bind(orgId,teamId,targetId,orgId,userId).first();
    if(!gone)throw new OrganizationError("成员不存在或团队管理权限已变化",404);
  }
}
export async function listOrganizationWorkspaces(userId:number,orgId:number) {
  await orgGrant(userId,orgId);
  const rows=await env.DB.prepare(
    "SELECT ow.workspace_id AS id,w.name,w.kind FROM organization_workspaces ow "+
    "JOIN workspaces w ON w.id=ow.workspace_id AND w.status='active' AND w.kind='organization' "+
    "JOIN organizations o ON o.id=ow.organization_id AND o.status='active' "+
    "WHERE ow.organization_id=? ORDER BY w.id",
  ).bind(orgId).all();
  // Org membership is allowed to learn names of organizational workspaces, not their contents.
  return rows.results??[];
}
export async function createOrganizationWorkspace(userId:number,orgId:number,nameInput:unknown) {
  const org=await orgGrant(userId,orgId,"owner");
  const name=cleanName(nameInput,"工作区名称");
  const owned=await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM organization_workspaces WHERE organization_id=?",
  ).bind(orgId).first<{n:number}>();
  if((owned?.n??0)>=30)throw new OrganizationError("该组织最多可以创建 30 个工作区",429);
  const slug="organization-ws-"+crypto.randomUUID();
  const results=await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO workspaces(kind,owner_user_id,slug,name,status) "+
      "SELECT 'organization',o.owner_user_id,?,?,'active' FROM organizations o "+
      "WHERE o.id=? AND o.status='active' AND o.owner_user_id=? RETURNING id",
    ).bind(slug,name,orgId,userId),
    env.DB.prepare(
      "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) "+
      "SELECT id,?,'owner','active' FROM workspaces WHERE slug=? AND owner_user_id=?",
    ).bind(org.ownerUserId,slug,org.ownerUserId),
    env.DB.prepare(
      "INSERT INTO organization_workspaces(organization_id,workspace_id) "+
      "SELECT ?,id FROM workspaces WHERE slug=? AND kind='organization' AND owner_user_id=?",
    ).bind(orgId,slug,org.ownerUserId),
    env.DB.prepare(
      "INSERT INTO categories(workspace_id,name,slug,color) "+
      "SELECT id,'组织资料',?,'#567c88' FROM workspaces WHERE slug=?",
    ).bind(slug+"-notes",slug),
    env.DB.prepare(
      "INSERT INTO spaces(workspace_id,parent_id,name,slug) SELECT id,NULL,'组织知识库',? FROM workspaces WHERE slug=?",
    ).bind(slug+"-root",slug),
  ]);
  const id=(results[0]?.results?.[0] as {id?:number}|undefined)?.id;
  if(!id||!results[1]?.meta?.changes||!results[2]?.meta?.changes)
    throw new OrganizationError("组织工作区创建失败",503);
  return workspaceGrant(userId,id,"manage");
}
export async function listWorkspaceTeamGrants(userId:number,orgId:number,workspaceId:number) {
  await organizationWorkspace(userId,orgId,workspaceId,"manage");
  const rows=await env.DB.prepare(
    "SELECT g.team_id AS teamId,t.name AS teamName,g.role FROM workspace_team_grants g "+
    "JOIN teams t ON t.id=g.team_id AND t.organization_id=g.organization_id "+
    "WHERE g.organization_id=? AND g.workspace_id=? ORDER BY g.team_id",
  ).bind(orgId,workspaceId).all();
  return rows.results??[];
}
export async function setWorkspaceTeamGrant(userId:number,orgId:number,workspaceId:number,teamId:number,role:unknown) {
  await organizationWorkspace(userId,orgId,workspaceId,"manage");
  await teamFor(userId,orgId,teamId,"read");
  if(!roleCheck(role))throw new OrganizationError("团队工作区授权只能是 Editor 或 Viewer");
  const row=await env.DB.prepare(
    "INSERT INTO workspace_team_grants(organization_id,workspace_id,team_id,role) "+
    "SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_effective_grants g "+
    "WHERE g.workspace_id=? AND g.user_id=? AND g.role IN ('owner','admin')) "+
    "ON CONFLICT(workspace_id,team_id) DO UPDATE SET role=excluded.role "+
    "RETURNING team_id",
  ).bind(orgId,workspaceId,teamId,role,workspaceId,userId).first();
  if(!row)throw new OrganizationError("工作区管理权限已变化",403);
  return {teamId,role};
}
export async function revokeWorkspaceTeamGrant(userId:number,orgId:number,workspaceId:number,teamId:number) {
  await organizationWorkspace(userId,orgId,workspaceId,"manage");
  validId(teamId);
  const deleted=await env.DB.prepare(
    "DELETE FROM workspace_team_grants WHERE organization_id=? AND workspace_id=? AND team_id=? "+
    "AND EXISTS(SELECT 1 FROM workspace_effective_grants g WHERE g.workspace_id=? "+
    "AND g.user_id=? AND g.role IN ('owner','admin')) RETURNING team_id",
  ).bind(orgId,workspaceId,teamId,workspaceId,userId).first();
  if(!deleted)throw new OrganizationError("团队授权不存在或已撤销",404);
}
export async function orgWorkspaceGrant(userId:number,orgId:number,workspaceId:number,action:"read"|"manage"="manage") {
  return organizationWorkspace(userId,orgId,workspaceId,action);
}

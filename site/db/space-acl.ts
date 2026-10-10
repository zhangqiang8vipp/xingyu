import { env } from "cloudflare:workers";
import { workspaceGrant,WorkspaceAccessError } from "@/db/workspace-access";
import { OrganizationError,validId } from "@/db/organization-errors";
import { orgWorkspaceGrant } from "@/db/team-workspaces";

type Role="viewer"|"editor";
type SpaceNode={id:number;parentId:number|null};
type Policy={spaceId:number};
type PrincipalGrant={spaceId:number;principalType:"user"|"team";principalId:number;role:Role};
const permitted=(role:Role,action:"read"|"write")=>action==="read"||role==="editor";

export async function accessibleSpaceIds(
  userId:number,workspaceId:number,action:"read"|"write"="read",
):Promise<number[]|null> {
  const base=await workspaceGrant(userId,workspaceId,action);
  if(base.kind!=="organization"||base.role==="owner"||base.role==="admin")
    return null; // Existing personal/shared workspaces are unaffected; managers see every space.
  const [spaceResult,policyResult,grantResult,teamResult]=await Promise.all([
    env.DB.prepare("SELECT id,parent_id AS parentId FROM spaces WHERE workspace_id=? ORDER BY id LIMIT 2001")
      .bind(workspaceId).all<SpaceNode>(),
    env.DB.prepare("SELECT space_id AS spaceId FROM space_access_policies WHERE workspace_id=?")
      .bind(workspaceId).all<Policy>(),
    env.DB.prepare("SELECT space_id AS spaceId,principal_type AS principalType,principal_id AS principalId,role "+
      "FROM space_principal_grants WHERE workspace_id=?").bind(workspaceId).all<PrincipalGrant>(),
    env.DB.prepare(
      "SELECT tm.team_id AS teamId FROM organization_workspaces ow "+
      "JOIN organizations o ON o.id=ow.organization_id AND o.status='active' "+
      "JOIN organization_memberships om ON om.organization_id=o.id AND om.user_id=? AND om.status='active' "+
      "JOIN team_memberships tm ON tm.organization_id=o.id AND tm.user_id=om.user_id "+
      "WHERE ow.workspace_id=?",
    ).bind(userId,workspaceId).all<{teamId:number}>(),
  ]);
  const spaces=spaceResult.results??[];
  if(spaces.length>2000)throw new WorkspaceAccessError("知识空间数量超出安全读取上限",403);
  const policies=new Set((policyResult.results??[]).map(row=>row.spaceId));
  const teams=new Set((teamResult.results??[]).map(row=>row.teamId));
  const allowedAt=new Set<number>();
  for(const grant of grantResult.results??[]) {
    if(!permitted(grant.role,action))continue;
    if((grant.principalType==="user"&&grant.principalId===userId)
      ||(grant.principalType==="team"&&teams.has(grant.principalId)))
      allowedAt.add(grant.spaceId);
  }
  const nodes=new Map(spaces.map(node=>[node.id,node]));
  const memo=new Map<number,boolean>();
  function visible(id:number,seen:Set<number>):boolean {
    const cached=memo.get(id);if(cached!==undefined)return cached;
    if(seen.has(id))return false;
    const node=nodes.get(id);if(!node)return false;
    seen.add(id);
    const answer=(node.parentId===null||visible(node.parentId,seen))
      &&(!policies.has(id)||allowedAt.has(id));
    seen.delete(id);memo.set(id,answer);return answer;
  }
  return spaces.filter(node=>visible(node.id,new Set())).map(node=>node.id);
}
export async function assertSpacePermission(
  userId:number,workspaceId:number,spaceId:number|null,action:"read"|"write"="read",
) {
  const ids=await accessibleSpaceIds(userId,workspaceId,action);
  if(ids===null)return; // manager or non-org workspace: existing access boundaries remain.
  if(spaceId===null||!ids.includes(spaceId))
    throw new WorkspaceAccessError(action==="read"?"空间不存在或没有读取权限":"没有知识空间写入权限",action==="read"?404:403);
}
async function management(userId:number,workspaceId:number,spaceId:number) {
  validId(spaceId);
  const ws=await env.DB.prepare(
    "SELECT ow.organization_id AS orgId FROM organization_workspaces ow JOIN spaces s "+
    "ON s.id=? AND s.workspace_id=ow.workspace_id WHERE ow.workspace_id=?",
  ).bind(spaceId,workspaceId).first<{orgId:number}>();
  if(!ws)throw new OrganizationError("只能对组织工作区的知识空间设置 ACL",404);
  await orgWorkspaceGrant(userId,ws.orgId,workspaceId,"manage");
  return ws.orgId;
}
export async function listSpacePolicy(userId:number,workspaceId:number,spaceId:number) {
  await management(userId,workspaceId,spaceId);
  const [policy,grants]=await Promise.all([
    env.DB.prepare("SELECT mode FROM space_access_policies WHERE workspace_id=? AND space_id=?")
      .bind(workspaceId,spaceId).first<{mode:string}>(),
    env.DB.prepare("SELECT principal_type AS principalType,principal_id AS principalId,role "+
      "FROM space_principal_grants WHERE workspace_id=? AND space_id=? "+
      "ORDER BY principal_type,principal_id").bind(workspaceId,spaceId).all(),
  ]);
  return {restricted:!!policy,grants:grants.results??[]};
}
export async function setSpacePolicy(userId:number,workspaceId:number,spaceId:number,restricted:unknown) {
  await management(userId,workspaceId,spaceId);
  if(typeof restricted!=="boolean")throw new OrganizationError("需要明确指定 restricted=true/false");
  if(restricted){
    await env.DB.prepare(
      "INSERT OR IGNORE INTO space_access_policies(workspace_id,space_id) "+
      "SELECT ?,s.id FROM spaces s WHERE s.id=? AND s.workspace_id=? "+
      "AND EXISTS(SELECT 1 FROM workspace_effective_grants g WHERE g.workspace_id=? "+
      "AND g.user_id=? AND g.role IN ('owner','admin'))",
    ).bind(workspaceId,spaceId,workspaceId,workspaceId,userId).run();
  }else{
    await env.DB.prepare(
      "DELETE FROM space_access_policies WHERE workspace_id=? AND space_id=? "+
      "AND EXISTS(SELECT 1 FROM workspace_effective_grants g WHERE g.workspace_id=? "+
      "AND g.user_id=? AND g.role IN ('owner','admin'))",
    ).bind(workspaceId,spaceId,workspaceId,userId).run();
  }
  return listSpacePolicy(userId,workspaceId,spaceId);
}
export async function setSpacePrincipal(
  userId:number,workspaceId:number,spaceId:number,principalType:unknown,principalId:number,role:unknown,
) {
  await management(userId,workspaceId,spaceId);
  validId(principalId);
  if(principalType!=="user"&&principalType!=="team")throw new OrganizationError("授权主体必须是用户或团队");
  if(role!=="viewer"&&role!=="editor")throw new OrganizationError("空间授权仅支持 Viewer / Editor");
  let result;
  try {
    result=await env.DB.prepare(
      "INSERT INTO space_principal_grants(workspace_id,space_id,principal_type,principal_id,role) "+
      "SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM space_access_policies WHERE workspace_id=? AND space_id=?) "+
      "AND EXISTS(SELECT 1 FROM workspace_effective_grants g WHERE g.workspace_id=? AND g.user_id=? "+
      "AND g.role IN ('owner','admin')) "+
      "ON CONFLICT(space_id,principal_type,principal_id) DO UPDATE SET role=excluded.role RETURNING principal_id",
    ).bind(workspaceId,spaceId,principalType,principalId,role,workspaceId,spaceId,workspaceId,userId).first();
  }catch(e){
    if(e instanceof Error&&/space principal organization boundary/i.test(e.message))
      throw new OrganizationError("授权用户或团队不属于此组织",403);
    throw e;
  }
  if(!result)throw new OrganizationError("请先开启受限策略，或权限已变化",409);
  return listSpacePolicy(userId,workspaceId,spaceId);
}
export async function removeSpacePrincipal(
  userId:number,workspaceId:number,spaceId:number,principalType:unknown,principalId:number,
) {
  await management(userId,workspaceId,spaceId);
  validId(principalId);
  if(principalType!=="user"&&principalType!=="team")throw new OrganizationError("授权类型无效");
  const row=await env.DB.prepare(
    "DELETE FROM space_principal_grants WHERE workspace_id=? AND space_id=? AND principal_type=? AND principal_id=? "+
    "AND EXISTS(SELECT 1 FROM workspace_effective_grants g WHERE g.workspace_id=? AND g.user_id=? "+
    "AND g.role IN ('owner','admin')) RETURNING principal_id",
  ).bind(workspaceId,spaceId,principalType,principalId,workspaceId,userId).first();
  if(!row)throw new OrganizationError("授权不存在或已经被撤销",404);
  return listSpacePolicy(userId,workspaceId,spaceId);
}

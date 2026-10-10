import { env } from "cloudflare:workers";
import { orgGrant } from "@/db/organization-access";
import { OrganizationError,validId,cleanName,siblingConflict } from "@/db/organization-errors";

export type OrganizationUnit={id:number;organizationId:number;parentId:number|null;name:string;sortOrder:number};
type Assignment={unitId:number;userId:number};
const MAX_UNITS=500;

export async function listOrganizationUnits(userId:number,orgId:number) {
  await orgGrant(userId,orgId,"read");
  const [units,assigned]=await Promise.all([
    env.DB.prepare(
      "SELECT id,organization_id AS organizationId,parent_id AS parentId,name,sort_order AS sortOrder "+
      "FROM organization_units WHERE organization_id=? ORDER BY parent_id,sort_order,id LIMIT 600",
    ).bind(orgId).all<OrganizationUnit>(),
    env.DB.prepare(
      "SELECT unit_id AS unitId,user_id AS userId FROM organization_unit_memberships "+
      "WHERE organization_id=? ORDER BY unit_id,user_id LIMIT 3000",
    ).bind(orgId).all<Assignment>(),
  ]);
  return {units:units.results??[],assignments:assigned.results??[]};
}
async function checkedUnit(userId:number,orgId:number,unitId:number,action:"read"|"manage"="manage") {
  validId(unitId);await orgGrant(userId,orgId,action);
  const unit=await env.DB.prepare(
    "SELECT id,organization_id AS organizationId,parent_id AS parentId,name,sort_order AS sortOrder "+
    "FROM organization_units WHERE organization_id=? AND id=?",
  ).bind(orgId,unitId).first<OrganizationUnit>();
  if(!unit)throw new OrganizationError("部门不存在",404);
  return unit;
}
function parentInput(value:unknown,required:boolean) {
  if(value===undefined&&!required)return undefined;
  if(value===null)return null;
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)throw new OrganizationError("父部门 ID 无效");
  return value;
}
function sortInput(value:unknown) {
  if(value===undefined)return undefined;
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||value>100000)
    throw new OrganizationError("排序值不合法");
  return value;
}
export async function createOrganizationUnit(userId:number,orgId:number,input:{name?:unknown;parentId?:unknown;sortOrder?:unknown}) {
  await orgGrant(userId,orgId,"manage");
  const name=cleanName(input.name,"部门名称");
  const parent=parentInput(input.parentId,false)??null;
  const sort=sortInput(input.sortOrder)??0;
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM organization_units WHERE organization_id=?")
    .bind(orgId).first<{n:number}>();
  if((count?.n??0)>=MAX_UNITS)throw new OrganizationError("组织部门数量已达上限",429);
  try {
    const result=await env.DB.prepare(
      "INSERT INTO organization_units(organization_id,parent_id,name,sort_order) "+
      "SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id "+
      "WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND m.role IN ('owner','admin') AND o.status='active') "+
      "AND (? IS NULL OR EXISTS(SELECT 1 FROM organization_units p WHERE p.id=? AND p.organization_id=?)) RETURNING id",
    ).bind(orgId,parent??null,name,sort,orgId,userId,parent??null,parent??null,orgId).first<{id:number}>();
    if(!result)throw new OrganizationError("组织权限或父部门已变化",409);
    return checkedUnit(userId,orgId,result.id);
  }catch(error){return siblingConflict(error);}
}
export async function updateOrganizationUnit(userId:number,orgId:number,unitId:number,input:{name?:unknown;parentId?:unknown;sortOrder?:unknown}) {
  const current=await checkedUnit(userId,orgId,unitId);
  if(input.name===undefined&&input.parentId===undefined&&input.sortOrder===undefined)
    throw new OrganizationError("没有修改内容");
  const name=input.name===undefined?current.name:cleanName(input.name,"部门名称");
  const parent=parentInput(input.parentId,false)??(input.parentId===null?null:current.parentId);
  const sort=sortInput(input.sortOrder)??current.sortOrder;
  if(parent===unitId)throw new OrganizationError("部门不能成为自己的父部门",409);
  try{
    const result=await env.DB.prepare(
      "UPDATE organization_units SET name=?,parent_id=?,sort_order=?,updated_at=CURRENT_TIMESTAMP "+
      "WHERE id=? AND organization_id=? "+
      "AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id "+
      "WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND m.role IN ('owner','admin') AND o.status='active') "+
      "RETURNING id",
    ).bind(name,parent,sort,unitId,orgId,orgId,userId).first();
    if(!result)throw new OrganizationError("组织权限发生变化",409);
    return checkedUnit(userId,orgId,unitId);
  }catch(error){return siblingConflict(error);}
}
export async function deleteOrganizationUnit(userId:number,orgId:number,unitId:number) {
  await checkedUnit(userId,orgId,unitId);
  const result=await env.DB.prepare(
    "DELETE FROM organization_units WHERE id=? AND organization_id=? "+
    "AND NOT EXISTS(SELECT 1 FROM organization_units c WHERE c.parent_id=organization_units.id) "+
    "AND NOT EXISTS(SELECT 1 FROM organization_unit_memberships m WHERE m.unit_id=organization_units.id "+
    "AND m.organization_id=organization_units.organization_id) "+
    "AND EXISTS(SELECT 1 FROM organization_memberships a JOIN organizations o ON o.id=a.organization_id "+
    "WHERE a.organization_id=? AND a.user_id=? AND a.status='active' AND a.role IN ('owner','admin') "+
    "AND o.status='active') RETURNING id",
  ).bind(unitId,orgId,orgId,userId).first();
  if(!result)throw new OrganizationError("部门有子部门或成员，或管理权限发生变化",409);
}
export async function addUnitMember(userId:number,orgId:number,unitId:number,targetId:number) {
  await checkedUnit(userId,orgId,unitId);validId(targetId);
  const result=await env.DB.prepare(
    "INSERT OR IGNORE INTO organization_unit_memberships(organization_id,unit_id,user_id) "+
    "SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM organization_memberships m JOIN users u ON u.id=m.user_id "+
    "WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND u.status='active') "+
    "AND EXISTS(SELECT 1 FROM organization_memberships a JOIN organizations o ON o.id=a.organization_id "+
    "WHERE a.organization_id=? AND a.user_id=? AND a.status='active' AND a.role IN ('owner','admin') "+
    "AND o.status='active')",
  ).bind(orgId,unitId,targetId,orgId,targetId,orgId,userId).run();
  if(!result.meta.changes){
    const existing=await env.DB.prepare(
      "SELECT 1 FROM organization_unit_memberships WHERE organization_id=? AND unit_id=? AND user_id=?",
    ).bind(orgId,unitId,targetId).first();
    if(!existing)throw new OrganizationError("用户不是组织成员，或管理权限已变化",403);
  }
}
export async function removeUnitMember(userId:number,orgId:number,unitId:number,targetId:number) {
  await checkedUnit(userId,orgId,unitId);validId(targetId);
  const result=await env.DB.prepare(
    "DELETE FROM organization_unit_memberships WHERE organization_id=? AND unit_id=? AND user_id=? "+
    "AND EXISTS(SELECT 1 FROM organization_memberships a JOIN organizations o ON o.id=a.organization_id "+
    "WHERE a.organization_id=? AND a.user_id=? AND a.status='active' AND a.role IN ('owner','admin') AND o.status='active') RETURNING user_id",
  ).bind(orgId,unitId,targetId,orgId,userId).first();
  if(!result)throw new OrganizationError("部门成员不存在或权限发生变化",404);
}

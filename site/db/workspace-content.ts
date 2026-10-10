import { env } from "cloudflare:workers";
import { workspaceGrant, WorkspaceAccessError } from "@/db/workspace-access";
import { attachmentIdsFromMarkdown } from "@/db/attachments";
import { createPostPublicId } from "@/db/public-id";

type Status = "draft" | "published";
export type ScopedPost = {
  id:number; workspaceId:number; publicId:string; title:string; slug:string;
  content:string; excerpt:string; categoryId:number; spaceId:number|null;
  version:number; status:Status; featured:number; sortOrder:number;
  publishedAt:string|null; createdAt:string; updatedAt:string;
};
export class WorkspaceContentError extends Error {
  constructor(message:string,readonly status:400|403|404|409=400){super(message);}
}
const postSelect = "SELECT id, workspace_id AS workspaceId, public_id AS publicId, title,slug,content,excerpt,category_id AS categoryId,space_id AS spaceId,version,status,featured,sort_order AS sortOrder,published_at AS publishedAt,created_at AS createdAt,updated_at AS updatedAt FROM posts";
const text = (v:string,max:number,name:string) => {
  const cleaned=v.trim();
  if(!cleaned || cleaned.length>max) throw new WorkspaceContentError(name+"无效");
  return cleaned;
};
const safeSlug = (s:string) => s.trim().toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9\u4e00-\u9fff-]/g,"").slice(0,100);
function auditSql(action:string) {
  return "INSERT INTO mcp_activity(workspace_id,action,post_id,public_id,title,before_status,after_status,changed_fields,summary,client_label) SELECT workspace_id,'"+action+"',id,public_id,title,NULL,status,'[]',?,? FROM posts WHERE public_id=? AND changes()=1 RETURNING id,created_at";
}

export async function scopedCategories(userId:number,workspaceId:number) {
  await workspaceGrant(userId,workspaceId);
  const rows=await env.DB.prepare("SELECT id,name,slug,color FROM categories WHERE workspace_id=? ORDER BY id").bind(workspaceId).all();
  return rows.results??[];
}
export async function scopedSpaces(userId:number,workspaceId:number,parentId?:number|null) {
  await workspaceGrant(userId,workspaceId);
  const sql="SELECT s.id,s.parent_id AS parentId,s.name,s.slug,s.sort_order AS sortOrder,(SELECT COUNT(*) FROM posts p WHERE p.space_id=s.id AND p.workspace_id=s.workspace_id) AS articleCount FROM spaces s WHERE s.workspace_id=?";
  const query=parentId===undefined?sql+" ORDER BY s.parent_id,s.sort_order,s.id":sql+" AND s.parent_id IS ? ORDER BY s.sort_order,s.id";
  const rows=await env.DB.prepare(query).bind(...(parentId===undefined?[workspaceId]:[workspaceId,parentId])).all();
  return rows.results??[];
}
export async function scopedSpace(userId:number,workspaceId:number,reference:string):Promise<{id:number;name:string;parentId:number|null;slug:string}> {
  await workspaceGrant(userId,workspaceId);
  if(/^[1-9]\d*$/.test(reference)) {
    const row=await env.DB.prepare("SELECT id,name,parent_id AS parentId,slug FROM spaces WHERE workspace_id=? AND id=?").bind(workspaceId,Number(reference)).first<{id:number;name:string;parentId:number|null;slug:string}>();
    if(row)return row;
    throw new WorkspaceContentError("空间不存在",404);
  }
  const names=reference.split("/").map(v=>v.trim()).filter(Boolean);
  if(!names.length||names.length>20)throw new WorkspaceContentError("空间路径无效");
  let parent:number|null=null;
  let found:{id:number;name:string;parentId:number|null;slug:string}|null=null;
  for(const name of names){
    found=await env.DB.prepare("SELECT id,name,parent_id AS parentId,slug FROM spaces WHERE workspace_id=? AND parent_id IS ? AND (name=? OR slug=?) ORDER BY id LIMIT 1").bind(workspaceId,parent,name,name).first<{id:number;name:string;parentId:number|null;slug:string}>();
    if(!found)throw new WorkspaceContentError("空间不存在",404);
    parent=found.id;
  }
  return found!;
}
export async function newScopedSpace(userId:number,workspaceId:number,input:{name:string;parentId?:number|null;sortOrder?:number}) {
  await workspaceGrant(userId,workspaceId,"write");
  const name=text(input.name,100,"空间名称");
  const parentId=input.parentId??null;
  if(parentId!==null)await scopedSpace(userId,workspaceId,String(parentId));
  const slug="w"+workspaceId+"-"+safeSlug(name).slice(0,35)+"-"+crypto.randomUUID().slice(0,8);
  const order=input.sortOrder??0;
  if(!Number.isSafeInteger(order))throw new WorkspaceContentError("排序无效");
  const result=await env.DB.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug,sort_order) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND status='active' AND role IN('owner','admin','editor')) RETURNING id").bind(workspaceId,parentId,name,slug,order,workspaceId,userId).first<{id:number}>();
  if(!result)throw new WorkspaceAccessError();
  return scopedSpace(userId,workspaceId,String(result.id));
}
export async function editScopedSpace(userId:number,workspaceId:number,spaceId:number,input:{name?:string;parentId?:number|null;sortOrder?:number}) {
  await workspaceGrant(userId,workspaceId,"write");
  const current=await scopedSpace(userId,workspaceId,String(spaceId));
  const name=input.name===undefined?current.name:text(input.name,100,"空间名称");
  const parent=input.parentId===undefined?current.parentId:input.parentId;
  if(parent!==null)await scopedSpace(userId,workspaceId,String(parent));
  if(parent===spaceId)throw new WorkspaceContentError("不能移动到自身");
  const cycle=parent===null?null:await env.DB.prepare("WITH RECURSIVE descendants(id) AS (SELECT id FROM spaces WHERE id=? AND workspace_id=? UNION SELECT c.id FROM spaces c JOIN descendants d ON c.parent_id=d.id WHERE c.workspace_id=?) SELECT id FROM descendants WHERE id=?").bind(spaceId,workspaceId,workspaceId,parent).first();
  if(cycle)throw new WorkspaceContentError("不能移动到自己的子空间");
  const order=input.sortOrder??0;
  if(!Number.isSafeInteger(order))throw new WorkspaceContentError("排序无效");
  const result=await env.DB.prepare("UPDATE spaces SET name=?,parent_id=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND NOT EXISTS(WITH RECURSIVE descendants(id) AS (SELECT id FROM spaces WHERE id=? UNION SELECT child.id FROM spaces child JOIN descendants ON child.parent_id=descendants.id WHERE child.workspace_id=?) SELECT 1 FROM descendants WHERE id=?) AND EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND status='active' AND role IN('owner','admin','editor')) RETURNING id")
    .bind(name,parent,order,spaceId,workspaceId,spaceId,workspaceId,parent,workspaceId,userId).first();
  if(!result)throw new WorkspaceContentError("移动被拒绝或工作区权限已变化",409);
  return scopedSpace(userId,workspaceId,String(spaceId));
}
export async function removeEmptyScopedSpace(userId:number,workspaceId:number,spaceId:number) {
  await workspaceGrant(userId,workspaceId,"write");
  const row=await scopedSpace(userId,workspaceId,String(spaceId));
  if(row.slug.startsWith("private-u"))throw new WorkspaceContentError("默认私人知识库不能删除",403);
  const result=await env.DB.prepare("DELETE FROM spaces WHERE id=? AND workspace_id=? AND NOT EXISTS(SELECT 1 FROM spaces child WHERE child.parent_id=?) AND NOT EXISTS(SELECT 1 FROM posts p WHERE p.space_id=?) AND EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND status='active' AND role IN('owner','admin','editor')) RETURNING id")
    .bind(spaceId,workspaceId,spaceId,spaceId,workspaceId,userId).first();
  if(!result)throw new WorkspaceContentError("仅允许删除空空间",409);
  return {id:spaceId,deleted:true};
}
export async function scopedPost(userId:number,workspaceId:number,identifier:string|number):Promise<ScopedPost> {
  await workspaceGrant(userId,workspaceId);
  const id=String(identifier);
  const row=await env.DB.prepare(postSelect+" WHERE workspace_id=? AND (public_id=? OR slug=? OR id=?) LIMIT 1").bind(workspaceId,id,id,/^\d+$/.test(id)?Number(id):-1).first<ScopedPost>();
  if(!row)throw new WorkspaceContentError("文章不存在",404);
  return row;
}
export async function scopedPosts(userId:number,workspaceId:number,query="",limit=20,spaceId?:number|null,status:"all"|"draft"|"published"="all") {
  await workspaceGrant(userId,workspaceId);
  const size=Math.min(50,Math.max(1,limit));
  const where=" WHERE workspace_id=?"+(spaceId===undefined?"":" AND space_id IS ?")+(status==="all"?"":" AND status=?")+(query?" AND (title LIKE ? OR excerpt LIKE ?)":"");
  const escaped=query.replace(/[\\%_]/g,c=>"\\"+c).slice(0,120);
  const args:unknown[]=[workspaceId,...(spaceId===undefined?[]:[spaceId]),...(status==="all"?[]:[status]),...(query?["%"+escaped+"%","%"+escaped+"%"]:[])];
  const rows=await env.DB.prepare("SELECT id,public_id AS publicId,title,slug,excerpt,status,version,space_id AS spaceId,updated_at AS updatedAt FROM posts"+where+" ORDER BY updated_at DESC,id DESC LIMIT ?")
    .bind(...args,size).all();
  return rows.results??[];
}
async function categoryId(workspaceId:number,ref?:string|null) {
  const category=ref?await env.DB.prepare("SELECT id FROM categories WHERE workspace_id=? AND (slug=? OR name=? OR id=?) LIMIT 1").bind(workspaceId,ref,ref,/^\d+$/.test(ref)?Number(ref):-1).first<{id:number}>()
    :await env.DB.prepare("SELECT id FROM categories WHERE workspace_id=? ORDER BY id LIMIT 1").bind(workspaceId).first<{id:number}>();
  if(!category)throw new WorkspaceContentError("分类不存在，请先查询当前工作区分类");
  return category.id;
}
async function workspaceSpace(userId:number,workspaceId:number,ref?:string|null,existing?:number|null) {
  if(ref!==undefined) {
    if(ref===null) {
      if(workspaceId!==1||userId!==1)throw new WorkspaceContentError("个人工作区必须保持私有空间",403);
      return null;
    }
    return (await scopedSpace(userId,workspaceId,ref)).id;
  }
  if(existing!==undefined)return existing;
  if(workspaceId===1 && userId===1)return null;
  const root=await env.DB.prepare("SELECT id FROM spaces WHERE workspace_id=? AND parent_id IS NULL ORDER BY id LIMIT 1").bind(workspaceId).first<{id:number}>();
  if(!root)throw new WorkspaceContentError("该工作区尚无知识空间");
  return root.id;
}
async function checkAttachmentReferences(workspaceId:number,content:string,postId:number|null) {
  const ids=attachmentIdsFromMarkdown(content);
  if(ids.length>200)throw new WorkspaceContentError("附件引用数量超出限制");
  for(const attId of ids) {
    const row=await env.DB.prepare("SELECT id FROM attachments WHERE public_id=? AND workspace_id=? AND (post_id IS NULL OR post_id IS ?)").bind(attId,workspaceId,postId).first();
    if(!row)throw new WorkspaceContentError("正文引用了没有权限的附件",403);
  }
  return ids;
}
function attachSql(postId:number,workspaceId:number,attachmentId:string) {
  return env.DB.prepare("UPDATE attachments SET post_id=?,unbound_at=NULL WHERE public_id=? AND workspace_id=? AND post_id IS NULL").bind(postId,attachmentId,workspaceId);
}
export async function scopedCreateDraft(userId:number,workspaceId:number,input:{title:string;content?:string;excerpt?:string;category?:string;space?:string|null;slug?:string;featured?:boolean;sortOrder?:number},clientLabel:string,summary:string) {
  await workspaceGrant(userId,workspaceId,"write");
  const title=text(input.title,200,"标题");
  const content=input.content??"";const excerpt=input.excerpt??"";
  if(content.length>750000||excerpt.length>1000)throw new WorkspaceContentError("文章长度超限");
  const catId=await categoryId(workspaceId,input.category);
  const spaceId=await workspaceSpace(userId,workspaceId,input.space);
  const ids=await checkAttachmentReferences(workspaceId,content,null);
  const publicId=createPostPublicId();
  const base=safeSlug(input.slug||title)||"note";
  const slug=(workspaceId===1&&userId===1&&spaceId===null)?base:("w"+workspaceId+"-"+base.slice(0,60)+"-"+crypto.randomUUID().slice(0,8));
  const order=input.sortOrder??0;if(!Number.isSafeInteger(order))throw new WorkspaceContentError("排序无效");
  const insert=env.DB.prepare("INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,sort_order,status,featured,author_id,created_by,updated_by) SELECT ?,?,?,?,?,?,?,?,?, 'draft',?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND status='active' AND role IN('owner','admin','editor')) RETURNING id")
    .bind(workspaceId,publicId,title,slug,excerpt,content,catId,spaceId,order,input.featured?1:0,userId,userId,userId,workspaceId,userId);
  const audit=env.DB.prepare(auditSql("create_draft")).bind(summary,clientLabel,publicId);
  const results=await env.DB.batch([insert,audit]);
  const newId=(results[0]?.results?.[0] as {id?:number}|undefined)?.id;
  if(!newId)throw new WorkspaceAccessError();
  if(ids.length) await env.DB.batch(ids.map(att=>attachSql(newId,workspaceId,att)));
  return scopedPost(userId,workspaceId,publicId);
}
export async function scopedUpdatePost(userId:number,workspaceId:number,identifier:string,input:{
  expectedVersion:number;title?:string;content?:string;excerpt?:string;category?:string;
  space?:string|null;slug?:string;featured?:boolean;sortOrder?:number;
},clientLabel:string,summary:string) {
  await workspaceGrant(userId,workspaceId,"write");
  const post=await scopedPost(userId,workspaceId,identifier);
  if(post.version!==input.expectedVersion)throw new WorkspaceContentError("版本已变化，请重新读取全文",409);
  const title=input.title===undefined?post.title:text(input.title,200,"标题");
  const content=input.content??post.content;const excerpt=input.excerpt??post.excerpt;
  if(content.length>750000||excerpt.length>1000)throw new WorkspaceContentError("文章长度超限");
  const catId=input.category?await categoryId(workspaceId,input.category):post.categoryId;
  const spaceId=await workspaceSpace(userId,workspaceId,input.space,post.spaceId);
  const ids=await checkAttachmentReferences(workspaceId,content,post.id);
  const newSlug=input.slug&&input.slug!==post.slug
    ? (workspaceId===1&&userId===1&&spaceId===null?safeSlug(input.slug):"w"+workspaceId+"-"+safeSlug(input.slug).slice(0,60)+"-"+crypto.randomUUID().slice(0,8))
    : post.slug;
  const order=input.sortOrder??post.sortOrder;
  if(!Number.isSafeInteger(order))throw new WorkspaceContentError("排序无效");
  const statements=[];
  if(post.slug!==newSlug)statements.push(env.DB.prepare("INSERT OR IGNORE INTO post_slug_history(post_id,slug) SELECT id,slug FROM posts WHERE id=? AND workspace_id=? AND version=?").bind(post.id,workspaceId,post.version));
  statements.push(env.DB.prepare("UPDATE posts SET title=?,slug=?,excerpt=?,content=?,category_id=?,space_id=?,sort_order=?,featured=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND workspace_id=? AND version=? AND EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND status='active' AND role IN('owner','admin','editor')) RETURNING id")
    .bind(title,newSlug,excerpt,content,catId,spaceId,order,input.featured===undefined?post.featured:input.featured?1:0,userId,post.id,workspaceId,post.version,workspaceId,userId));
  const updateIndex=statements.length-1;
  statements.push(env.DB.prepare("INSERT INTO mcp_activity(workspace_id,action,post_id,public_id,title,before_status,after_status,changed_fields,summary,client_label) SELECT workspace_id,'update_post',id,public_id,title,status,status,'[]',?,? FROM posts WHERE id=? AND version=? AND workspace_id=? AND changes()=1").bind(summary,clientLabel,post.id,post.version+1,workspaceId));
  const results=await env.DB.batch(statements);
  if(!results[updateIndex]?.results?.length)throw new WorkspaceContentError("版本冲突或权限已变化",409);
  if(ids.length)await env.DB.batch(ids.map(att=>attachSql(post.id,workspaceId,att)));
  return scopedPost(userId,workspaceId,post.id);
}
export async function scopedStatusChange(userId:number,workspaceId:number,identifier:string,version:number,status:Status,clientLabel:string,summary:string) {
  await workspaceGrant(userId,workspaceId,"write");
  const post=await scopedPost(userId,workspaceId,identifier);
  if(post.version!==version)throw new WorkspaceContentError("版本已变化，请重新读取全文",409);
  if(post.status===status)return post;
  const action=status==="published"?"publish_post":"unpublish_post";
  const update=env.DB.prepare("UPDATE posts SET status=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END,updated_at=CURRENT_TIMESTAMP,updated_by=?,version=version+1 WHERE id=? AND workspace_id=? AND version=? AND EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND user_id=? AND status='active' AND role IN('owner','admin','editor')) RETURNING id")
    .bind(status,status,new Date().toISOString(),userId,post.id,workspaceId,version,workspaceId,userId);
  const audit=env.DB.prepare("INSERT INTO mcp_activity(workspace_id,action,post_id,public_id,title,before_status,after_status,changed_fields,summary,client_label) SELECT workspace_id,?,id,public_id,title,?,status,'[\"status\"]',?,? FROM posts WHERE id=? AND workspace_id=? AND version=? AND changes()=1")
    .bind(action,post.status,summary,clientLabel,post.id,workspaceId,version+1);
  const results=await env.DB.batch([update,audit]);
  if(!results[0]?.results?.length)throw new WorkspaceContentError("版本冲突或权限已变化",409);
  return scopedPost(userId,workspaceId,post.id);
}
export async function scopedActivity(userId:number,workspaceId:number,limit=20) {
  await workspaceGrant(userId,workspaceId);
  const rows=await env.DB.prepare("SELECT id,action,post_id AS postId,title,summary,client_label AS clientLabel,created_at AS createdAt FROM mcp_activity WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT ?")
    .bind(workspaceId,Math.min(50,Math.max(1,limit))).all();
  return rows.results??[];
}

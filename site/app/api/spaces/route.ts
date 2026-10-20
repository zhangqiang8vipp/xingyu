import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { newScopedSpace, WorkspaceContentError } from "@/db/workspace-content";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { identityFromRequest } from "@/server/auth/identity-session";
import { apiJson, readJson } from "@/server/workspace-http";
import { createSpace, getSpaceRootStats, listSpaceChildren, searchSpaces, SpaceWriteError } from "@/db/spaces";

type PersonalSpaceRow = {
  id:number; parentId:number|null; name:string; slug:string; sortOrder:number;
  createdAt:string; updatedAt:string;
};
type PersonalPostCount = { spaceId:number; articleCount:number; latestActivityAt:string|null };

async function personalTree(workspaceId:number,userId:number) {
  const [spaceResult,postResult] = await Promise.all([
    env.DB.prepare(
      "SELECT id,parent_id AS parentId,name,slug,sort_order AS sortOrder,created_at AS createdAt,updated_at AS updatedAt " +
      "FROM spaces WHERE workspace_id=? ORDER BY sort_order,name COLLATE NOCASE,id LIMIT 2001",
    ).bind(workspaceId).all<PersonalSpaceRow>(),
    env.DB.prepare(
      "SELECT space_id AS spaceId,COUNT(*) AS articleCount,MAX(updated_at) AS latestActivityAt " +
      "FROM posts WHERE workspace_id=? AND space_id IS NOT NULL " +
      "AND (author_id=? OR created_by=? OR (author_id IS NULL AND created_by IS NULL)) GROUP BY space_id",
    ).bind(workspaceId,userId,userId).all<PersonalPostCount>(),
  ]);
  const rows=spaceResult.results??[];
  if(rows.length>2000)throw new Error("个人知识空间节点超出读取上限");
  const counts=new Map((postResult.results??[]).map(row=>[row.spaceId,{count:Number(row.articleCount),latest:row.latestActivityAt}]));
  const byId=new Map(rows.map(row=>[row.id,row]));
  const children=new Map<number|null,PersonalSpaceRow[]>();
  for(const row of rows){
    const key=row.parentId;
    const group=children.get(key)??[];
    group.push(row);children.set(key,group);
  }
  const memo=new Map<number,{total:number;latest:string}>();
  function totals(id:number,seen=new Set<number>()):{total:number;latest:string}{
    const cached=memo.get(id);if(cached)return cached;
    if(seen.has(id))return {total:0,latest:""};
    const node=byId.get(id);if(!node)return {total:0,latest:""};
    seen.add(id);
    const own=counts.get(id);
    let total=own?.count??0;
    let latest=[node.updatedAt,own?.latest??""].filter(Boolean).sort().at(-1)??node.updatedAt;
    for(const child of children.get(id)??[]){
      const sub=totals(child.id,seen);total+=sub.total;
      if(sub.latest>latest)latest=sub.latest;
    }
    seen.delete(id);
    const value={total,latest};memo.set(id,value);return value;
  }
  function pathFor(id:number):Array<{id:number;name:string}>{
    const out:Array<{id:number;name:string}>=[];const seen=new Set<number>();let row=byId.get(id);
    while(row&&!seen.has(row.id)){seen.add(row.id);out.unshift({id:row.id,name:row.name});row=row.parentId===null?undefined:byId.get(row.parentId);}
    return out;
  }
  function shape(row:PersonalSpaceRow){
    const own=counts.get(row.id);
    const childRows=children.get(row.id)??[];
    const total=totals(row.id);
    return {
      id:row.id,parentId:row.parentId,name:row.name,slug:row.slug,sortOrder:row.sortOrder,
      createdAt:row.createdAt,updatedAt:row.updatedAt,childCount:childRows.length,
      articleCount:own?.count??0,totalArticleCount:total.total,latestActivityAt:total.latest,
      childPreview:childRows.slice(0,3).map(item=>item.name).join(" · ")||null,path:pathFor(row.id),
    };
  }
  return {rows,children,shape,pathFor,totals,counts};
}

export async function GET(request:Request){
  if(await isAdminRequest(request)){
    const url=new URL(request.url);
    const query=url.searchParams.get("q")?.trim()??"";
    if(query){
      const rootId=Number(url.searchParams.get("root"));
      const rawScope=url.searchParams.get("scope");
      const scope=rawScope==="current"||rawScope==="descendants"?rawScope:"all";
      return Response.json({spaces:await searchSpaces(query,20,{rootId:rootId>0?rootId:undefined,scope})});
    }
    const rawParent=url.searchParams.get("parent");
    const parentId=rawParent&&rawParent!=="root"?Number(rawParent):null;
    const spaces=await listSpaceChildren(Number.isInteger(parentId)?parentId:null);
    return Response.json({spaces,...(parentId===null?{meta:await getSpaceRootStats()}:{})});
  }
  const user=await identityFromRequest(request);
  if(!user||user.userId===1)return unauthorized();
  try{
    await ensureDatabase();
    const workspaceId=await ensurePersonalWorkspace(user.userId);
    const url=new URL(request.url);
    const query=(url.searchParams.get("q")??"").trim().slice(0,120).toLocaleLowerCase();
    const rawParent=url.searchParams.get("parent");
    const parentId=rawParent&&rawParent!=="root"?Number(rawParent):null;
    if(rawParent&&rawParent!=="root"&&!(Number.isSafeInteger(parentId)&&Number(parentId)>0))return apiJson({error:"空间不存在"},404);
    const tree=await personalTree(workspaceId,user.userId);
    if(query){
      const root=Number(url.searchParams.get("root"));
      const scope=url.searchParams.get("scope")??"all";
      const matches=tree.rows.filter(row=>{
        const path=tree.pathFor(row.id);
        if(!path.some(item=>(item.name+" "+row.slug).toLocaleLowerCase().includes(query)))return false;
        if(root>0){
          const underRoot=path.some(item=>item.id===root);
          if(!underRoot)return false;
          if(scope==="current"&&row.id!==root)return false;
        }
        return true;
      }).slice(0,20).map(row=>tree.shape(row));
      return apiJson({spaces:matches});
    }
    const result=(tree.children.get(parentId)??[]).map(row=>tree.shape(row));
    const meta=parentId===null?{
      rootCount:result.length,
      spaceCount:tree.rows.length,
      articleCount:result.reduce((sum,row)=>sum+row.totalArticleCount,0),
    }:undefined;
    return apiJson({spaces:result,...(meta?{meta}:{})});
  }catch(error){
    if(error instanceof WorkspaceContentError)return apiJson({error:error.message},error.status);
    console.error("personal.spaces.list.failed",error instanceof Error?error.name:"unknown");
    return apiJson({error:"个人知识空间暂时不可用"},500);
  }
}

export async function POST(request:Request){
  if(await isAdminRequest(request)){
    try{
      const payload=await request.json() as Record<string,unknown>;
      const space=await createSpace({
        name:String(payload.name??""),
        slug:payload.slug?String(payload.slug):undefined,
        parentId:Number(payload.parentId)>0?Number(payload.parentId):null,
        sortOrder:payload.sortOrder===undefined?0:Number(payload.sortOrder),
      });
      return Response.json({space},{status:201});
    }catch(error){
      if(error instanceof SpaceWriteError)return Response.json({error:error.message},{status:error.status});
      return Response.json({error:"空间创建失败"},{status:500});
    }
  }
  if(request.headers.get("origin")!==new URL(request.url).origin)return apiJson({error:"无效请求来源"},403);
  const user=await identityFromRequest(request);
  if(!user||user.userId===1)return unauthorized();
  try{
    const body=await readJson(request) as Record<string,unknown>;
    const workspaceId=await ensurePersonalWorkspace(user.userId);
    const space=await newScopedSpace(user.userId,workspaceId,{
      name:String(body.name??""),
      parentId:Number(body.parentId)>0?Number(body.parentId):null,
      sortOrder:body.sortOrder===undefined?0:Number(body.sortOrder),
    });
    return apiJson({space},201);
  }catch(error){
    if(error instanceof WorkspaceContentError)return apiJson({error:error.message},error.status);
    console.error("personal.spaces.create.failed",error instanceof Error?error.name:"unknown");
    return apiJson({error:"空间创建失败"},500);
  }
}

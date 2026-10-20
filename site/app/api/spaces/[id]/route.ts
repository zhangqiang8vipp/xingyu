import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { editScopedSpace, removeEmptyScopedSpace, WorkspaceContentError } from "@/db/workspace-content";
import { identityFromRequest } from "@/server/auth/identity-session";
import { apiJson, readJson } from "@/server/workspace-http";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { deleteSpace, getSpaceOverview, SpaceWriteError, updateSpace } from "@/db/spaces";

type SpaceRow={id:number;parentId:number|null;name:string;slug:string;sortOrder:number;createdAt:string;updatedAt:string};
type CountRow={spaceId:number;articleCount:number;latestActivityAt:string|null};

async function personalOverview(workspaceId:number,userId:number,spaceId:number){
  const [spaceResult,countResult]=await Promise.all([
    env.DB.prepare("SELECT id,parent_id AS parentId,name,slug,sort_order AS sortOrder,created_at AS createdAt,updated_at AS updatedAt FROM spaces WHERE workspace_id=? ORDER BY sort_order,name COLLATE NOCASE,id LIMIT 2001")
      .bind(workspaceId).all<SpaceRow>(),
    env.DB.prepare("SELECT space_id AS spaceId,COUNT(*) AS articleCount,MAX(updated_at) AS latestActivityAt FROM posts WHERE workspace_id=? AND space_id IS NOT NULL AND (author_id=? OR created_by=? OR (author_id IS NULL AND created_by IS NULL)) GROUP BY space_id")
      .bind(workspaceId,userId,userId).all<CountRow>(),
  ]);
  const rows=spaceResult.results??[];
  if(rows.length>2000)throw new WorkspaceContentError("个人知识空间节点超出读取上限",403);
  const byId=new Map(rows.map(row=>[row.id,row]));
  const children=new Map<number|null,SpaceRow[]>();
  for(const row of rows){const list=children.get(row.parentId)??[];list.push(row);children.set(row.parentId,list);}
  const counts=new Map((countResult.results??[]).map(row=>[row.spaceId,{count:Number(row.articleCount),latest:row.latestActivityAt??""}]));
  const current=byId.get(spaceId);
  if(!current)return null;
  function pathFor(id:number){
    const path:Array<{id:number;name:string}>=[];const seen=new Set<number>();let row=byId.get(id);
    while(row&&!seen.has(row.id)){seen.add(row.id);path.unshift({id:row.id,name:row.name});row=row.parentId===null?undefined:byId.get(row.parentId);}
    return path;
  }
  function descendants(id:number,seen=new Set<number>()):number[]{
    if(seen.has(id))return [];seen.add(id);
    return [id,...(children.get(id)??[]).flatMap(child=>descendants(child.id,seen))];
  }
  function shape(row:SpaceRow){
    const childRows=children.get(row.id)??[];
    const subtree=descendants(row.id);
    const total=subtree.reduce((sum,id)=>sum+(counts.get(id)?.count??0),0);
    const latest=[row.updatedAt,...subtree.map(id=>counts.get(id)?.latest??"")].filter(Boolean).sort().at(-1)??row.updatedAt;
    return {
      id:row.id,parentId:row.parentId,name:row.name,slug:row.slug,sortOrder:row.sortOrder,
      createdAt:row.createdAt,updatedAt:row.updatedAt,childCount:childRows.length,
      articleCount:counts.get(row.id)?.count??0,totalArticleCount:total,latestActivityAt:latest,
      childPreview:childRows.slice(0,3).map(item=>item.name).join(" · ")||null,path:pathFor(row.id),
    };
  }
  const sub=descendants(spaceId);
  return {
    ...shape(current),
    children:(children.get(spaceId)??[]).map(shape),
    descendantCount:Math.max(0,sub.length-1),
    articleCount:sub.reduce((sum,id)=>sum+(counts.get(id)?.count??0),0),
  };
}

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  if(await isAdminRequest(request)){
    const {id}=await params;
    const space=await getSpaceOverview(Number(id));
    return space?Response.json({space}):Response.json({error:"空间不存在"},{status:404});
  }
  const user=await identityFromRequest(request);
  if(!user||user.userId===1)return unauthorized();
  try{
    await ensureDatabase();
    const {id}=await params;const spaceId=Number(id);
    if(!Number.isSafeInteger(spaceId)||spaceId<1)return apiJson({error:"空间不存在"},404);
    const workspaceId=await ensurePersonalWorkspace(user.userId);
    const space=await personalOverview(workspaceId,user.userId,spaceId);
    return space?apiJson({space}):apiJson({error:"空间不存在"},404);
  }catch(error){
    if(error instanceof WorkspaceContentError)return apiJson({error:error.message},error.status);
    console.error("personal.space.read.failed",error instanceof Error?error.name:"unknown");
    return apiJson({error:"空间读取失败"},500);
  }
}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  if(request.headers.get("origin")!==new URL(request.url).origin)return apiJson({error:"无效请求来源"},403);
  if(await isAdminRequest(request)){
    try{
      const {id}=await params;const payload=await request.json() as Record<string,unknown>;
      const space=await updateSpace(Number(id),{
        name:payload.name===undefined?undefined:String(payload.name),
        slug:payload.slug===undefined?undefined:String(payload.slug),
        parentId:payload.parentId===undefined?undefined:Number(payload.parentId)>0?Number(payload.parentId):null,
        sortOrder:payload.sortOrder===undefined?undefined:Number(payload.sortOrder),
      });
      return Response.json({space});
    }catch(error){
      if(error instanceof SpaceWriteError)return Response.json({error:error.message},{status:error.status});
      return Response.json({error:"空间更新失败"},{status:500});
    }
  }
  const user=await identityFromRequest(request);
  if(!user||user.userId===1)return unauthorized();
  try{
    const {id}=await params;const spaceId=Number(id);
    const body=await readJson(request) as Record<string,unknown>;
    const workspaceId=await ensurePersonalWorkspace(user.userId);
    await editScopedSpace(user.userId,workspaceId,spaceId,{
      name:body.name===undefined?undefined:String(body.name),
      parentId:body.parentId===undefined?undefined:Number(body.parentId)>0?Number(body.parentId):null,
      sortOrder:body.sortOrder===undefined?undefined:Number(body.sortOrder),
    });
    const space=await personalOverview(workspaceId,user.userId,spaceId);
    return space?apiJson({space}):apiJson({error:"空间不存在"},404);
  }catch(error){
    if(error instanceof WorkspaceContentError)return apiJson({error:error.message},error.status);
    console.error("personal.space.update.failed",error instanceof Error?error.name:"unknown");
    return apiJson({error:"空间更新失败"},500);
  }
}

export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
  if(request.headers.get("origin")!==new URL(request.url).origin)return apiJson({error:"无效请求来源"},403);
  if(await isAdminRequest(request)){
    try{
      const {id}=await params;const payload=await request.json().catch(()=>({})) as Record<string,unknown>;
      const mode=payload.mode==="move"||payload.mode==="recursive"?payload.mode:"empty";
      return Response.json(await deleteSpace(Number(id),{
        mode,moveTo:Number(payload.moveTo)>0?Number(payload.moveTo):null,
        confirmName:payload.confirmName?String(payload.confirmName):undefined,
      }));
    }catch(error){
      if(error instanceof SpaceWriteError)return Response.json({error:error.message},{status:error.status});
      return Response.json({error:"空间删除失败"},{status:500});
    }
  }
  const user=await identityFromRequest(request);
  if(!user||user.userId===1)return unauthorized();
  try{
    const {id}=await params;const payload=await request.json().catch(()=>({})) as Record<string,unknown>;
    const mode=payload.mode==="empty"||payload.mode===undefined?"empty":String(payload.mode);
    if(mode!=="empty")return apiJson({error:"个人知识空间只允许删除空空间；请先移动文章和子空间"},403);
    const workspaceId=await ensurePersonalWorkspace(user.userId);
    await removeEmptyScopedSpace(user.userId,workspaceId,Number(id));
    return apiJson({ok:true});
  }catch(error){
    if(error instanceof WorkspaceContentError)return apiJson({error:error.message},error.status);
    console.error("personal.space.delete.failed",error instanceof Error?error.name:"unknown");
    return apiJson({error:"空间删除失败"},500);
  }
}

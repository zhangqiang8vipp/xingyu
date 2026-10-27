import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { invitedSpacePosts } from "@/db/invited-space-view";
import { identityFromRequest } from "@/server/auth/identity-session";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { apiJson } from "@/server/workspace-http";
import { getSpace, listSpacePosts } from "@/db/spaces";
import { spacePathSql } from "@/db/space-path-sql";

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  if(await isAdminRequest(request)){
    const {id}=await params;
    const spaceId=Number(id);
    if(!(await getSpace(spaceId)))return Response.json({error:"空间不存在"},{status:404});
    const url=new URL(request.url);
    return Response.json(await listSpacePosts({
      spaceId,
      allSpaces:url.searchParams.get("scope")==="all",
      includeDescendants:url.searchParams.get("scope")==="descendants",
      query:url.searchParams.get("q")??"",
      cursor:url.searchParams.get("cursor")??undefined,
      limit:Number(url.searchParams.get("limit"))||20,
    }));
  }
  const user=await identityFromRequest(request);
  if(!user||user.userId===1)return unauthorized();
  try{
    await ensureDatabase();
    const {id}=await params;
    const spaceId=Number(id);
    if(!Number.isSafeInteger(spaceId)||spaceId<1)return apiJson({error:"空间不存在"},404);
    const workspaceId=await ensurePersonalWorkspace(user.userId);
    const space=await env.DB.prepare("SELECT id FROM spaces WHERE id=? AND workspace_id=?").bind(spaceId,workspaceId).first();
    if(!space){
      const shared=await invitedSpacePosts(user.userId,spaceId,new URL(request.url).searchParams);
      return shared?apiJson(shared):apiJson({error:"空间不存在"},404);
    }
    const url=new URL(request.url);
    const scope=url.searchParams.get("scope")==="all"?"all":url.searchParams.get("scope")==="current"?"current":"descendants";
    const query=(url.searchParams.get("q")??"").trim().slice(0,120);
    const cursorRaw=url.searchParams.get("cursor")??"0";
    const offset=/^\d+$/.test(cursorRaw)?Math.min(100000,Number(cursorRaw)):0;
    const limit=Math.min(50,Math.max(1,Number(url.searchParams.get("limit"))||20));
    const paramsSql:Array<string|number>=[];
    let tree:string;
    if(scope==="all"){
      tree="WITH RECURSIVE tree(id,order_path,visited) AS ("+
        "SELECT id,printf('%010d/',sort_order),printf('/%d/',id) FROM spaces WHERE workspace_id=? AND parent_id IS NULL "+
        "UNION ALL SELECT child.id,tree.order_path||printf('%010d/',child.sort_order),tree.visited||printf('%d/',child.id) "+
        "FROM spaces child JOIN tree ON child.parent_id=tree.id WHERE child.workspace_id=? AND instr(tree.visited,printf('/%d/',child.id))=0)";
      paramsSql.push(workspaceId,workspaceId);
    }else{
      tree="WITH RECURSIVE tree(id,order_path,visited) AS ("+
        "SELECT id,printf('%010d/',sort_order),printf('/%d/',id) FROM spaces WHERE id=? AND workspace_id=? "+
        "UNION ALL SELECT child.id,tree.order_path||printf('%010d/',child.sort_order),tree.visited||printf('%d/',child.id) "+
        "FROM spaces child JOIN tree ON child.parent_id=tree.id WHERE child.workspace_id=? AND instr(tree.visited,printf('/%d/',child.id))=0)";
      paramsSql.push(spaceId,workspaceId,workspaceId);
    }
    let where=" WHERE p.workspace_id=? AND (p.author_id=? OR p.created_by=? OR (p.author_id IS NULL AND p.created_by IS NULL))";
    paramsSql.push(workspaceId,user.userId,user.userId);
    if(scope==="current"){where+=" AND p.space_id=?";paramsSql.push(spaceId);}
    if(query){
      where+=" AND (p.title LIKE ? OR p.excerpt LIKE ? OR p.slug LIKE ?)";
      const needle="%"+query.replace(/[%_]/g,"")+"%";
      paramsSql.push(needle,needle,needle);
    }
    const result=await env.DB.prepare(
      tree+" SELECT p.id,p.public_id AS publicId,p.title,p.slug,p.excerpt,p.status,p.featured,p.view_count AS viewCount,"+
      "p.published_at AS publishedAt,p.updated_at AS updatedAt,p.category_id AS categoryId,c.name AS categoryName,"+
      "c.color AS categoryColor,p.space_id AS spaceId,p.sort_order AS sortOrder,"+spacePathSql+" AS spacePath "+
      "FROM posts p JOIN tree t ON t.id=p.space_id LEFT JOIN categories c ON c.id=p.category_id AND c.workspace_id=p.workspace_id"+
      where+" ORDER BY t.order_path,p.sort_order,p.id LIMIT ? OFFSET ?",
    ).bind(...paramsSql,limit+1,offset).all<{id:number;publicId:string;title:string;slug:string;excerpt:string;status:"draft"|"published";featured:number;viewCount:number;publishedAt:string|null;updatedAt:string;categoryId:number;categoryName:string|null;categoryColor:string|null;spaceId:number;sortOrder:number;spacePath:string}>();
    const all=result.results??[];
    const hasMore=all.length>limit;
    return apiJson({rows:all.slice(0,limit).map(row=>({...row,featured:Boolean(row.featured)})),nextCursor:hasMore?String(offset+limit):null});
  }catch(error){
    console.error("personal.space.posts.failed",error instanceof Error?error.name:"unknown");
    return apiJson({error:"空间文章读取失败"},500);
  }
}

import { env } from "cloudflare:workers";
import { listInvitedSpaceNavigation } from "@/db/space-collaboration";

type InvitationNode=Awaited<ReturnType<typeof listInvitedSpaceNavigation>>[number];
type Aggregate={spaceId:number;articleCount:number;latestActivityAt:string|null};
type PostRow={
  id:number;publicId:string;title:string;slug:string;excerpt:string;
  status:"draft"|"published";categoryName:string|null;updatedAt:string;
  spaceId:number;sortOrder:number;
};

export type InvitedSpaceShape={
  id:number;parentId:number|null;name:string;slug:string;sortOrder:number;
  createdAt:string;updatedAt:string;childCount:number;articleCount:number;
  totalArticleCount:number;latestActivityAt:string;childPreview:string|null;
  path:Array<{id:number;parentId:number|null;name:string;slug:string}>;
  isInvited:true;ancestorOnly:boolean;canRead:boolean;canWrite:boolean;
  canManage:boolean;role:string|null;workspaceId:number;
};

export async function invitedSpaceTree(userId:number){
  const rows=await listInvitedSpaceNavigation(userId);
  const nodes=new Map(rows.map(row=>[row.id,row]));
  const children=new Map<number|null,InvitationNode[]>();
  for(const row of rows){
    const parent=nodes.has(row.parentId??-1)?row.parentId:null;
    const group=children.get(parent)??[];
    group.push(row);children.set(parent,group);
  }
  const permitted=rows.filter(row=>row.canRead);
  const counts=new Map<number,Aggregate>();
  // All queries are scoped to actual readable space IDs; no ancestor content.
  for(let start=0;start<permitted.length;start+=75){
    const chunk=permitted.slice(start,start+75);
    const values=chunk.map(row=>row.id);
    const result=await env.DB.prepare(
      "SELECT space_id AS spaceId,COUNT(*) AS articleCount,MAX(updated_at) AS latestActivityAt "+
      "FROM posts WHERE space_id IN ("+values.map(()=>"?").join(",")+") GROUP BY space_id",
    ).bind(...values).all<Aggregate>();
    for(const item of result.results??[])counts.set(item.spaceId,item);
  }
  const paths=new Map<number,InvitedSpaceShape["path"]>();
  function path(id:number){
    const cached=paths.get(id);if(cached)return cached;
    const result:InvitedSpaceShape["path"]=[];
    const seen=new Set<number>();
    let next=nodes.get(id);
    while(next&&!seen.has(next.id)){
      seen.add(next.id);
      result.unshift({id:next.id,parentId:next.parentId,name:next.name,slug:""});
      next=next.parentId===null?undefined:nodes.get(next.parentId);
    }
    paths.set(id,result);
    return result;
  }
  function descendants(id:number,seen=new Set<number>()):number[]{
    if(seen.has(id))return [];
    seen.add(id);
    const all=[id];
    for(const child of children.get(id)??[])all.push(...descendants(child.id,seen));
    return all;
  }
  function shape(id:number):InvitedSpaceShape{
    const row=nodes.get(id);
    if(!row)throw Error("Invited node no longer available");
    const visibleChildren=children.get(id)??[];
    const direct=row.canRead?counts.get(row.id):undefined;
    const subtree=row.canRead?descendants(id):[]; // Ancestry cannot grant document discovery.
    const total=subtree.reduce((n,item)=>n+(nodes.get(item)?.canRead?counts.get(item)?.articleCount??0:0),0);
    return {
      id:row.id,parentId:row.parentId,name:row.name,slug:"",sortOrder:row.sortOrder,
      createdAt:row.canRead?row.updatedAt:"",updatedAt:row.canRead?row.updatedAt:"",
      childCount:visibleChildren.length,articleCount:direct?.articleCount??0,
      totalArticleCount:total,latestActivityAt:direct?.latestActivityAt??"",
      childPreview:visibleChildren.slice(0,3).map(child=>child.name).join(" · ")||null,
      path:path(id),isInvited:true,ancestorOnly:row.ancestorOnly,
      canRead:row.canRead,canWrite:row.canWrite,canManage:row.canManage,role:row.role,
      workspaceId:row.workspaceId,
    };
  }
  return {nodes,children,shape,path,descendants,rows};
}

export async function invitedSpaceOverview(userId:number,spaceId:number){
  const tree=await invitedSpaceTree(userId);
  const current=tree.nodes.get(spaceId);
  if(!current)return null;
  const shape=tree.shape(spaceId);
  return {
    ...shape,
    children:(tree.children.get(spaceId)??[]).map(n=>tree.shape(n.id)),
    descendantCount:tree.descendants(spaceId).length-1,
    // A breadcrumb-only ancestor cannot disclose its children's document totals.
    articleCount:current.canRead?shape.totalArticleCount:0,
  };
}

export async function invitedSpacePosts(userId:number,spaceId:number,search:URLSearchParams){
  const tree=await invitedSpaceTree(userId);
  const target=tree.nodes.get(spaceId);
  if(!target)return null;
  if(!target.canRead)return {rows:[],nextCursor:null};
  const scope=search.get("scope")??"descendants";
  const ids=(scope==="current"?[spaceId]:tree.descendants(spaceId))
    .filter(id=>tree.nodes.get(id)?.canRead);
  if(!ids.length)return {rows:[],nextCursor:null};
  if(ids.length>300)throw new Error("邀请空间文章查询范围超出安全分页上限");
  const q=(search.get("q")??"").trim().slice(0,120);
  const rawCursor=search.get("cursor")??"0";
  const offset=/^\d+$/.test(rawCursor)?Math.min(100000,Number(rawCursor)):0;
  const limit=Math.min(50,Math.max(1,Number(search.get("limit"))||20));
  const argumentsSql:(string|number)[]=[target.workspaceId,...ids];
  let where="p.workspace_id=? AND p.space_id IN ("+ids.map(()=>"?").join(",")+")";
  if(q){
    where+=" AND (p.title LIKE ? OR p.content LIKE ?)";
    argumentsSql.push("%"+q+"%","%"+q+"%");
  }
  const data=await env.DB.prepare(
    "SELECT p.id,p.public_id AS publicId,p.title,p.slug,p.excerpt,p.status,"+
    "COALESCE(c.name,'默认分类') AS categoryName,p.updated_at AS updatedAt,"+
    "p.space_id AS spaceId,p.sort_order AS sortOrder "+
    "FROM posts p LEFT JOIN categories c ON c.id=p.category_id "+
    "WHERE "+where+" ORDER BY p.updated_at DESC,p.id DESC LIMIT ? OFFSET ?",
  ).bind(...argumentsSql,limit+1,offset).all<PostRow>();
  const list=data.results??[];
  return {
    rows:list.slice(0,limit).map(row=>({
      ...row,
      spacePath:tree.path(row.spaceId).map(n=>n.name).join(" / "),
    })),
    nextCursor:list.length>limit?String(offset+limit):null,
  };
}

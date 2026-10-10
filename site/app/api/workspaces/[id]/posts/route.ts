import { scopedCreateDraft,scopedPosts } from "@/db/workspace-content";
import { apiJson,readJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const q=new URL(request.url).searchParams;
    const size=Math.min(50,Math.max(1,Number(q.get("limit")??20)||20));
    const space=q.get("space_id");
    const spaceId=space===null?undefined:space==="null"?null:Number(space);
    return apiJson({posts:await scopedPosts(userId,workspaceId,(q.get("query")??"").slice(0,120),size,spaceId)});
  });
}
export async function POST(request:Request,{params}:Params){
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const body=await readJson(request) as {title?:string;content_markdown?:string;excerpt?:string;category?:string;space?:string|null};
    const post=await scopedCreateDraft(userId,workspaceId,{
      title:body.title??"",content:body.content_markdown,excerpt:body.excerpt,category:body.category,space:body.space,
    },"web:"+userId,"网页创建草稿");
    return apiJson({post},201);
  });
}

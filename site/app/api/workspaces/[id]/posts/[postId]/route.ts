import { scopedPost,scopedUpdatePost } from "@/db/workspace-content";
import { apiJson,readJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string;postId:string}>};
export async function GET(request:Request,{params}:Params){
  const {id,postId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>apiJson({post:await scopedPost(userId,workspaceId,postId)}));
}
export async function PATCH(request:Request,{params}:Params){
  const {id,postId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const b=await readJson(request) as {expected_version:number;title?:string;content_markdown?:string;excerpt?:string;space?:string|null;category?:string};
    const post=await scopedUpdatePost(userId,workspaceId,postId,{
      expectedVersion:b.expected_version,title:b.title,content:b.content_markdown,excerpt:b.excerpt,space:b.space,category:b.category,
    },"web:"+userId,"网页更新文章");
    return apiJson({post});
  });
}

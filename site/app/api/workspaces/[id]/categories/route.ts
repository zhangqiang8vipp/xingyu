import { scopedCategories } from "@/db/workspace-content";
import { apiJson, withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>apiJson({categories:await scopedCategories(userId,workspaceId)}));
}

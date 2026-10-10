import { listSharedMembers } from "@/db/workspace-collaboration";
import { apiJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params) {
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>
    apiJson({members:await listSharedMembers(userId,workspaceId)}));
}

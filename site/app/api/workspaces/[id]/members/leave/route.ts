import { leaveSharedWorkspace } from "@/db/workspace-collaboration";
import { apiJson } from "@/server/workspace-http";
import { withAccountRequest } from "@/server/collaboration-http";
type Params={params:Promise<{id:string}>};
export async function POST(request:Request,{params}:Params){
  const {id}=await params;
  return withAccountRequest(request,async userId=>{
    await leaveSharedWorkspace(userId,Number(id));
    return apiJson({ok:true});
  });
}

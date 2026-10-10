import { inviteToWorkspace,listPendingInvites } from "@/db/workspace-collaboration";
import { apiJson,readJson,withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params) {
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>
    apiJson({invitations:await listPendingInvites(userId,workspaceId)}));
}
export async function POST(request:Request,{params}:Params) {
  const {id}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const body=await readJson(request,4096) as {email?:unknown;role?:unknown};
    const invitation=await inviteToWorkspace(userId,workspaceId,
      typeof body.email==="string"?body.email:"",body.role,new URL(request.url).origin);
    return apiJson({invitation},201);
  });
}

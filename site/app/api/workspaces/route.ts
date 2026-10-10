import { currentIdentity } from "@/server/auth/identity";
import { listUserWorkspaces } from "@/db/workspace-access";
import { apiJson,readJson } from "@/server/workspace-http";
import { withAccountRequest } from "@/server/collaboration-http";
import { createSharedWorkspace } from "@/db/workspace-collaboration";
export async function GET(){
  const user=await currentIdentity();
  if(!user)return apiJson({error:"请先登录"},401);
  return apiJson({workspaces:await listUserWorkspaces(user.userId)});
}

export async function POST(request:Request) {
  return withAccountRequest(request,async userId=>{
    const body=await readJson(request,4096) as {name?:unknown};
    const workspace=await createSharedWorkspace(userId,typeof body.name==="string"?body.name:"");
    return apiJson({workspace},201);
  });
}

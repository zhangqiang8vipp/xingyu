import { currentIdentity } from "@/server/auth/identity";
import { listUserWorkspaces } from "@/db/workspace-access";
import { apiJson } from "@/server/workspace-http";
export async function GET(){
  const user=await currentIdentity();
  if(!user)return apiJson({error:"请先登录"},401);
  return apiJson({workspaces:await listUserWorkspaces(user.userId)});
}

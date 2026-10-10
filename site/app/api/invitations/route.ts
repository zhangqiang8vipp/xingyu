import { acceptInvitation,previewInvitation } from "@/db/workspace-collaboration";
import { apiJson,readJson } from "@/server/workspace-http";
import { withAccountRequest } from "@/server/collaboration-http";
export async function GET(request:Request) {
  return withAccountRequest(request,async userId=>{
    const token=new URL(request.url).searchParams.get("token")??"";
    return apiJson({invitation:await previewInvitation(userId,token)});
  });
}
export async function POST(request:Request) {
  return withAccountRequest(request,async userId=>{
    const data=await readJson(request,4096) as {token?:unknown};
    const token=typeof data.token==="string"?data.token:"";
    return apiJson({workspace:await acceptInvitation(userId,token)});
  });
}

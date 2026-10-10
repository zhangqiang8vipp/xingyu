import {acceptOrganizationInvitation,previewOrganizationInvitation} from "@/db/organization-invitations";
import {withAccountRequest} from "@/server/collaboration-http";
import {apiJson,readJson} from "@/server/workspace-http";
export async function GET(request:Request){
  return withAccountRequest(request,async userId=>
    apiJson({invitation:await previewOrganizationInvitation(userId,new URL(request.url).searchParams.get("token")??"")}));
}
export async function POST(request:Request){
  return withAccountRequest(request,async userId=>{
    const data=await readJson(request,4096) as {token?:unknown};
    return apiJson({organization:await acceptOrganizationInvitation(userId,typeof data.token==="string"?data.token:"")});
  });
}

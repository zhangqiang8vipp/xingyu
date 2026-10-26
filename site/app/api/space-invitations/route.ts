import { withSpaceRequest } from "@/server/space-collaboration-http";
import { apiJson,readJson } from "@/server/workspace-http";
import { previewSpaceInvitation,acceptSpaceInvitation } from "@/db/space-collaboration";
export async function GET(request:Request){
  return withSpaceRequest(request,async userId=>{
    const token=new URL(request.url).searchParams.get("token")??"";
    return apiJson({invitation:await previewSpaceInvitation(userId,token)});
  });
}
export async function POST(request:Request){
  return withSpaceRequest(request,async userId=>{
    const body=await readJson(request,2048) as {token?:string};
    return apiJson({result:await acceptSpaceInvitation(userId,body.token??"")});
  });
}

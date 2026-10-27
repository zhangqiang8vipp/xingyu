import { withSpaceRequest } from "@/server/space-collaboration-http";
import { apiJson,readJson } from "@/server/workspace-http";
import { listCollaborativePreviewLinks,createCollaborativePreviewLink,revokeCollaborativePreviewLink } from "@/db/space-collaboration";

type Params={params:Promise<{publicId:string}>};
export async function GET(request:Request,{params}:Params){
  const {publicId}=await params;
  return withSpaceRequest(request,async userId=>apiJson({links:await listCollaborativePreviewLinks(userId,publicId)}));
}
export async function POST(request:Request,{params}:Params){
  const {publicId}=await params;
  return withSpaceRequest(request,async userId=>{
    const body=await readJson(request,16000) as {lifetimeSeconds?:number};
    const created=await createCollaborativePreviewLink(userId,publicId,body.lifetimeSeconds??604800);
    return apiJson({link:created.link,url:new URL("/preview/"+created.token,request.url).toString()},201);
  });
}
export async function DELETE(request:Request,{params}:Params){
  const {publicId}=await params;
  return withSpaceRequest(request,async userId=>{
    const body=await readJson(request,16000) as {previewId?:number};
    return apiJson({result:await revokeCollaborativePreviewLink(userId,publicId,body.previewId??-1)});
  });
}

import { scopedAttachmentObject } from "@/db/workspace-media";
import { withWorkspace } from "@/server/workspace-http";
type Params={params:Promise<{id:string;publicId:string}>};
export async function GET(request:Request,{params}:Params){
  const {id,publicId}=await params;
  return withWorkspace(request,id,async({userId,workspaceId})=>{
    const {meta,object}=await scopedAttachmentObject(userId,workspaceId,publicId);
    const encoded=encodeURIComponent(meta.originalName);
    return new Response(object.body,{
      status:200,
      headers:{
        "Content-Type":meta.contentType,
        "Content-Length":String(meta.size),
        "Content-Disposition":(meta.contentType.startsWith("image/")?"inline":"attachment")+"; filename*=UTF-8''"+encoded,
        "Cache-Control":"private, no-store",
        "X-Content-Type-Options":"nosniff",
        "X-Robots-Tag":"noindex,nofollow",
      },
    });
  });
}

import { withSpaceRequest } from "@/server/space-collaboration-http";
import { apiJson,readJson } from "@/server/workspace-http";
import {
 getCollaborativeDocument,listDocumentRevisions,getDocumentRevision,listDocumentProposals,
 proposeDocumentChange,resolveDocumentProposal,restoreDocumentRevision,SpaceCollaborationError,
} from "@/db/space-collaboration";
type Params={params:Promise<{publicId:string}>};
export async function GET(request:Request,{params}:Params){
  const {publicId}=await params;
  return withSpaceRequest(request,async userId=>{
    const params=new URL(request.url).searchParams;
    if(params.has("revision"))return apiJson({revision:await getDocumentRevision(userId,publicId,Number(params.get("revision")))});
    if(params.has("history"))return apiJson({revisions:await listDocumentRevisions(userId,publicId)});
    if(params.has("proposals"))return apiJson({proposals:await listDocumentProposals(userId,publicId)});
    return apiJson({document:await getCollaborativeDocument(userId,publicId)});
  });
}
export async function PATCH(request:Request,{params}:Params){
  const {publicId}=await params;
  return withSpaceRequest(request,async userId=>{
    const input=await readJson(request,800000) as {baseVersion?:number;content?:string;summary?:string};
    const result=await proposeDocumentChange(userId,publicId,input.baseVersion??-1,
      input.content??"", "web:space-collaboration",input.summary);
    return apiJson({result},result.status==="conflict"?409:200);
  });
}
export async function POST(request:Request,{params}:Params){
  const {publicId}=await params;
  return withSpaceRequest(request,async userId=>{
    const body=await readJson(request,800000) as Record<string,unknown>;
    if(body.action==="resolve")
      return apiJson({result:await resolveDocumentProposal(userId,publicId,String(body.proposalId??""),
        Number(body.expectedVersion??-1),String(body.content??""),"web:space-collaboration")});
    if(body.action==="restore")
      return apiJson({result:await restoreDocumentRevision(userId,publicId,Number(body.revision??-1),
        Number(body.expectedVersion??-1),"web:space-collaboration")});
    throw new SpaceCollaborationError("操作类型无效");
  });
}

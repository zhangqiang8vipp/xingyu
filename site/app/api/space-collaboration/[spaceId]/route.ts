import { withSpaceRequest } from "@/server/space-collaboration-http";
import { apiJson, readJson } from "@/server/workspace-http";
import {
  spaceAccess,listCollaborativeDocuments,listCollaborativeChildren,listSpaceMembers,listSpaceInvitations,
  readSpaceInheritance,sendSpaceInvitation,revokeSpaceInvitation,setSpaceMemberRole,removeSpaceMember,
  setSpaceInheritance,createCollaborativeChildSpace,removeCollaborativeEmptySpace,createCollaborativeDocument,
  SpaceCollaborationError,
} from "@/db/space-collaboration";
type Params={params:Promise<{spaceId:string}>};
const numeric=(s:string)=>/^[1-9]\d{0,15}$/.test(s)?Number(s):-1;
export async function GET(request:Request,{params}:Params){
  const {spaceId}=await params,id=numeric(spaceId);
  return withSpaceRequest(request,async userId=>{
    const access=await spaceAccess(userId,id);
    const [documents,children]=await Promise.all([
      listCollaborativeDocuments(userId,id),listCollaborativeChildren(userId,id),
    ]);
    const management=access.canManage?await Promise.all([
      listSpaceMembers(userId,id),listSpaceInvitations(userId,id),readSpaceInheritance(userId,id),
    ]):null;
    return apiJson({access,documents,children,
      ...(management?{members:management[0],invitations:management[1],settings:management[2]}:{})});
  });
}
export async function POST(request:Request,{params}:Params){
  const {spaceId}=await params,id=numeric(spaceId);
  return withSpaceRequest(request,async userId=>{
    const data=await readJson(request,800000) as Record<string,unknown>;
    const string=(key:string)=>typeof data[key]==="string"?data[key] as string:"";
    const number=(key:string)=>typeof data[key]==="number"?data[key] as number:-1;
    let result:unknown;
    switch(data.action){
      case "invite":
        result=await sendSpaceInvitation(userId,id,string("email"),string("role"),new URL(request.url).origin);break;
      case "revoke_invite":
        result=await revokeSpaceInvitation(userId,id,number("invitationId"));break;
      case "set_role":
        result=await setSpaceMemberRole(userId,id,number("userId"),string("role"));break;
      case "remove_member":
        result=await removeSpaceMember(userId,id,number("userId"));break;
      case "set_inheritance":
        result=await setSpaceInheritance(userId,id,data.enabled as boolean);break;
      case "create_child":
        result=await createCollaborativeChildSpace(userId,id,string("name"));break;
      case "delete_empty":
        result=await removeCollaborativeEmptySpace(userId,id);break;
      case "create_document":
        result=await createCollaborativeDocument(userId,id,string("title"),string("content"),"web:space-collaboration");break;
      default:throw new SpaceCollaborationError("不支持的空间操作");
    }
    return apiJson({result},data.action==="invite"||data.action==="create_document"||data.action==="create_child"?201:200);
  });
}

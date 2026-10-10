import {inviteOrganizationMember,listOrganizationInvitations} from "@/db/organization-invitations";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>
    apiJson({invitations:await listOrganizationInvitations(userId,orgId)}));
}
export async function POST(request:Request,{params}:Params){
  const {id}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {email?:unknown;role?:unknown};
    return apiJson({invitation:await inviteOrganizationMember(userId,orgId,data.email,data.role,new URL(request.url).origin)},201);
  });
}

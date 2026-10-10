import {setTeamMember} from "@/db/team-workspaces";
import {withOrganization} from "@/server/organization-http";
import {apiJson,readJson} from "@/server/workspace-http";
type Params={params:Promise<{id:string;teamId:string}>};
export async function POST(request:Request,{params}:Params){
  const {id,teamId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {userId?:unknown};
    await setTeamMember(userId,orgId,Number(teamId),typeof data.userId==="number"?data.userId:-1,true);
    return apiJson({ok:true});
  });
}
export async function DELETE(request:Request,{params}:Params){
  const {id,teamId}=await params;
  return withOrganization(request,id,"manage",async({userId,orgId})=>{
    const data=await readJson(request,4096) as {userId?:unknown};
    await setTeamMember(userId,orgId,Number(teamId),typeof data.userId==="number"?data.userId:-1,false);
    return apiJson({ok:true});
  });
}

import { orgGrant, type OrganizationGrant } from "@/db/organization-access";
import { withAccountRequest } from "@/server/collaboration-http";
import { OrganizationError } from "@/db/organization-errors";

/** Organization permissions never stand in for workspace or content permissions. */
export function withOrganization(
  request:Request,
  rawId:string,
  action:"read"|"manage"|"owner",
  callback:(ctx:{userId:number;orgId:number;grant:OrganizationGrant})=>Promise<Response>,
) {
  return withAccountRequest(request,async userId=>{
    if(!/^[1-9]\d{0,15}$/.test(rawId))throw new OrganizationError("组织不存在",404);
    const orgId=Number(rawId);
    const grant=await orgGrant(userId,orgId,action);
    return callback({userId,orgId,grant});
  });
}

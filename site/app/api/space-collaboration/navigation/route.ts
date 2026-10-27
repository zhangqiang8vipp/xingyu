import { withSpaceRequest } from "@/server/space-collaboration-http";
import { apiJson } from "@/server/workspace-http";
import { listInvitedSpaceNavigation } from "@/db/space-collaboration";

/** Only an explicitly invited branch plus its name-only ancestors. */
export async function GET(request:Request){
  return withSpaceRequest(request,async userId=>apiJson({nodes:await listInvitedSpaceNavigation(userId)}));
}

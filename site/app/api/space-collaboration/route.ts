import { withSpaceRequest } from "@/server/space-collaboration-http";
import { apiJson } from "@/server/workspace-http";
import { listCollaborativeSpaces } from "@/db/space-collaboration";
export async function GET(request:Request){
  return withSpaceRequest(request,async userId=>apiJson({spaces:await listCollaborativeSpaces(userId)}));
}

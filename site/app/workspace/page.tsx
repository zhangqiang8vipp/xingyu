import { redirect } from "next/navigation";
import { currentIdentity } from "@/server/auth/identity";
import { listUserWorkspaces } from "@/db/workspace-access";
import ConsoleShell from "@/app/console/ConsoleShell";
import WorkspaceClient from "./WorkspaceClient";
import ConnectionsPanel from "./ConnectionsPanel";
import CollaborationPanel from "./CollaborationPanel";
export const dynamic="force-dynamic";
export default async function WorkspacePage(){
  const user=await currentIdentity();
  if(!user)redirect("/login");
  const workspaces=await listUserWorkspaces(user.userId);
  return <ConsoleShell area="workspace" userName={user.displayName} isLegacyAdmin={user.userId===1}>
    <WorkspaceClient initialWorkspaces={workspaces}/>
    <CollaborationPanel workspaces={workspaces}/>
    <ConnectionsPanel/>
  </ConsoleShell>;
}

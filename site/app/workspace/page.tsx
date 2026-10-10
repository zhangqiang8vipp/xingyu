import {redirect} from "next/navigation";
import {currentIdentity} from "@/server/auth/identity";
import {getSiteSettings} from "@/db/queries";
import {listUserWorkspaces} from "@/db/workspace-access";
import AdminAccountFrame from "@/features/admin/AdminAccountFrame";
import AccountStyleLoader from "@/features/admin/AccountStyleLoader";
import WorkspaceHub, {type WorkspaceView} from "./WorkspaceHub";

export const dynamic="force-dynamic";
export default async function WorkspacePage({searchParams}:{searchParams:Promise<{view?:string}>}){
  const requested=(await searchParams).view;
  const initialView:WorkspaceView=requested==="collaboration"||requested==="connections"?requested:"notes";
  const user=await currentIdentity();
  if(!user)redirect("/login");
  const [settings,workspaces]=await Promise.all([
    getSiteSettings(),listUserWorkspaces(user.userId),
  ]);
  return <><AccountStyleLoader/><AdminAccountFrame area="workspace" brandName={settings.brandName}
    userName={user.displayName} isLegacyAdmin={user.userId===1}>
    <WorkspaceHub workspaces={workspaces} initialView={initialView}/>
  </AdminAccountFrame></>;
}

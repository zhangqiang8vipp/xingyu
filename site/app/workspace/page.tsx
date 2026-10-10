import { redirect } from "next/navigation";
import Link from "next/link";
import { currentIdentity } from "@/server/auth/identity";
import { listUserWorkspaces } from "@/db/workspace-access";
import WorkspaceClient from "./WorkspaceClient";
import ConnectionsPanel from "./ConnectionsPanel";
export const dynamic="force-dynamic";
export default async function WorkspacePage(){
  const user=await currentIdentity();
  if(!user)redirect("/login");
  const workspaces=await listUserWorkspaces(user.userId);
  return <main style={{maxWidth:1040,margin:"40px auto",padding:"0 20px 80px"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap"}}>
      <div><small>XINGYU WORKSPACE</small><h1>我的知识空间</h1><p>{user.displayName} · 私人内容不会公开展示</p></div>
      <nav style={{display:"flex",gap:16,alignItems:"center"}}>
        {user.userId===1?<Link href="/admin">原写作后台</Link>:null}
        <Link href="/">返回博客</Link>
      </nav>
    </header>
    <WorkspaceClient initialWorkspaces={workspaces}/>
    <ConnectionsPanel/>
  </main>;
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { currentIdentity } from "@/server/auth/identity";
import { listMyOrganizations } from "@/db/organization-access";
import OrganizationsClient from "./OrganizationsClient";
export const dynamic="force-dynamic";
export default async function OrganizationsPage() {
  const user=await currentIdentity();
  if(!user)redirect("/login");
  const organizations=await listMyOrganizations(user.userId);
  return <main style={{maxWidth:1080,margin:"36px auto",padding:"0 20px 72px"}}>
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div><small>XINGYU ORGANIZATIONS</small><h1>组织与部门</h1>
        <p>{user.displayName} · 一个账号可加入多个组织。组织成员身份不自动授权任何工作区内容。</p></div>
      <nav style={{display:"flex",gap:14,alignItems:"center"}}>
        <Link href="/workspace">我的工作区</Link><Link href="/">返回博客</Link>
      </nav>
    </header>
    <OrganizationsClient initialOrganizations={organizations}/>
  </main>;
}

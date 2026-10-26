import {redirect} from "next/navigation";
import Link from "next/link";
import {currentIdentity} from "@/server/auth/identity";
import CollaborationClient from "./CollaborationClient";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false}};
export default async function CollaborationPage({searchParams}:{searchParams:Promise<{spaceId?:string}>}){
  if(!await currentIdentity())redirect("/login?return_to=/collaboration");
  const desired=Number((await searchParams).spaceId??0);
  return <main className="admin-shell" style={{display:"block",padding:"24px 18px",minHeight:"100vh"}}>
    <div style={{maxWidth:1200,margin:"0 auto"}}>
      <header style={{display:"flex",gap:15,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
        <div><small>XINGYU · COLLABORATION</small><h1 style={{margin:"6px 0"}}>知识空间多人 / AI 共创</h1>
          <p>独立邮箱邀请、子空间权限、Git 式版本提交、冲突复核。</p></div>
        <Link href="/admin">返回写作后台</Link>
      </header>
      <CollaborationClient initialSpaceId={Number.isSafeInteger(desired)&&desired>0?desired:0}/>
    </div>
  </main>;
}

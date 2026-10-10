import {redirect} from "next/navigation";
import {currentIdentity} from "@/server/auth/identity";
import AcceptInvite from "./AcceptInvite";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function InvitePage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))
    return <main style={{maxWidth:520,margin:"12vh auto",padding:24}}><h1>邀请链接无效</h1></main>;
  if(!await currentIdentity())
    redirect("/login?return_to="+encodeURIComponent("/invite?token="+token));
  return <main style={{maxWidth:520,margin:"12vh auto",padding:24}}>
    <small>XINGYU COLLABORATION</small><h1>加入共享工作区</h1>
    <p>请确认当前登录账号的邮箱与受邀邮箱一致。</p>
    <AcceptInvite token={token}/>
  </main>;
}

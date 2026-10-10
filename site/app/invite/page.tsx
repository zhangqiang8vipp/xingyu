import {redirect} from "next/navigation";
import {currentIdentity} from "@/server/auth/identity";
import AuthShell from "@/app/console/AuthShell";
import AcceptInvite from "./AcceptInvite";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function InvitePage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))
    return <AuthShell title="邀请链接无效" description="该邀请链接格式不正确，请联系工作区管理员重新发送。"><p>如需继续使用星屿，请返回登录页面。</p></AuthShell>;
  if(!await currentIdentity())
    redirect("/login?return_to="+encodeURIComponent("/invite?token="+token));
  return <AuthShell eyebrow="XINGYU COLLABORATION" title="加入共享工作区" description="请确认当前登录账号的邮箱与受邀邮箱一致。">
    <AcceptInvite token={token}/>
  </AuthShell>;
}

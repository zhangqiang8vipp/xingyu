import {redirect} from "next/navigation";
import {currentIdentity} from "@/server/auth/identity";
import AuthShell from "@/app/console/AuthShell";
import AcceptOrganizationInvitation from "./AcceptOrganizationInvitation";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function OrganizationInvitePage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))
    return <AuthShell title="组织邀请链接无效" description="该组织邀请链接格式不正确，请联系组织管理员重新发送。"><p>如需继续使用星屿，请返回登录页面。</p></AuthShell>;
  if(!await currentIdentity())
    redirect("/login?return_to="+encodeURIComponent("/organization-invite?token="+token));
  return <AuthShell eyebrow="XINGYU ORGANIZATIONS" title="接受组织邀请" description="只有受邀邮箱绑定的已验证星屿账号才能接受邀请。">
    <AcceptOrganizationInvitation token={token}/>
  </AuthShell>;
}

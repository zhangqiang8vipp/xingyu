import {redirect} from "next/navigation";
import {currentIdentity} from "@/server/auth/identity";
import IdentityAdminPanel from "@/features/admin/IdentityAdminPanel";
import AcceptOrganizationInvitation from "./AcceptOrganizationInvitation";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function OrganizationInvitePage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))
    return <IdentityAdminPanel eyebrow="XINGYU ORGANIZATIONS" title="组织邀请链接无效" description="请联系组织管理员重新发送邀请。"><p>邀请链接格式不正确。</p></IdentityAdminPanel>;
  if(!await currentIdentity())redirect("/login?return_to="+encodeURIComponent("/organization-invite?token="+token));
  return <IdentityAdminPanel eyebrow="XINGYU ORGANIZATIONS" title="接受组织邀请" description="仅受邀邮箱绑定的已验证星屿账号能接受此邀请。">
    <AcceptOrganizationInvitation token={token}/>
  </IdentityAdminPanel>;
}

import {redirect} from "next/navigation";
import {currentIdentity} from "@/server/auth/identity";
import AcceptOrganizationInvitation from "./AcceptOrganizationInvitation";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function OrganizationInvitePage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))
    return <main style={{maxWidth:540,margin:"12vh auto",padding:24}}><h1>组织邀请链接无效</h1></main>;
  if(!await currentIdentity())redirect("/login?return_to="+encodeURIComponent("/organization-invite?token="+token));
  return <main style={{maxWidth:540,margin:"12vh auto",padding:24}}>
    <small>XINGYU ORGANIZATIONS</small><h1>接受组织邀请</h1>
    <p>仅受邀邮箱绑定的已验证星屿账号能接受此邀请。</p>
    <AcceptOrganizationInvitation token={token}/>
  </main>;
}

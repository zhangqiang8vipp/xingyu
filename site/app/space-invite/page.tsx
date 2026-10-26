import {redirect} from "next/navigation";
import {currentIdentity} from "@/server/auth/identity";
import IdentityAdminPanel from "@/features/admin/IdentityAdminPanel";
import AcceptSpaceInvitation from "./AcceptSpaceInvitation";
export const dynamic="force-dynamic";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function SpaceInvitePage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))
    return <IdentityAdminPanel title="知识空间邀请无效" description="请联系邀请人重新发送。" eyebrow="XINGYU COLLABORATION"><p>邀请令牌格式不正确。</p></IdentityAdminPanel>;
  if(!await currentIdentity())redirect("/login?return_to="+encodeURIComponent("/space-invite?token="+token));
  return <IdentityAdminPanel title="加入协作知识空间" description="只有收到邀请邮件的已验证账号可以加入。" eyebrow="XINGYU COLLABORATION">
    <AcceptSpaceInvitation token={token}/>
  </IdentityAdminPanel>;
}

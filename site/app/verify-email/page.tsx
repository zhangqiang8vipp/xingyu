import Link from "next/link";
import IdentityAdminPanel from "@/features/admin/IdentityAdminPanel";
import VerifyEmailAction from "./VerifyEmailAction";
export const dynamic="force-dynamic";
export default async function VerifyEmailPage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  return <IdentityAdminPanel title="验证邮箱" description="确认这是你本人发起的注册操作后，点击下方按钮完成验证。">
    <VerifyEmailAction token={token}/>
    <p><Link href="/login">前往登录</Link></p>
  </IdentityAdminPanel>;
}

import Link from "next/link";
import AuthShell from "@/app/console/AuthShell";
import VerifyEmailAction from "./VerifyEmailAction";
export const dynamic="force-dynamic";
export default async function VerifyEmailPage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  return <AuthShell title="验证邮箱" description="确认是你本人发起的注册操作后，完成邮箱验证，即可进入个人知识空间。">
    <VerifyEmailAction token={token}/>
    <p className="xy-auth-links"><Link href="/login">前往登录</Link></p>
  </AuthShell>;
}

import Link from "next/link";
import IdentityAdminPanel from "@/features/admin/IdentityAdminPanel";
import ForgotPasswordForm from "./ForgotPasswordForm";
export default function ForgotPasswordPage(){
  return <IdentityAdminPanel title="找回密码" description="请输入已注册的邮箱。验证邮件将在 30 分钟内有效。">
    <ForgotPasswordForm/>
    <p><Link href="/login">返回登录</Link></p>
  </IdentityAdminPanel>;
}

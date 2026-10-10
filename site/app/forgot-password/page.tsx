import Link from "next/link";
import AuthShell from "@/app/console/AuthShell";
import ForgotPasswordForm from "./ForgotPasswordForm";
export default function ForgotPasswordPage(){
  return <AuthShell title="找回密码" description="输入已注册的邮箱，我们将发送一个 30 分钟内有效的重置链接。">
    <ForgotPasswordForm/>
    <p className="xy-auth-links"><Link href="/login">返回登录</Link></p>
  </AuthShell>;
}

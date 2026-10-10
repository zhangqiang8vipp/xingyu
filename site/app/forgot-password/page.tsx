import Link from "next/link";
import ForgotPasswordForm from "./ForgotPasswordForm";
export default function ForgotPasswordPage(){
  return <main style={{maxWidth:440,margin:"12vh auto",padding:24}}>
    <small>XINGYU IDENTITY</small><h1>找回密码</h1>
    <p>请输入已注册的邮箱。验证邮件将在 30 分钟内有效。</p>
    <ForgotPasswordForm/>
    <p><Link href="/login">返回登录</Link></p>
  </main>;
}

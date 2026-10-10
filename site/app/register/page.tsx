import Link from "next/link";
import AuthShell from "@/app/console/AuthShell";
import RegisterForm from "./RegisterForm";
export default function RegisterPage(){
  return <AuthShell title="创建星屿账号" description="注册即可拥有独立的私人知识空间，验证邮箱后开始使用。">
    <RegisterForm/>
    <p className="xy-auth-links">已有账号？<Link href="/login">立即登录</Link></p>
  </AuthShell>;
}

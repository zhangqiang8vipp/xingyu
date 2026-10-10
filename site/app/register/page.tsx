import Link from "next/link";
import IdentityAdminPanel from "@/features/admin/IdentityAdminPanel";
import RegisterForm from "./RegisterForm";
export default function RegisterPage(){
  return <IdentityAdminPanel title="创建星屿账号" description="每个账号默认拥有独立的私人工作区，验证邮箱后才能登录。">
    <RegisterForm/>
    <p>已有账号？<Link href="/login">前往登录</Link></p>
  </IdentityAdminPanel>;
}

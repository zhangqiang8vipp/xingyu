import Link from "next/link";
import IdentityAdminPanel from "@/features/admin/IdentityAdminPanel";
import RegisterForm from "./RegisterForm";
export default function RegisterPage(){
  return <IdentityAdminPanel title="创建星屿账号" description="每个账号都有自己的知识空间；个人内容默认私密，只有管理员可以管理站点和发布公开内容。">
    <RegisterForm/>
    <p>已有账号？<Link href="/login">前往登录</Link></p>
  </IdentityAdminPanel>;
}

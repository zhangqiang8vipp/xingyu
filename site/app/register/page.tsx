import Link from "next/link";
import RegisterForm from "./RegisterForm";
export default function RegisterPage() {
  return <main style={{maxWidth:440,margin:"10vh auto",padding:24}}>
    <small>XINGYU IDENTITY</small><h1>创建星屿账号</h1>
    <p>每个账号默认拥有独立的私人工作区，验证邮箱后才能登录。</p>
    <RegisterForm />
    <p>已有账号？<Link href="/login">前往登录</Link></p>
  </main>;
}

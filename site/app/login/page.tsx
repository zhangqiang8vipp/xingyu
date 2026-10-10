import Link from "next/link";
import IdentityLoginForm from "./IdentityLoginForm";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return <main style={{ maxWidth: 420, margin: "12vh auto", padding: 24 }}>
    <small>XINGYU IDENTITY</small>
    <h1>登录星屿</h1>
    <p>使用邮箱和密码登录。微信等其他方式即将支持。</p>
    <IdentityLoginForm />
    <p><Link href="/">返回首页</Link></p>
  </main>;
}

import Link from "next/link";
import IdentityLoginForm from "./IdentityLoginForm";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  const requested = (await searchParams).return_to ?? "";
  const returnTo = (requested === "/admin" || requested === "/workspace" || requested.startsWith("/oauth/authorize?") || /^\/invite\?token=[A-Za-z0-9_-]{40,60}$/.test(requested) || /^\/organization-invite\?token=[A-Za-z0-9_-]{40,60}$/.test(requested)) && !requested.startsWith("//") ? requested : "/workspace";
  return <main style={{ maxWidth: 420, margin: "12vh auto", padding: 24 }}>
    <small>XINGYU IDENTITY</small>
    <h1>登录星屿</h1>
    <p>使用邮箱和密码登录。微信等其他方式即将支持。</p>
    <IdentityLoginForm returnTo={returnTo} />
    <p><Link href="/register">创建账号</Link> · <Link href="/forgot-password">忘记密码</Link> · <Link href="/">返回首页</Link></p>
  </main>;
}

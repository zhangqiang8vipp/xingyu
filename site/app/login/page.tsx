import Link from "next/link";
import AuthShell from "@/app/console/AuthShell";
import IdentityLoginForm from "./IdentityLoginForm";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  const requested = (await searchParams).return_to ?? "";
  const returnTo = (requested === "/admin" || requested === "/workspace" || requested.startsWith("/oauth/authorize?") || /^\/invite\?token=[A-Za-z0-9_-]{40,60}$/.test(requested) || /^\/organization-invite\?token=[A-Za-z0-9_-]{40,60}$/.test(requested)) && !requested.startsWith("//") ? requested : "/workspace";
  return <AuthShell title="欢迎回到星屿" description="使用邮箱和密码登录，继续管理你的知识空间与协作项目。">
    <IdentityLoginForm returnTo={returnTo}/>
    <p className="xy-auth-links"><Link href="/register">创建账号</Link><Link href="/forgot-password">忘记密码？</Link><Link href="/">返回首页</Link></p>
  </AuthShell>;
}

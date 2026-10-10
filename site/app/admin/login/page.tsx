import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminIdentity, isPasswordLoginConfigured, isLegacyAdminPasswordAllowed } from "@/server/auth/admin-auth";
import AdminLoginForm from "./AdminLoginForm";
import { safeOAuthReturnTo } from "@/worker/oauth/authorize";
import { getSiteSettings } from "@/db/queries";
import ThemeToggle from "@/features/navigation/ThemeToggle";
import ExistingLoginStyleLoader from "@/features/admin/ExistingLoginStyleLoader";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  const returnTo = safeOAuthReturnTo((await searchParams).return_to);
  if (await getAdminIdentity()) redirect(returnTo || "/admin");
  if (!(await isLegacyAdminPasswordAllowed())) redirect("/login?return_to=%2Fadmin");
  const configured = isPasswordLoginConfigured();
  const settings=await getSiteSettings();

  return <main className="signin admin-signin"><ExistingLoginStyleLoader/><div className="admin-login-theme"><ThemeToggle /></div><div>
    <span className="admin-mark">{settings.brandName.slice(0,1)}</span>
    <small>PRIVATE WRITING SPACE</small>
    <h1>{settings.brandName}写作后台</h1>
    <p>{configured ? `这是${settings.brandName}的私密写作空间，请验证管理员身份。` : "管理员密码尚未配置，后台已保持锁定。"}</p>
    {configured ? <AdminLoginForm returnTo={returnTo} /> : <div className="admin-login-locked"><b>安全锁定</b><span>请先配置密码哈希与会话密钥。</span></div>}
    <Link href="/">返回博客</Link>
  </div></main>;
}

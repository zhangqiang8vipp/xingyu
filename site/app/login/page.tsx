import Link from "next/link";
import IdentityAdminPanel from "@/features/admin/IdentityAdminPanel";
import IdentityLoginForm from "./IdentityLoginForm";
export const dynamic="force-dynamic";
export default async function LoginPage({searchParams}:{searchParams:Promise<{return_to?:string}>}){
  const requested=(await searchParams).return_to??"";
  const returnTo=(requested==="/admin"||requested==="/workspace"||requested.startsWith("/oauth/authorize?")||/^\/invite\?token=[A-Za-z0-9_-]{40,60}$/.test(requested)||/^\/organization-invite\?token=[A-Za-z0-9_-]{40,60}$/.test(requested))&&!requested.startsWith("//")?requested:"/workspace";
  return <IdentityAdminPanel title="登录星屿" description="使用邮箱和密码登录。微信等其他方式即将支持。">
    <IdentityLoginForm returnTo={returnTo}/>
    <p><Link href="/register">创建账号</Link> · <Link href="/forgot-password">忘记密码</Link> · <Link href="/">返回首页</Link></p>
  </IdentityAdminPanel>;
}

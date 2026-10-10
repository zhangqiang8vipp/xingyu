import Link from "next/link";
import IdentityAdminPanel from "@/features/admin/IdentityAdminPanel";
import ResetPasswordForm from "./ResetPasswordForm";
export const dynamic="force-dynamic";
export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  return <IdentityAdminPanel title="设置新密码" description="新密码至少 12 位。重置后所有网站会话和 MCP 客户端授权会被撤销。">
    <ResetPasswordForm token={token}/>
    <p><Link href="/login">返回登录</Link></p>
  </IdentityAdminPanel>;
}

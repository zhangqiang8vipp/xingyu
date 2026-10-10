import Link from "next/link";
import ResetPasswordForm from "./ResetPasswordForm";
export const dynamic="force-dynamic";
export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  return <main style={{maxWidth:440,margin:"12vh auto",padding:24}}>
    <small>XINGYU IDENTITY</small><h1>设置新密码</h1>
    <p>新密码至少 12 位。重置后所有网站会话和 MCP 客户端授权会被撤销。</p>
    <ResetPasswordForm token={token}/>
    <p><Link href="/login">返回登录</Link></p>
  </main>;
}

import Link from "next/link";
import VerifyEmailAction from "./VerifyEmailAction";
export const dynamic="force-dynamic";
export default async function VerifyEmailPage({searchParams}:{searchParams:Promise<{token?:string}>}){
  const token=(await searchParams).token??"";
  return <main style={{maxWidth:440,margin:"12vh auto",padding:24}}>
    <small>XINGYU IDENTITY</small><h1>验证邮箱</h1>
    <p>确认这是你本人发起的注册操作后，点击下方按钮完成验证。</p>
    <VerifyEmailAction token={token}/>
    <p><Link href="/login">前往登录</Link></p>
  </main>;
}

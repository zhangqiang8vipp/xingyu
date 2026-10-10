import { env } from "cloudflare:workers";

type DeliveryEnv = Env & { RESEND_API_KEY?:string; EMAIL_FROM?:string; PUBLIC_SITE_URL?:string };
export class MailDeliveryError extends Error {
  constructor(message="邮件服务暂不可用"){super(message);}
}
export function getMailSettings() {
  const e=env as DeliveryEnv;
  if(!e.RESEND_API_KEY||!e.EMAIL_FROM||!e.PUBLIC_SITE_URL)throw new MailDeliveryError("邮件服务尚未配置");
  let base:URL;
  try{base=new URL(e.PUBLIC_SITE_URL);}catch{throw new MailDeliveryError("站点地址无效");}
  if(base.protocol!=="https:"&&base.hostname!=="localhost")throw new MailDeliveryError("邮件回调域名必须使用 HTTPS");
  if(base.username||base.password||base.search||base.hash)throw new MailDeliveryError("邮件回调地址配置无效");
  return {base,key:e.RESEND_API_KEY,from:e.EMAIL_FROM};
}
export async function sendTransactionalEmail(
  mail:ReturnType<typeof getMailSettings>,
  message:{to:string;subject:string;text:string},
) {
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{Authorization:"Bearer "+mail.key,"Content-Type":"application/json"},
    body:JSON.stringify({from:mail.from,to:[message.to],subject:message.subject,text:message.text}),
  }).catch(()=>null);
  if(!response?.ok) {
    console.error("mail.delivery.failed",response?.status??"network");
    throw new MailDeliveryError("邮件发送失败");
  }
}

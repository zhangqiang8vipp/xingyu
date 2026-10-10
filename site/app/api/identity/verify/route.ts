import { confirmEmail } from "@/server/auth/identity-email";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({error:"无效来源"},{status:403});
  const data=await request.json().catch(()=>({})) as {token?:unknown};
  const token=typeof data.token==="string"?data.token:"";
  if (token.length>128) return Response.json({error:"链接无效"},{status:400});
  const ok=await confirmEmail(token);
  return Response.json({ok,error:ok?undefined:"链接已过期或已使用"},{status:ok?200:400,headers:{"Cache-Control":"no-store"}});
}

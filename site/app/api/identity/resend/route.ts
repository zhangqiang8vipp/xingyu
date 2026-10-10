import { IdentityEmailError, requestVerificationAgain } from "@/server/auth/identity-email";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({error:"无效来源"},{status:403});
  if (Number(request.headers.get("content-length")??0)>1024) return Response.json({error:"请求过大"},{status:413});
  try {
    const data=await request.json().catch(()=>({})) as {email?:unknown};
    await requestVerificationAgain(request,typeof data.email==="string"?data.email:"");
    return Response.json({ok:true,message:"如果账号仍待验证，邮件将发送至该地址。"}, {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if (error instanceof IdentityEmailError) return Response.json({error:error.message},{status:error.status,headers:{"Cache-Control":"no-store"}});
    return Response.json({error:"操作暂时不可用"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}

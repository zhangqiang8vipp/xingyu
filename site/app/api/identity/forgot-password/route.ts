import { IdentityEmailError,requestPasswordReset } from "@/server/auth/identity-email";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request){
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return Response.json({error:"无效请求来源"},{status:403,headers});
  if(Number(request.headers.get("content-length")??0)>1024)
    return Response.json({error:"请求过大"},{status:413,headers});
  try{
    const body=await request.json().catch(()=>({})) as {email?:unknown};
    await requestPasswordReset(request,typeof body.email==="string"?body.email:"");
    return Response.json({ok:true,message:"如该邮箱已注册，将收到密码重置邮件。"}, {status:202,headers});
  }catch(error){
    if(error instanceof IdentityEmailError)
      return Response.json({error:error.message},{status:error.status,headers});
    console.error("identity.password_reset.request_failed",error instanceof Error?error.name:"unknown");
    return Response.json({error:"暂时无法发送重置邮件"},{status:503,headers});
  }
}

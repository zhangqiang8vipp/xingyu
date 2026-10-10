import { IdentityEmailError,confirmPasswordReset } from "@/server/auth/identity-email";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request){
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return Response.json({error:"无效请求来源"},{status:403,headers});
  if(Number(request.headers.get("content-length")??0)>2048)
    return Response.json({error:"请求过大"},{status:413,headers});
  const body=await request.json().catch(()=>({})) as {token?:unknown;password?:unknown};
  const token=typeof body.token==="string"?body.token:"";
  const password=typeof body.password==="string"?body.password:"";
  if(token.length>128||password.length>128)return Response.json({error:"链接或密码无效"},{status:400,headers});
  try{
    const ok=await confirmPasswordReset(token,password);
    return Response.json({ok,error:ok?undefined:"链接过期或密码不符合要求"},{status:ok?200:400,headers});
  }catch(error){
    if(error instanceof IdentityEmailError)return Response.json({error:error.message},{status:error.status,headers});
    console.error("identity.password_reset.confirm_failed",error instanceof Error?error.name:"unknown");
    return Response.json({error:"密码重置暂时不可用"},{status:503,headers});
  }
}

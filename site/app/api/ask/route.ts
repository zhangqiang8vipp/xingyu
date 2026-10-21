import { env } from "cloudflare:workers";
import { identityFromRequest } from "@/server/auth/identity-session";
import { findAskSources, type AskScope } from "@/server/qa-retrieval";
import { answerWithOpenRouter, QaProviderError, QA_MODEL } from "@/server/qa-openrouter";
import { AskQuotaError, takeAskGlobalQuota, takeAskVisitorQuota } from "@/server/qa-quotas";

const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const fail = (message: string, status: number) =>
  Response.json({error:message},{status,headers});

export async function POST(request: Request) {
  if(request.headers.get("Origin")!==new URL(request.url).origin)
    return fail("无效请求来源",403);
  if(!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
    return fail("需要 JSON 请求",415);
  if(Number(request.headers.get("Content-Length")??0)>2400)
    return fail("请求内容过长",413);
  const raw=await request.text();
  if(raw.length>2400)return fail("请求内容过长",413);
  let body: Record<string,unknown>;
  try {
    const value:unknown=JSON.parse(raw);
    if(!value || typeof value!=="object" || Array.isArray(value))return fail("无效请求",400);
    body=value as Record<string,unknown>;
  } catch {return fail("无效请求",400);}
  const question=typeof body.question==="string"?body.question.trim():"";
  if(question.length<3||question.length>240||/[\u0000-\u001f\u007f]/.test(question))
    return fail("请输入 3 到 240 字的问题",400);
  const scope=body.scope??"public";
  if(scope!=="public"&&scope!=="mine"&&scope!=="all")
    return fail("无效知识范围",400);
  const mode=body.mode??"answer";
  if(mode!=="answer"&&mode!=="sources")return fail("无效查询模式",400);
  if(scope!=="public"&&mode==="answer"&&body.confirmedExternalProcessing!==true)
    return fail("请先确认允许将匹配的私人文章片段发送给模型",400);
  const user=await identityFromRequest(request);
  if(scope!=="public"&&!user)return fail("请先登录后再查询私人知识",401);
  const key=(env as Env & {OPENROUTER_API_KEY?:string}).OPENROUTER_API_KEY?.trim();
  if(mode==="answer"&&!key)
    return fail("问答模型尚未配置，请稍后再试；也可使用仅检索资料模式",503);

  try{
    await takeAskVisitorQuota(request,user);
    const sources=await findAskSources(question,scope as AskScope,user,new URL(request.url).origin);
    if(!sources.length)return Response.json({
      answer:"没有找到足够相关的文章。请换一个更具体的关键词试试。",
      sources:[],model:null,degraded:false,
    },{headers});
    if(mode==="sources")return Response.json({
      answer:"已检索到下列真实文章（未调用 AI 模型）。",
      sources,model:null,degraded:false,
    },{headers});
    try {
      await takeAskGlobalQuota();
    } catch (error) {
      if(error instanceof AskQuotaError&&error.code==="daily")
        return Response.json({
          answer:"今日免费模型调用额度已满，以下仍可查看知识库检索到的相关文章。",
          sources,model:null,degraded:true,
        },{headers});
      throw error;
    }
    try{
      const answer=await answerWithOpenRouter(question,sources,key!,new URL(request.url).origin);
      return Response.json({answer,sources,model:QA_MODEL,degraded:false},{headers});
    }catch(error){
      const isQuota=error instanceof QaProviderError&&error.reason==="quota";
      return Response.json({
        answer:isQuota?"免费模型的调用额度暂时已满，以下是知识库检索到的相关文章。"
          :"AI 模型暂时无法回答，以下是知识库检索到的相关文章。",
        sources,model:QA_MODEL,degraded:true,
      },{headers});
    }
  }catch(error) {
    if(error instanceof AskQuotaError){
      const message=error.code==="daily"?"今日问答额度已用完，请明天再试"
        :error.code==="throttled"?"请求过于频繁，请稍后再试":"问答配额检查暂时不可用";
      return fail(message,error.code==="unavailable"?503:429);
    }
    if(error instanceof Error&&error.message==="ASK_LOGIN_REQUIRED")return fail("请先登录",401);
    console.error("knowledge_qa_failed",error instanceof Error?error.name:"unknown");
    return fail("知识检索暂时不可用",503);
  }
}

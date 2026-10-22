import { env } from "cloudflare:workers";
import { readLimitedAskBody } from "@/domain/knowledge/qa-request";
import { identityFromRequest } from "@/server/auth/identity-session";
import { requestHasAdminSession } from "@/db/admin-session";
import { isPasswordLoginConfigured, isLegacyAdminPasswordAllowed } from "@/server/auth/admin-auth";
import { findAskSources, type AskScope } from "@/server/qa-retrieval";
import { answerWithOpenRouter, qaFailureDetails } from "@/server/qa-openrouter";
import { getQaModelConfig } from "@/server/qa-runtime-config";
import { AskQuotaError, takeAskVisitorQuota } from "@/server/qa-quotas";

const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const fail = (message: string, status: number) =>
  Response.json({error:message},{status,headers});

const qaFailureMessage = (code:string) => {
  switch(code) {
    case "auth_rejected": return "OpenRouter 拒绝了模型请求的认证或权限，请检查 API Key 和权限设置。以下是匹配到的真实原文。";
    case "credits_unavailable": return "OpenRouter 账户或 API Key 的可用额度不足。以下是匹配到的真实原文。";
    case "invalid_request": return "OpenRouter 拒绝了模型请求参数。以下是匹配到的真实原文。";
    case "model_not_found": return "OpenRouter 未找到所请求的模型路由。以下是匹配到的真实原文。";
    case "timeout": return "模型在 35 秒内没有完成回答。以下是匹配到的真实原文。";
    case "output_token_limit": return "模型已用完生成 tokens，仍没有产生可展示的回答。以下是匹配到的真实原文。";
    case "invalid_response": return "模型没有返回可显示的回答。以下是匹配到的真实原文。";
    case "network": return "连接 OpenRouter 时遇到网络错误。以下是匹配到的真实原文。";
    case "upstream_unavailable": return "OpenRouter 或所选免费模型暂时不可用。以下是匹配到的真实原文。";
    case "rate_limited": return "OpenRouter 的模型请求已被限流。以下是匹配到的真实原文。";
    default: return "模型暂时无法回答，以下是匹配到的真实原文。";
  }
};

/** Only called when an assistant panel opens; supports both identity and legacy admin sessions. */
export async function GET(request: Request) {
  const signedInUser=await identityFromRequest(request);
  const legacyOwner=!signedInUser && isPasswordLoginConfigured()
    && await requestHasAdminSession(request) && await isLegacyAdminPasswordAllowed();
  return Response.json({authenticated:Boolean(signedInUser||legacyOwner)},{headers});
}

export async function POST(request: Request) {
  if(request.headers.get("Origin")!==new URL(request.url).origin)
    return fail("无效请求来源",403);
  if(!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
    return fail("需要 JSON 请求",415);
  const raw=await readLimitedAskBody(request);
  if(raw===null)return fail("请求内容过长",413);
  let body: Record<string,unknown>;
  try {
    const value:unknown=JSON.parse(raw);
    if(!value || typeof value!=="object" || Array.isArray(value))return fail("无效请求",400);
    body=value as Record<string,unknown>;
  } catch {return fail("无效请求",400);}
  const question=typeof body.question==="string"?body.question.trim():"";
  if(question.length<2||question.length>240||/[\u0000-\u001f\u007f]/.test(question))
    return fail("请输入 2 到 240 字的问题",400);
  const scope=body.scope??"public";
  if(scope!=="public"&&scope!=="mine"&&scope!=="all")
    return fail("无效知识范围",400);
  const mode=body.mode??"answer";
  if(mode!=="answer"&&mode!=="sources")return fail("无效查询模式",400);
  if(scope!=="public"&&mode==="answer"&&body.confirmedExternalProcessing!==true)
    return fail("请先确认允许将匹配的私人文章片段发送给模型",400);
  const signedInUser=await identityFromRequest(request);
  const legacyOwner=!signedInUser && isPasswordLoginConfigured()
    && await requestHasAdminSession(request) && await isLegacyAdminPasswordAllowed();
  const user=signedInUser??(legacyOwner?{userId:1}:null);
  if(scope!=="public"&&!user)return fail("请先登录后再查询私人知识",401);
  // Being an owner of a personal workspace does NOT make someone a site admin.
  // Only the verified legacy admin or a site_memberships owner is exempt.
  const isAdmin=legacyOwner || Boolean(signedInUser && await env.DB.prepare(
    "SELECT 1 AS yes FROM site_memberships WHERE user_id=? AND role='owner'"
  ).bind(signedInUser.userId).first());
  const key=(env as Env & {OPENROUTER_API_KEY?:string}).OPENROUTER_API_KEY?.trim();
  if(mode==="answer"&&!key)
    return fail("问答模型尚未配置，请稍后再试；也可使用仅检索资料模式",503);

  try{
    // When the free AI allowance is exhausted, still return authorized original
    // articles using the independent search allowance. No model call occurs.
    let modelQuotaReached=false;
    try {
      await takeAskVisitorQuota(request,user,mode,isAdmin);
    } catch(error) {
      if(mode==="answer"&&error instanceof AskQuotaError&&error.code==="daily") {
        await takeAskVisitorQuota(request,user,"sources",isAdmin);
        modelQuotaReached=true;
      } else throw error;
    }
    const sources=await findAskSources(question,scope as AskScope,user,new URL(request.url).origin);
    if(!sources.length)return Response.json({
      answer:"没有找到足够相关的文章。请换一个更具体的关键词试试。",
      sources:[],model:null,degraded:false,
    },{headers});
    if(mode==="sources")return Response.json({
      answer:"已检索到下列真实文章（未调用 AI 模型）。",
      sources,model:null,degraded:false,
    },{headers});
    if(modelQuotaReached)return Response.json({
      answer:"今天的免费 AI 回答次数已用完，下面仍可查看检索到的真实原文。",
      sources,model:null,degraded:true,
    },{headers});
    // Load the site-admin-selected model only when an actual model call
    // will occur. D1 config changes take effect on the very next question.
    const modelConfig=await getQaModelConfig();
    try{
      const answer=await answerWithOpenRouter(question,sources,key!,new URL(request.url).origin,fetch,modelConfig);
      return Response.json({answer,sources,model:modelConfig.model,degraded:false},{headers});
    }catch(error){
      const diagnostic=qaFailureDetails(error);
      const incidentId=crypto.randomUUID();
      // Only allowlisted metadata. Never log API keys, user questions,
      // article snippets, upstream response bodies, request headers, or IPs.
      console.warn({
        event:"knowledge_qa_provider_failure",
        incidentId,
        code:diagnostic.code,
        httpStatus:diagnostic.status,
        durationMs:diagnostic.durationMs,
        model:modelConfig.model,
      });
      return Response.json({
        answer:qaFailureMessage(diagnostic.code),
        sources,model:modelConfig.model,degraded:true,
        diagnostic:{code:diagnostic.code,status:diagnostic.status,incidentId},
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

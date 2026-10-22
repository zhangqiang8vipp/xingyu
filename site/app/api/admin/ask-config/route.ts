import { env } from "cloudflare:workers";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { readLimitedAskBody } from "@/domain/knowledge/qa-request";
import { getQaModelConfig, saveQaModelConfig } from "@/server/qa-runtime-config";
import {
  answerWithOpenRouter, parseQaModelConfig, qaFailureDetails,
  QaModelConfigError, type QaModelConfig,
} from "@/server/qa-openrouter";

const responseHeaders={
  "Cache-Control":"no-store, private",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
};
const respond=(body:unknown,status=200)=>
  Response.json(body,{status,headers:responseHeaders});

async function readAdminConfig(request:Request):Promise<
  {config:QaModelConfig} | Response
> {
  // Admin-only, explicit same-origin write. Never accept model settings or
  // credentials from a public Q&A request.
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return respond({error:"无效请求来源"},403);
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return respond({error:"需要 JSON 请求"},415);
  const raw=await readLimitedAskBody(request);
  if(raw===null)return respond({error:"模型设置请求过大"},413);
  try{
    return {config:parseQaModelConfig(JSON.parse(raw))};
  }catch(error){
    return respond({error:error instanceof QaModelConfigError ? error.message : "无效的模型设置"},400);
  }
}

export async function GET(request:Request) {
  if(!await isAdminRequest(request))return unauthorized();
  return respond({config:await getQaModelConfig(),provider:"openrouter",freeOnly:true});
}

export async function PATCH(request:Request) {
  if(!await isAdminRequest(request))return unauthorized();
  const parsed=await readAdminConfig(request);
  if(parsed instanceof Response)return parsed;
  const config=await saveQaModelConfig(parsed.config);
  return respond({config,saved:true});
}

export async function POST(request:Request) {
  if(!await isAdminRequest(request))return unauthorized();
  const parsed=await readAdminConfig(request);
  if(parsed instanceof Response)return parsed;
  const key=(env as Env & {OPENROUTER_API_KEY?:string}).OPENROUTER_API_KEY?.trim();
  if(!key)return respond({error:"Cloudflare Worker 未配置 OPENROUTER_API_KEY"},503);

  // Synthetic public-only probe: no user prompt, private article or key is
  // returned/logged. This costs at most ONE real provider request per click.
  const source=[{
    id:1,title:"XINGYU 模型连接自检材料（非知识库文章）",
    excerpt:"仅用于连接测试的公开模拟数据",
    snippet:"XINGYU 是一个内容知识库网站；模型连接测试只检查能否根据这一句材料回答并引用 [1]。",
    visibility:"public" as const,url:new URL("/ask",request.url).toString(),
  }];
  try{
    const answer=await answerWithOpenRouter(
      "根据测试资料，XINGYU 是什么？请引用来源编号。",
      source,key,new URL(request.url).origin,fetch,parsed.config,
    );
    const hasCitation=answer.includes("[1]");
    return respond({
      ok:hasCitation,
      model:parsed.config.model,
      cited:hasCitation,
      answerPreview:answer.slice(0,240),
      warning:hasCitation?null:"模型返回了文字，但没有引用测试资料；请换一个更适合知识问答的免费模型",
    });
  }catch(error){
    const details=qaFailureDetails(error);
    const incidentId=crypto.randomUUID();
    console.warn({
      event:"knowledge_qa_model_config_test_failure",
      code:details.code,httpStatus:details.status,durationMs:details.durationMs,
      model:parsed.config.model,incidentId,
    });
    return respond({
      ok:false,model:parsed.config.model,
      diagnostic:{code:details.code,status:details.status,incidentId},
    });
  }
}

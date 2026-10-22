// One-use integration probe. Reads only published public sources from the
// production site's source-only endpoint. Never reads private articles or keys
// from the Worker. Reuses the exact current XINGYU qaMessages() implementation.
import {qaMessages, verifiedAnswer, QA_MAX_COMPLETION_TOKENS} from "../server/qa-openrouter.ts";

const ORIGIN="https://zhangwansen.click";
const ENDPOINT="https://openrouter.ai/api/v1/chat/completions";
const key=process.env.OPENROUTER_API_KEY;
if(!key) {
  console.error("REAL_CONTEXT_BLOCKED: CLOUDFLARE environment OPENROUTER_API_KEY unavailable");
  process.exit(1);
}

const questions=[
  {id:"overview",text:"这个网站主要分享哪些技术经验？"},
  {id:"cloudflare",text:"网站有哪些 Cloudflare Workers 和 D1 相关的技术实践？"},
];
const cases=[
  {id:"free_default",model:"openrouter/free"},
  {id:"free_low",model:"openrouter/free",reasoning:{effort:"low"}},
  {id:"minimax_low",model:"minimax/minimax-m3.1-flash:free",reasoning:{effort:"low"}},
];
const printable=s=>String(s??"").replace(/[\x00-\x1f\x7f-\x9f]/g," ").replace(/\s+/g," ").trim();
const intOrNull=x=>Number.isSafeInteger(x)&&x>=0?x:null;
let actualSourceSets=0, modelRequests=0;

for(const question of questions) {
  const publicResult=await fetch(ORIGIN+"/api/ask",{
    method:"POST",
    headers:{"Content-Type":"application/json","Origin":ORIGIN,"Accept":"application/json"},
    body:JSON.stringify({question:question.text,scope:"public",mode:"sources"}),
    signal:AbortSignal.timeout(20000),
  });
  let payload=null;
  try{payload=await publicResult.json()}catch{}
  if(!publicResult.ok||!Array.isArray(payload?.sources)) {
    console.log("REAL_SOURCE_ERROR "+JSON.stringify({
      question_id:question.id,app_http:publicResult.status,error:"sources_endpoint_unavailable"
    }));
    continue;
  }
  const sources=payload.sources;
  if(!sources.every(s=>
    Number.isInteger(s?.id)&&s.id>0&&typeof s.title==="string"&&
    typeof s.excerpt==="string"&&typeof s.snippet==="string"&&
    s.visibility==="public"&&typeof s.url==="string"&&
    s.url.startsWith(ORIGIN+"/posts/"))) {
    console.error("REAL_SOURCE_SECURITY_REJECTED: unexpected private or invalid source");
    process.exit(1);
  }
  if(!sources.length) {
    console.log("REAL_SOURCE_EMPTY "+JSON.stringify({question_id:question.id,app_http:publicResult.status}));
    continue;
  }
  actualSourceSets++;
  const messages=qaMessages(question.text,sources);
  const sourceInfo={
    question_id:question.id,
    question:question.text,
    app_http:publicResult.status,
    source_count:sources.length,
    titles:sources.map(s=>printable(s.title).slice(0,95)),
    public_urls:sources.map(s=>s.url),
    snippets_chars:sources.map(s=>s.snippet.length),
    context_chars:messages.reduce((n,m)=>n+m.content.length,0),
    max_tokens:QA_MAX_COMPLETION_TOKENS,
    context_builder:"XINGYU site/server/qa-openrouter.ts::qaMessages",
  };
  console.log("REAL_SOURCE "+JSON.stringify(sourceInfo));

  for(const entry of cases) {
    // Exactly one request per case: no automatic retry, no paid fallback.
    const body={
      model:entry.model,
      stream:false,
      temperature:0.2,
      max_tokens:QA_MAX_COMPLETION_TOKENS,
      messages,
      ...(entry.reasoning?{reasoning:entry.reasoning}:{}),
    };
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),42000);
    const start=Date.now();
    modelRequests++;
    try{
      const response=await fetch(ENDPOINT,{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+key,
          "Content-Type":"application/json",
          "HTTP-Referer":ORIGIN,
          "X-Title":"XINGYU real public-context comparison",
        },
        body:JSON.stringify(body),
        signal:controller.signal,
      });
      let data=null;
      try{data=await response.json()}catch{}
      const choice=Array.isArray(data?.choices)?data.choices[0]:null;
      const content=choice?.message?.content;
      const text=typeof content==="string"?content:Array.isArray(content)?
        content.filter(part=>part?.type==="text"&&typeof part.text==="string")
          .map(part=>part.text).join("\n"):"";
      const verified=verifiedAnswer(text,sources.length);
      const citations=[...verified.matchAll(/\[(\d{1,3})\]/g)]
        .map(m=>Number(m[1])).filter(id=>id>=1&&id<=sources.length);
      const usage=data?.usage??{};
      const details=usage?.completion_tokens_details??{};
      const errorCode=data?.error?.code;
      const httpErrorCode=Number.isInteger(errorCode)&&errorCode>=400&&errorCode<=599?errorCode:null;
      console.log("REAL_MODEL "+JSON.stringify({
        question_id:question.id,
        config:entry.id,
        requested_model:entry.model,
        actual_model:typeof data?.model==="string"?data.model:null,
        http_status:response.status,
        embedded_http_error:httpErrorCode,
        finish_reason:typeof choice?.finish_reason==="string"?choice.finish_reason:null,
        prompt_tokens:intOrNull(usage.prompt_tokens),
        completion_tokens:intOrNull(usage.completion_tokens),
        reasoning_tokens:intOrNull(details.reasoning_tokens??usage.reasoning_tokens),
        visible_chars:verified.length,
        citation_ids:[...new Set(citations)],
        citation_present:citations.length>0,
        successful_answer:response.ok && !data?.error && verified.length>0,
        elapsed_ms:Date.now()-start,
        public_answer_preview:printable(verified).slice(0,180),
      }));
    }catch(error){
      console.log("REAL_MODEL "+JSON.stringify({
        question_id:question.id,
        config:entry.id,
        requested_model:entry.model,
        transport_error:controller.signal.aborted?"timeout":"network",
        elapsed_ms:Date.now()-start,
      }));
    }finally{clearTimeout(timeout);}
  }
}
console.log("REAL_PROBE_SUMMARY "+JSON.stringify({
  actual_public_source_sets:actualSourceSets,model_requests:modelRequests,
  production_worker_modified:false,private_sources_used:false,
}));
if(actualSourceSets===0||modelRequests===0)process.exitCode=1;

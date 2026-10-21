import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { askSearchTerms } from "../domain/knowledge/qa-terms.ts";
import { isKnowledgeOverviewQuestion } from "../domain/knowledge/qa-overview.ts";
import { readLimitedAskBody } from "../domain/knowledge/qa-request.ts";
import {
  answerWithOpenRouter,qaMessages,verifiedAnswer,QaProviderError,qaFailureDetails,QA_MODEL,
} from "../server/qa-openrouter.ts";

const sources=[
  {id:1,title:"Cloudflare D1 技术经验",excerpt:"架构方案",
    snippet:"数据库在 Cloudflare Worker 中可以通过 D1 实现。",visibility:"public",
    url:"https://example.test/posts/known/cloudflare-d1"},
];

test("answer instructions restrict the model to evidence and literal citation indices",()=>{
  const messages=qaMessages("有哪些技术经验？",sources);
  assert.equal(messages.length,2);
  assert.match(messages[0].content,/不允许使用外部知识/);
  assert.match(messages[0].content,/不可信/);
  assert.ok(messages[1].content.includes("Cloudflare D1 技术经验"));
  assert.ok(messages[1].content.includes("[1]"));
  assert.equal(QA_MODEL,"openrouter/free");
  assert.equal(verifiedAnswer("见 [1] 和不存在的 [42]。",1),"见 [1] 和不存在的 。");
});

test("OpenRouter request never sends a client API key and cites only known articles",async()=>{
  let seen=null;
  const fakeFetch=async(url,init)=>{
    seen={url,method:init.method,headers:init.headers,body:JSON.parse(init.body)};
    return new Response(JSON.stringify({
      choices:[{message:{content:"根据文章，[1] 讨论 D1。[99] 是未知来源。"}}],
    }),{status:200,headers:{"content-type":"application/json"}});
  };
  const answer=await answerWithOpenRouter("网站有哪些技术经验？",sources,"unit-test-only-key","https://example.test",fakeFetch);
  assert.match(answer,/\[1\]/);
  assert.ok(!answer.includes("[99]"));
  assert.equal(seen.url,"https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen.headers.Authorization,"Bearer unit-test-only-key");
  assert.equal(seen.body.model,"openrouter/free");
  assert.equal(seen.body.stream,false);
  assert.ok(!seen.body.messages[1].content.includes("unit-test-only-key"));
});

test("OpenRouter rate limit degrades without returning provider payload",async()=>{
  await assert.rejects(
    answerWithOpenRouter("测试",sources,"unit-test-only-key","https://example.test",
      async()=>new Response("do not expose upstream body",{status:429})),
    error=>error instanceof QaProviderError&&error.reason==="quota",
  );
});

test("site-topic overview questions sample real articles instead of requiring a literal 技术/经验 match",()=>{
  assert.equal(isKnowledgeOverviewQuestion("这个网站主要分享哪些技术经验？"),true);
  assert.equal(isKnowledgeOverviewQuestion("本站主要有哪些内容？"),true);
  assert.equal(isKnowledgeOverviewQuestion("我的知识库主要写了什么？"),true);
  assert.equal(isKnowledgeOverviewQuestion("网站如何部署 Cloudflare？"),false);
});

test("public ask body is byte-capped even when Content-Length is absent",async()=>{
  const small=new Request("https://example.test/api/ask",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({question:"技术经验",scope:"public"}),
  });
  assert.match(await readLimitedAskBody(small),/技术经验/);
  const big=new Request("https://example.test/api/ask",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:"x".repeat(3000),
  });
  assert.equal(await readLimitedAskBody(big),null);
});


test("short Chinese names stay searchable rather than failing the old three-character gate",()=>{
  assert.deepEqual(askSearchTerms("温莎"),["温莎"]);
  assert.ok(askSearchTerms("介绍一下温莎").includes("温莎"));
  assert.ok(askSearchTerms("星屿").includes("星屿"));
});

test("both the global launcher and full page use the same accessible assistant UI",()=>{
  const root=readFileSync(new URL("../app/layout.tsx",import.meta.url),"utf8");
  const nav=readFileSync(new URL("../features/navigation/nav/NavTools.tsx",import.meta.url),"utf8");
  const panel=readFileSync(new URL("../features/ask/GlobalAskAssistant.tsx",import.meta.url),"utf8");
  const chat=readFileSync(new URL("../features/ask/AskChat.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/assistant.css",import.meta.url),"utf8");
  const route=readFileSync(new URL("../app/api/ask/route.ts",import.meta.url),"utf8");
  assert.match(root,/GlobalAskAssistant/);
  assert.match(nav,/AskAiTrigger/);
  assert.match(panel,/aria-modal/);
  assert.match(panel,/xingyu:ask-open/);
  assert.match(chat,/xy-ai-thread/);
  assert.match(chat,/xy-ai-composer/);
  assert.match(chat,/urlTransform=/,"model-generated URLs must not be trusted");
  assert.match(chat,/confirmedExternalProcessing/,"private-model consent must not disappear");
  assert.match(css,/\.xy-ai-panel/);
  assert.match(css,/max-width:720px/);
  assert.match(route,/question.length<2/);
});


test("OpenRouter diagnostics distinguish rejected keys, credits, malformed requests and 5xx errors",async()=>{
  for(const [status,code] of [
    [400,"invalid_request"],[401,"auth_rejected"],[402,"credits_unavailable"],
    [403,"auth_rejected"],[404,"model_not_found"],[422,"invalid_request"],
    [429,"rate_limited"],[502,"upstream_unavailable"],[503,"upstream_unavailable"],
  ]){
    await assert.rejects(
      answerWithOpenRouter("网站技术经验",sources,"private-key-do-not-print","https://example.test",
        async()=>new Response("provider echoed private-key-do-not-print and user's private question",
          {status})),
      error=>{
        assert.ok(error instanceof QaProviderError);
        const details=qaFailureDetails(error);
        assert.equal(details.code,code);
        assert.equal(details.status,status);
        assert.ok(details.durationMs>=0);
        assert.ok(!JSON.stringify(details).includes("private-key"));
        assert.ok(!error.message.includes("private-key"));
        return true;
      },
    );
  }
});

test("AbortError is a timeout, transport errors stay private and malformed 200 is not a success",async()=>{
  const failed=[
    [async()=>{const error=new Error("secret response content must remain hidden");error.name="AbortError";throw error;},"timeout"],
    [async()=>{throw new Error("key=secret response content must remain hidden");},"network"],
    [async()=>new Response("not-json secret",{status:200}),"invalid_response"],
    [async()=>new Response(JSON.stringify({choices:[{message:{content:null}}]}),{status:200}),"invalid_response"],
  ];
  for(const [fakeFetch,code] of failed){
    await assert.rejects(
      answerWithOpenRouter("Cloudflare 技术",sources,"secret","https://example.test",fakeFetch),
      error=>error instanceof QaProviderError && qaFailureDetails(error).code===code
        && !JSON.stringify(qaFailureDetails(error)).includes("secret")
        && !error.message.includes("secret"),
    );
  }
});

test("OpenRouter-compatible structured text parts are accepted but reasoning is ignored",async()=>{
  const answer=await answerWithOpenRouter(
    "Cloudflare 有哪些实践？",sources,"private-test-key","https://example.test",
    async()=>new Response(JSON.stringify({choices:[{message:{content:[
      {type:"reasoning",text:"INTERNAL COT MUST NOT BE SHOWN"},
      {type:"text",text:"文章讨论 Cloudflare D1。[1]"},
    ]}}]}),{status:200}),
  );
  assert.match(answer,/Cloudflare D1/);
  assert.ok(!answer.includes("INTERNAL COT"));
});

test("UI and route only expose allowlisted metadata for model failure, never upstream body",()=>{
  const api=readFileSync(new URL("../app/api/ask/route.ts",import.meta.url),"utf8");
  const provider=readFileSync(new URL("../server/qa-openrouter.ts",import.meta.url),"utf8");
  const chat=readFileSync(new URL("../features/ask/AskChat.tsx",import.meta.url),"utf8");
  assert.match(api,/knowledge_qa_provider_failure/);
  assert.match(api,/qaFailureDetails\(error\)/);
  assert.match(api,/crypto\.randomUUID/);
  assert.match(api,/diagnostic:\{code:diagnostic\.code,status:diagnostic\.status,incidentId\}/);
  assert.doesNotMatch(api,/console\.(warn|error)\([^)]*JSON\.stringify\(body\)/);
  assert.match(provider,/Never read or log an upstream error body/);
  assert.match(chat,/诊断编号/);
});

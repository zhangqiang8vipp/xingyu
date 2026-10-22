import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { askSearchTerms } from "../domain/knowledge/qa-terms.ts";
import { isKnowledgeOverviewQuestion } from "../domain/knowledge/qa-overview.ts";
import { readLimitedAskBody } from "../domain/knowledge/qa-request.ts";
import {
  answerWithOpenRouter,qaMessages,verifiedAnswer,QaProviderError,qaFailureDetails,QA_MODEL,QA_MAX_COMPLETION_TOKENS,
  parseQaModelConfig, DEFAULT_QA_MODEL_CONFIG, QaModelConfigError,
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
  assert.equal(QA_MAX_COMPLETION_TOKENS,2048);
  assert.equal(seen.body.max_tokens,2048,"allow visible output after reasoning budget");
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
  assert.doesNotMatch(nav,/AskAiTrigger/,"the redundant top navigation Ask AI button was removed");
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


test("floating assistant cannot scroll the parent page and only the launcher remains",()=>{
  const panel=readFileSync(new URL("../features/ask/GlobalAskAssistant.tsx",import.meta.url),"utf8");
  const chat=readFileSync(new URL("../features/ask/AskChat.tsx",import.meta.url),"utf8");
  const nav=readFileSync(new URL("../features/navigation/nav/NavTools.tsx",import.meta.url),"utf8");
  const globalStyles=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");
  assert.match(panel,/focus\(\{ preventScroll: true \}\)/);
  assert.match(panel,/hidden=\{open\}/);
  assert.match(panel,/aria-controls="xy-ai-global-panel"/);
  assert.match(chat,/threadRef\.current/);
  assert.match(chat,/thread\.scrollTo\(/);
  assert.doesNotMatch(chat,/\.scrollIntoView\(/,"scrollIntoView may scroll the main document too");
  assert.doesNotMatch(nav,/AskAiTrigger/);
  assert.match(globalStyles,/\.xy-ai-launcher\[hidden\]\{display:none\}/);
  assert.match(globalStyles,/\.xy-ai-panel\{position:fixed/,"lazy assistant needs a fixed-position shell before remote CSS loads");
});


test("OpenRouter errors are safely classified by HTTP status without leaking response bodies",async()=>{
  for (const [status,code] of [
    [400,"invalid_request"],[401,"auth_rejected"],[402,"credits_unavailable"],
    [403,"auth_rejected"],[404,"model_not_found"],[408,"timeout"],
    [422,"invalid_request"],[429,"rate_limited"],
    [502,"upstream_unavailable"],[503,"upstream_unavailable"],[524,"timeout"],
  ]) {
    await assert.rejects(
      answerWithOpenRouter("Cloudflare 经验",sources,"private-test-secret","https://example.test",
        async()=>new Response("never log private-test-secret or the user's private article",{status})),
      error=>{
        assert.ok(error instanceof QaProviderError);
        const diagnostic=qaFailureDetails(error);
        assert.equal(diagnostic.code,code);
        assert.equal(diagnostic.status,status);
        assert.ok(diagnostic.durationMs>=0);
        assert.ok(!JSON.stringify(diagnostic).includes("private-test-secret"));
        assert.ok(!error.message.includes("private-test-secret"));
        return true;
      },
    );
  }
});

test("provider HTTP 200 embedded errors are classified, not silently shown as empty answers",async()=>{
  for (const [body,expected] of [
    [{error:{code:429,message:"private-test-secret"}},"rate_limited"],
    [{error:{code:502,message:"private-test-secret"}},"upstream_unavailable"],
    [{error:{message:"private-test-secret"}},"invalid_response"],
  ]) {
    await assert.rejects(
      answerWithOpenRouter("技术",sources,"private-test-secret","https://example.test",
        async()=>new Response(JSON.stringify(body),{status:200})),
      error=>{
        assert.ok(error instanceof QaProviderError);
        assert.equal(qaFailureDetails(error).code,expected);
        assert.ok(!JSON.stringify(qaFailureDetails(error)).includes("private-test-secret"));
        return true;
      },
    );
  }
});

test("abort, connection failures and malformed successful responses stay sanitized",async()=>{
  const fakeRequests=[
    [async()=>{const e=new Error("secret upstream trace");e.name="AbortError";throw e;},"timeout"],
    [async()=>{throw new Error("secret upstream trace");},"network"],
    [async()=>new Response("not JSON, private article",{status:200}),"invalid_response"],
    [async()=>new Response(JSON.stringify({choices:[{message:{content:null}}]}),{status:200}),"invalid_response"],
  ];
  for (const [mock,expected] of fakeRequests) {
    await assert.rejects(
      answerWithOpenRouter("Cloudflare",sources,"private-test-secret","https://example.test",mock),
      error=>error instanceof QaProviderError &&
        qaFailureDetails(error).code===expected &&
        !error.message.includes("secret upstream trace"),
    );
  }
});

test("typed OpenRouter text response ignores reasoning and unsupported parts",async()=>{
  const output=await answerWithOpenRouter("Cloudflare 经验",sources,"test-key","https://example.test",
    async()=>new Response(JSON.stringify({choices:[{message:{content:[
      {type:"reasoning",text:"INTERNAL PRIVATE REASONING"},
      {type:"text",text:"这篇文章使用 Cloudflare D1。[1]"},
    ]}}]}),{status:200}));
  assert.match(output,/Cloudflare D1/);
  assert.doesNotMatch(output,/INTERNAL PRIVATE REASONING/);
});

test("diagnostic logs contain only allowlisted values and preserve newer admin quotas and no-scroll UX",()=>{
  const route=readFileSync(new URL("../app/api/ask/route.ts",import.meta.url),"utf8");
  const provider=readFileSync(new URL("../server/qa-openrouter.ts",import.meta.url),"utf8");
  const chat=readFileSync(new URL("../features/ask/AskChat.tsx",import.meta.url),"utf8");
  assert.match(route,/knowledge_qa_provider_failure/);
  assert.match(route,/qaFailureDetails\(error\)/);
  assert.match(route,/crypto\.randomUUID\(\)/);
  assert.match(route,/diagnostic:\{code:diagnostic\.code,status:diagnostic\.status,incidentId\}/);
  assert.match(route,/takeAskVisitorQuota\(request,user,mode,isAdmin\)/);
  assert.doesNotMatch(route,/takeAskGlobalQuota/);
  assert.doesNotMatch(route,/console\.(?:warn|error)\([^)]*JSON\.stringify\(body\)/);
  assert.match(provider,/Never read or log an upstream error body/);
  assert.match(chat,/诊断编号/);
  assert.match(chat,/thread\.scrollTo/);
});


test("HTTP 200 with finish_reason=length and empty content gets a precise output-token diagnostic",async()=>{
  const errorPayload={choices:[{finish_reason:"length",message:{
    content:"",reasoning:"DO NOT LEAK INTERNAL REASONING",
  }}],usage:{completion_tokens:650,completion_tokens_details:{reasoning_tokens:649}}};
  await assert.rejects(
    answerWithOpenRouter("Cloudflare 技术",sources,"safe-test-key","https://example.test",
      async()=>new Response(JSON.stringify(errorPayload),{status:200})),
    error=>{
      assert.ok(error instanceof QaProviderError);
      assert.equal(qaFailureDetails(error).code,"output_token_limit");
      assert.equal(qaFailureDetails(error).status,200);
      assert.ok(!JSON.stringify(qaFailureDetails(error)).includes("DO NOT LEAK"));
      return true;
    },
  );
});

test("HTTP 200 with empty content and finish_reason=stop remains an invalid response",async()=>{
  await assert.rejects(
    answerWithOpenRouter("文章经验",sources,"safe-test-key","https://example.test",
      async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:""}}]}),{status:200})),
    error=>error instanceof QaProviderError&&qaFailureDetails(error).code==="invalid_response",
  );
});

test("model answer still caps public output and preserves caller quotas",()=>{
  const provider=readFileSync(new URL("../server/qa-openrouter.ts",import.meta.url),"utf8");
  const route=readFileSync(new URL("../app/api/ask/route.ts",import.meta.url),"utf8");
  assert.match(provider,/REQUEST_TIMEOUT_MS = 35_000/);
  assert.match(provider,/max_tokens:QA_MAX_COMPLETION_TOKENS/);
  assert.match(route,/case "output_token_limit"/);
  assert.match(route,/takeAskVisitorQuota\(request,user,mode,isAdmin\)/);
  assert.doesNotMatch(route,/takeAskGlobalQuota/);
});


test("admin model config accepts free models only and preserves the existing safe default",()=>{
  assert.equal(DEFAULT_QA_MODEL_CONFIG.model,"openrouter/free");
  assert.equal(DEFAULT_QA_MODEL_CONFIG.reasoningEffort,"default");
  assert.equal(DEFAULT_QA_MODEL_CONFIG.maxTokens,2048);
  assert.equal(DEFAULT_QA_MODEL_CONFIG.timeoutMs,35000);
  const free=parseQaModelConfig({
    model:" minimax/minimax-m3.1-flash:free ",
    reasoningEffort:"low",maxTokens:4096,timeoutMs:45000,
  });
  assert.equal(free.model,"minimax/minimax-m3.1-flash:free");
  assert.deepEqual(free,{
    model:"minimax/minimax-m3.1-flash:free",
    reasoningEffort:"low",maxTokens:4096,timeoutMs:45000,
  });
  for(const invalid of [
    {model:"openrouter/auto",reasoningEffort:"default",maxTokens:2048,timeoutMs:35000},
    {model:"openai/gpt-4o",reasoningEffort:"low",maxTokens:2048,timeoutMs:35000},
    {model:"minimax/m3:free\nAuthorization: Bad",reasoningEffort:"low",maxTokens:2048,timeoutMs:35000},
    {model:"openrouter/free",reasoningEffort:"none",maxTokens:2048,timeoutMs:35000},
    {model:"openrouter/free",reasoningEffort:"default",maxTokens:999999,timeoutMs:35000},
    {model:"openrouter/free",reasoningEffort:"low",maxTokens:2048,timeoutMs:600000},
    {},
  ])assert.throws(()=>parseQaModelConfig(invalid),QaModelConfigError);
});

test("saved free model settings drive each provider request without a deploy or extra model call",async()=>{
  const captured=[];
  const fakeFetch=async(url,init)=>{
    const body=JSON.parse(init.body);
    captured.push(body);
    return new Response(JSON.stringify({
      choices:[{message:{content:"文章讨论了 D1。[1]"}}],
    }),{status:200});
  };
  const cfg=parseQaModelConfig({
    model:"minimax/minimax-m3.1-flash:free",reasoningEffort:"low",
    maxTokens:4096,timeoutMs:42000,
  });
  const answer=await answerWithOpenRouter(
    "网站如何使用 D1？",sources,"secret-key","https://example.test",fakeFetch,cfg,
  );
  assert.match(answer,/\[1\]/);
  assert.equal(captured.length,1);
  assert.equal(captured[0].model,"minimax/minimax-m3.1-flash:free");
  assert.equal(captured[0].max_tokens,4096);
  assert.deepEqual(captured[0].reasoning,{effort:"low"});
  await answerWithOpenRouter("D1 怎么用",sources,"secret-key","https://example.test",fakeFetch);
  assert.equal(captured[1].model,"openrouter/free");
  assert.equal("reasoning" in captured[1],false,
    "default reasoning must omit the field rather than force an unsupported value");
});

test("admin model settings are server-scoped, authenticated, and excluded from public knowledge APIs",()=>{
  const config=readFileSync(new URL("../server/qa-runtime-config.ts",import.meta.url),"utf8");
  const route=readFileSync(new URL("../app/api/admin/ask-config/route.ts",import.meta.url),"utf8");
  const askRoute=readFileSync(new URL("../app/api/ask/route.ts",import.meta.url),"utf8");
  const admin=readFileSync(new URL("../features/admin/AdminIntegrationsPanel.tsx",import.meta.url),"utf8");
  assert.match(config,/qa:runtime-config:v1/);
  assert.match(config,/INSERT INTO app_meta/);
  assert.match(route,/isAdminRequest/);
  assert.match(route,/readLimitedAskBody/);
  assert.match(route,/request\.headers\.get\("origin"\)/);
  assert.match(askRoute,/getQaModelConfig\(\)/);
  assert.match(askRoute,/takeAskVisitorQuota\(request,user,mode,isAdmin\)/);
  assert.doesNotMatch(askRoute,/takeAskGlobalQuota/);
  assert.match(admin,/<AdminAskModelPanel/);
  assert.match(admin,/!isPersonalAccount/);
});

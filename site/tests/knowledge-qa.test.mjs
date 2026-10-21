import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { askSearchTerms } from "../domain/knowledge/qa-terms.ts";
import { isKnowledgeOverviewQuestion } from "../domain/knowledge/qa-overview.ts";
import { readLimitedAskBody } from "../domain/knowledge/qa-request.ts";
import {
  answerWithOpenRouter,qaMessages,verifiedAnswer,QaProviderError,QA_MODEL,
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

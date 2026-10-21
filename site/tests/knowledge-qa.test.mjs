import assert from "node:assert/strict";
import test from "node:test";
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

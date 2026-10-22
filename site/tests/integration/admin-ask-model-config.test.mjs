import assert from "node:assert/strict";
import test from "node:test";
import {closeTestHarness,jsonRequest,loginAdmin,openTestHarness} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

const settings={
  model:"minimax/minimax-m3.1-flash:free",
  reasoningEffort:"low",
  maxTokens:4096,
  timeoutMs:42000,
};
async function call(h,method="GET",body,cookie,headers={}) {
  const response=await jsonRequest(h,"/api/admin/ask-config",{method,body,cookie,headers});
  return {status:response.status,data:await response.json()};
}

test("site admins can configure a free OpenRouter model without redeploy or exposing secrets",async()=>{
  const h=await openTestHarness();
  try {
    const anonymous=await call(h);
    assert.equal(anonymous.status,401);
    const adminCookie=await loginAdmin(h);
    const initial=await call(h,"GET",undefined,adminCookie);
    assert.equal(initial.status,200,JSON.stringify(initial.data));
    assert.deepEqual(initial.data.config,{
      model:"openrouter/free",reasoningEffort:"default",maxTokens:2048,timeoutMs:35000,
    });
    assert.equal(initial.data.freeOnly,true);
    assert.ok(!JSON.stringify(initial.data).includes("OPENROUTER_API_KEY"));

    const saved=await call(h,"PATCH",settings,adminCookie);
    assert.equal(saved.status,200,JSON.stringify(saved.data));
    assert.deepEqual(saved.data.config,settings);
    const next=await call(h,"GET",undefined,adminCookie);
    assert.equal(next.status,200);
    assert.deepEqual(next.data.config,settings,"read immediately after save; no redeployment");

    const stored=await h.db.prepare("SELECT value FROM app_meta WHERE key='qa:runtime-config:v1'").first();
    assert.deepEqual(JSON.parse(stored.value),settings,"admin-controlled settings stored in existing D1 KV table");
    assert.ok(!stored.value.includes("sk-or-"));
    assert.ok(!stored.value.includes("API_KEY"));
  } finally {await closeTestHarness(h);}
});

test("only verified site admins can change the Q&A model; regular users cannot use test endpoint",async()=>{
  const h=await openTestHarness();
  try{
    const normalUser=await makeActiveUser(h,"qa-config-ordinary-user");
    const forbidden=await call(h,"PATCH",settings,normalUser.cookie);
    assert.equal(forbidden.status,401);
    assert.equal((await call(h,"GET",undefined,normalUser.cookie)).status,401);
    assert.equal((await call(h,"POST",settings,normalUser.cookie)).status,401);
    assert.equal((await call(h,"PATCH",settings)).status,401);
    const hasConfig=await h.db.prepare("SELECT COUNT(*) AS n FROM app_meta WHERE key='qa:runtime-config:v1'").first();
    assert.equal(hasConfig.n,0,"blocked model settings changes never write D1");

    const adminCookie=await loginAdmin(h);
    assert.equal((await call(h,"PATCH",settings,adminCookie,{origin:"https://evil.example"})).status,401,
      "cross-origin admin writes blocked");
    assert.equal((await call(h,"PATCH",settings,adminCookie)).status,200);
    assert.equal((await call(h,"POST",settings,adminCookie)).status,503,
      "without Worker secret the test endpoint must fail closed, never contact OpenRouter");
  }finally{await closeTestHarness(h);}
});

test("paid models, unsupported settings, unexpected JSON and oversized bodies are rejected",async()=>{
  const h=await openTestHarness();
  try{
    const cookie=await loginAdmin(h);
    for(const payload of [
      {...settings,model:"openai/gpt-4o"},
      {...settings,model:"openrouter/auto"},
      {...settings,model:"openrouter/free",maxTokens:1000000},
      {...settings,model:"openrouter/free",timeoutMs:8000},
      {...settings,model:"openrouter/free",reasoningEffort:"none"},
    ]) {
      const response=await call(h,"PATCH",payload,cookie);
      assert.equal(response.status,400,JSON.stringify(response.data));
    }
    const huge=await call(h,"PATCH",{...settings,junk:"x".repeat(5000)},cookie);
    assert.equal(huge.status,413);
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM app_meta WHERE key='qa:runtime-config:v1'").first()).n,0,
      "invalid calls must not persist any settings");
  } finally {await closeTestHarness(h);}
});

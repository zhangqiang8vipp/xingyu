import assert from "node:assert/strict";
import test from "node:test";
import {openTestHarness,closeTestHarness,jsonRequest,loginAdmin} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

const location="/api/admin/ask-config";
async function request(h,method,body,cookie,headers={}) {
  const response=await jsonRequest(h,location,{method,body,cookie,headers});
  return {status:response.status,json:await response.json(),headers:response.headers};
}

test("model settings are admin-only; regular accounts cannot read, change or test models",async()=>{
  const h=await openTestHarness();
  try{
    const person=await makeActiveUser(h,"qa-settings-member");
    for(const cookie of [undefined,person.cookie]){
      const get=await request(h,"GET",undefined,cookie);
      assert.equal(get.status,401);
      for(const method of ["PATCH","POST"]) {
        const response=await request(h,method,{
          model:"minimax/minimax-m3.1-flash:free",reasoningEffort:"low",
          maxTokens:2048,timeoutMs:35000,
        },cookie);
        assert.equal(response.status,401);
      }
    }
    const settings=await h.db.prepare(
      "SELECT value FROM app_meta WHERE key='qa:runtime-config:v1'"
    ).first();
    assert.equal(settings,null,"unauthorized requests cannot modify D1");
  }finally{await closeTestHarness(h);}
});

test("admin changes a free model in D1 and reads it immediately, no code deployment or migration",async()=>{
  const h=await openTestHarness();
  try{
    const adminCookie=await loginAdmin(h);
    const initial=await request(h,"GET",undefined,adminCookie);
    assert.equal(initial.status,200,JSON.stringify(initial.json));
    assert.equal(initial.json.config.model,"openrouter/free");
    assert.equal(initial.json.config.maxTokens,2048);
    assert.equal(initial.json.freeOnly,true);
    const selected={
      model:"minimax/minimax-m3.1-flash:free",
      reasoningEffort:"low",
      maxTokens:4096,timeoutMs:45000,
    };
    const updated=await request(h,"PATCH",selected,adminCookie);
    assert.equal(updated.status,200,JSON.stringify(updated.json));
    assert.deepEqual(updated.json.config,selected);
    const record=await h.db.prepare(
      "SELECT value FROM app_meta WHERE key='qa:runtime-config:v1'"
    ).first();
    assert.deepEqual(JSON.parse(record.value),selected);
    const after=await request(h,"GET",undefined,adminCookie);
    assert.equal(after.status,200);
    assert.deepEqual(after.json.config,selected);
    assert.equal(after.headers.get("cache-control"),"no-store, private");
    const noKey=await request(h,"POST",selected,adminCookie);
    assert.equal(noKey.status,503,"admin test must not claim model works without Worker Secret");
  }finally{await closeTestHarness(h);}
});

test("admin model settings reject paid endpoints, oversized budgets, cross-origin writes and invalid JSON",async()=>{
  const h=await openTestHarness();
  try{
    const adminCookie=await loginAdmin(h);
    const base={
      model:"openrouter/free",reasoningEffort:"default",
      maxTokens:2048,timeoutMs:35000,
    };
    for(const bad of [
      {...base,model:"openai/gpt-4o"},
      {...base,model:"openrouter/auto"},
      {...base,model:"nvidia/paid-endpoint"},
      {...base,reasoningEffort:"none"},
      {...base,maxTokens:999999},
      {...base,timeoutMs:900000},
      {...base,model:"minimax/test:free\nx-injection"},
    ]){
      const r=await request(h,"PATCH",bad,adminCookie);
      assert.equal(r.status,400,JSON.stringify({bad,response:r.json}));
    }
    const origin=await request(h,"PATCH",base,adminCookie,{origin:"https://example.attacker.test"});
    assert.equal(origin.status,401,"cross-origin request is denied at admin auth boundary");
    const row=await h.db.prepare(
      "SELECT value FROM app_meta WHERE key='qa:runtime-config:v1'"
    ).first();
    assert.equal(row,null,"all invalid updates must leave D1 unchanged");
  }finally{await closeTestHarness(h);}
});

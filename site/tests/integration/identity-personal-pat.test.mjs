import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {closeTestHarness,openTestHarness,jsonRequest,callMcpTool,callMcpRaw} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

test("PAT: unique, scoped, permanent or expiring, user-owned and individually revocable",async()=>{
  const h=await openTestHarness();
  try{
    const alice=await makeActiveUser(h,"pat-alice");
    const bob=await makeActiveUser(h,"pat-bob");
    const create=(cookie,body)=>jsonRequest(h,"/api/identity/tokens",{
      method:"POST",cookie,body,
    });
    const first=await create(alice.cookie,{name:"Cursor",scopes:["xingyu.read"],lifetime:"never"});
    assert.equal(first.status,201,await first.clone().text());
    const {created:forever}=await first.json();
    assert.match(forever.token,/^xy_pat_[0-9a-f]{64}$/);
    assert.equal(forever.expiresAt,null);
    const second=await create(alice.cookie,{name:"Claude",scopes:["xingyu.read","xingyu.draft"],lifetime:7});
    assert.equal(second.status,201,await second.clone().text());
    const {created:short}=await second.json();
    assert.notEqual(forever.token,short.token);
    const persisted=await h.db.prepare("SELECT user_id,token_hash,expires_at,revoked_at FROM personal_access_tokens WHERE id=?")
      .bind(forever.id).first();
    assert.equal(persisted.user_id,alice.id);
    assert.equal(persisted.expires_at,null);
    assert.equal(persisted.token_hash,createHash("sha256").update(forever.token).digest("hex"));
    assert.ok(!JSON.stringify(persisted).includes(forever.token));
    const aliceList=await jsonRequest(h,"/api/identity/tokens",{cookie:alice.cookie});
    const list=(await aliceList.json()).tokens;
    assert.equal(list.length,2);
    assert.ok(!JSON.stringify(list).includes(forever.token));
    assert.equal((await (await jsonRequest(h,"/api/identity/tokens",{cookie:bob.cookie})).json()).tokens.length,0);
    const tools=await callMcpTool(h,{name:"list_workspaces",token:forever.token,arguments:{}});
    assert.equal(tools.isError,undefined,JSON.stringify(tools.structuredContent));
    assert.deepEqual(tools.structuredContent.workspaces.map(w=>w.id),[alice.workspaceId]);
    const forb=await jsonRequest(h,"/api/identity/tokens",{
      method:"DELETE",cookie:bob.cookie,body:{id:forever.id},
    });
    assert.equal(forb.status,404);
    const revoke=await jsonRequest(h,"/api/identity/tokens",{
      method:"DELETE",cookie:alice.cookie,body:{id:forever.id},
    });
    assert.equal(revoke.status,200);
    const init={jsonrpc:"2.0",id:1,method:"initialize",params:{
      protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"pat-test",version:"1.0"},
    }};
    assert.equal((await callMcpRaw(h,init,{token:forever.token})).status,401);
    assert.equal((await callMcpRaw(h,init,{token:short.token})).status,200,
      "revoking one PAT must preserve other PATs");
    await h.db.prepare("UPDATE personal_access_tokens SET expires_at=? WHERE id=?")
      .bind(Math.floor(Date.now()/1000)-1,short.id).run();
    assert.equal((await callMcpRaw(h,init,{token:short.token})).status,401);
    assert.equal((await create(alice.cookie,{name:"invalid",scopes:["xingyu.publish"],lifetime:"never"})).status,400);
    assert.equal((await create(alice.cookie,{name:"invalid",scopes:["xingyu.read","offline_access"],lifetime:"never"})).status,400);
  }finally{await closeTestHarness(h);}
});

test("PAT: suspended user is immediately denied even if token is permanent",async()=>{
  const h=await openTestHarness();
  try{
    const alice=await makeActiveUser(h,"pat-suspend");
    const response=await jsonRequest(h,"/api/identity/tokens",{
      method:"POST",cookie:alice.cookie,
      body:{name:"Permanent",scopes:["xingyu.read"],lifetime:"never"},
    });
    assert.equal(response.status,201,await response.clone().text());
    const {created}=await response.json();
    await h.db.prepare("UPDATE users SET status='suspended' WHERE id=?").bind(alice.id).run();
    const msg={jsonrpc:"2.0",id:1,method:"initialize",params:{
      protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"pat-test",version:"1"},
    }};
    assert.equal((await callMcpRaw(h,msg,{token:created.token})).status,401);
  }finally{await closeTestHarness(h);}
});

test("PAT active-token cap is atomic under concurrent creation",async()=>{
  const h=await openTestHarness();
  try{
    const alice=await makeActiveUser(h,"pat-limit");
    const now=Math.floor(Date.now()/1000);
    for(let i=0;i<29;i++){
      await h.db.prepare(
        "INSERT INTO personal_access_tokens(user_id,name,token_hash,token_suffix,resource,scope,created_at) " +
        "VALUES(?,?,?,?,?,?,?)"
      ).bind(alice.id,"seed-"+i,"a".repeat(62)+i.toString().padStart(2,"0"),"0000",
        h.origin+"/mcp","xingyu.read",now).run();
    }
    const submit=()=>jsonRequest(h,"/api/identity/tokens",{
      method:"POST",cookie:alice.cookie,
      body:{name:"Another device",scopes:["xingyu.read"],lifetime:"never"},
    });
    const results=await Promise.all([submit(),submit()]);
    assert.deepEqual(results.map(response=>response.status).sort(),[201,409]);
    const {total}=await h.db.prepare(
      "SELECT COUNT(*) AS total FROM personal_access_tokens WHERE user_id=? AND revoked_at IS NULL"
    ).bind(alice.id).first();
    assert.equal(total,30);
  }finally{await closeTestHarness(h);}
});

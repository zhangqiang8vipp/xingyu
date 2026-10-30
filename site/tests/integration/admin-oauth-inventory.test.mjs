import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes} from "node:crypto";
import {openTestHarness,closeTestHarness,jsonRequest} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

const newid=()=> "xy_dcr_"+randomBytes(10).toString("hex");
async function client(h,id,name="Google"){
  return h.db.prepare("INSERT INTO oauth_clients(client_id,client_name,redirect_uris,allowed_scopes) VALUES(?,?,?,?)")
    .bind(id,name,'["https://client.example.test/oauth/callback"]',"xingyu.read offline_access").run();
}
async function grant(h,id,user,revoked=false){
  const now=Math.floor(Date.now()/1000);
  return h.db.prepare("INSERT INTO oauth_consents(subject,client_id,resource,granted_scopes,granted_at,revoked_at) VALUES(?,?,?,?,?,?)")
    .bind("user:"+user.id,id,h.origin+"/mcp","xingyu.read offline_access",now,revoked?now:null).run();
}
test("admin connection inventory separates registered apps, verified Xingyu authorizers and safe cleanup",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"connections-owner");
    const outsider=await makeActiveUser(h,"connections-outsider");
    await h.db.prepare("INSERT INTO site_memberships(user_id,role) VALUES(?,'owner')")
      .bind(owner.id).run();
    const active=newid(),expired=newid(),unregistered=newid();
    await client(h,active);
    await client(h,expired);
    await client(h,unregistered);
    await grant(h,active,owner);
    await grant(h,expired,owner,true);

    const initial=await jsonRequest(h,"/api/integrations",{cookie:owner.cookie});
    assert.equal(initial.status,200);
    const initialItems=(await initial.json()).connections;
    const live=initialItems.find(item=>item.id===active);
    assert.equal(live.status,"connected");
    assert.equal(live.name,"Google","dynamic client name is unverified metadata");
    assert.equal(live.registeredName,"Google");
    assert.deepEqual(live.redirectHosts,["client.example.test"]);
    assert.match(live.sessions[0].xingyuAccount,/connections-owner@example\.test/,
      "show account authenticated by Xingyu, not a fake remote OpenAI profile");
    assert.equal(live.sessions[0].lastUsedAt,null,"grant date is not last used");
    assert.equal(initialItems.find(item=>item.id===expired).status,"revoked");
    assert.equal(initialItems.find(item=>item.id===unregistered).status,"configured");
    assert.equal(initialItems.some(item=>item.id==="chatgpt-xingyu"),false,
      "pre-registered ChatGPT isn't an actual connection");

    const denied=await jsonRequest(h,"/api/integrations",{
      method:"PATCH",cookie:outsider.cookie,body:{clientId:active,label:"Other"}});
    assert.equal(denied.status,401);
    const csrf=await jsonRequest(h,"/api/integrations",{
      method:"PATCH",cookie:owner.cookie,headers:{origin:"https://evil.example.test"},
      body:{clientId:active,label:"Bad origin"}});
    assert.equal(csrf.status,401,"cross-origin admin writes must be rejected");

    const renamed=await jsonRequest(h,"/api/integrations",{
      method:"PATCH",cookie:owner.cookie,body:{clientId:active,label:"Gemini 工作号 · 自定义备注"}});
    assert.equal(renamed.status,200,await renamed.clone().text());
    const custom=(await renamed.json()).connections.find(item=>item.id===active);
    assert.equal(custom.name,"Gemini 工作号 · 自定义备注");
    assert.equal(custom.registeredName,"Google","do not falsify original app declaration");

    const sessionRename=await jsonRequest(h,"/api/integrations",{
      method:"PATCH",cookie:owner.cookie,
      body:{clientId:active,subject:"user:"+owner.id,label:"测试帐号的星屿授权"}});
    assert.equal(sessionRename.status,200,await sessionRename.clone().text());
    const named=(await sessionRename.json()).connections.find(item=>item.id===active);
    assert.equal(named.sessions[0].label,"测试帐号的星屿授权");

    const tooLong=await jsonRequest(h,"/api/integrations",{
      method:"PATCH",cookie:owner.cookie,
      body:{clientId:active,label:"A".repeat(41)}});
    assert.equal(tooLong.status,400);

    const cleanupActive=await jsonRequest(h,"/api/integrations",{
      method:"DELETE",cookie:owner.cookie,body:{clientId:active}});
    assert.equal(cleanupActive.status,400,"never erase an active consent");

    const cleaned=await jsonRequest(h,"/api/integrations",{
      method:"DELETE",cookie:owner.cookie,body:{}});
    assert.equal(cleaned.status,200,await cleaned.clone().text());
    const after=(await cleaned.json()).connections;
    assert.ok(after.some(item=>item.id===active&&item.status==="connected"),
      "global cleanup preserves active connection");
    assert.ok(!after.some(item=>item.id===expired),"purged revoked consent and dormant dynamic client");
    assert.ok(!after.some(item=>item.id===unregistered),"purged unconsented DCR");
    const unused=await h.db.prepare("SELECT 1 FROM oauth_clients WHERE client_id=?")
      .bind(unregistered).first();
    assert.equal(unused,null);
    const saved=await h.db.prepare("SELECT label FROM oauth_connection_labels WHERE client_id=? AND subject=?")
      .bind(active,"user:"+owner.id).first();
    assert.equal(saved?.label,"测试帐号的星屿授权");
    assert.ok(await h.db.prepare("SELECT 1 FROM oauth_clients WHERE client_id='chatgpt-xingyu'").first(),
      "built-in ChatGPT registration must never be purged");

    const revoked=await jsonRequest(h,"/api/integrations",{
      method:"POST",cookie:owner.cookie,
      body:{action:"revoke",clientId:active,subject:"user:"+owner.id}});
    assert.equal(revoked.status,200,await revoked.clone().text());
    const clearOne=await jsonRequest(h,"/api/integrations",{
      method:"DELETE",cookie:owner.cookie,
      body:{clientId:active,subject:"user:"+owner.id}});
    assert.equal(clearOne.status,200,await clearOne.clone().text());
    const final=(await clearOne.json()).connections;
    assert.ok(!final.some(item=>item.id===active));
    assert.equal(await h.db.prepare("SELECT 1 FROM oauth_connection_labels WHERE client_id=?")
      .bind(active).first(),null,"purge nickname rows only after associated client/consent is gone");
  }finally{await closeTestHarness(h);}
});

import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {closeTestHarness,openTestHarness,jsonRequest,callMcpRaw,callMcpTool} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

const verifier="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
const callback="https://chatgpt.com/oauth/callback";
function authorization(harness){
  return new URLSearchParams({
    response_type:"code",client_id:"chatgpt-xingyu",redirect_uri:callback,
    resource:harness.origin+"/mcp",state:"local-integration-state",
    scope:"xingyu.read xingyu.draft offline_access",
    code_challenge:createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method:"S256",
  });
}
async function consent(harness,cookie,params){
  const result=await harness.dispatch("/oauth/authorize?"+params.toString(),{
    headers:{cookie},redirect:"manual",
  });
  const html=await result.text();
  assert.equal(result.status,200,html.slice(0,400));
  const token=html.match(/name="consent_token" value="([^"]+)"/)?.[1];
  assert.ok(token,"consent must contain a signed token");
  return token;
}
async function submitConsent(harness,cookie,params,token){
  const payload=new URLSearchParams(params);
  payload.set("consent_token",token);
  payload.set("decision","allow");
  return harness.dispatch("/oauth/authorize",{
    method:"POST",redirect:"manual",
    headers:{cookie,origin:harness.origin,"Content-Type":"application/x-www-form-urlencoded"},
    body:payload.toString(),
  });
}
async function oauthToken(harness,fields){
  const response=await harness.dispatch("/oauth/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams(fields).toString(),
  });
  return {status:response.status,body:await response.json()};
}
test("MCP OAuth login and consent are separate; code, refresh and revocation remain bound to verified user",async()=>{
  const h=await openTestHarness();
  try {
    const alice=await makeActiveUser(h,"oauth-alice");
    const bob=await makeActiveUser(h,"oauth-bob");
    const params=authorization(h);
    const unauth=await h.dispatch("/oauth/authorize?"+params.toString(),{redirect:"manual"});
    assert.equal(unauth.status,302);
    assert.match(unauth.headers.get("location")??"",/\/login\?return_to=/);

    const signed=await consent(h,alice.cookie,params);
    const replayAsBob=await submitConsent(h,bob.cookie,params,signed);
    assert.equal(replayAsBob.status,400,"signed consent must not be reused by another user");

    const allowed=await submitConsent(h,alice.cookie,params,signed);
    assert.equal(allowed.status,302);
    const location=new URL(allowed.headers.get("location")??"");
    assert.equal(location.origin,new URL(callback).origin);
    assert.equal(location.searchParams.get("state"),params.get("state"));
    const code=location.searchParams.get("code");
    assert.match(code??"",/^xy_code_/);

    const exchanged=await oauthToken(h,{
      grant_type:"authorization_code",client_id:"chatgpt-xingyu",
      code,redirect_uri:callback,code_verifier:verifier,resource:h.origin+"/mcp",
    });
    assert.equal(exchanged.status,200,JSON.stringify(exchanged.body));
    const access=exchanged.body.access_token;
    const refresh=exchanged.body.refresh_token;
    assert.match(access??"",/^xy_at_/);
    assert.match(refresh??"",/^xy_rt_/);
    const stored=await h.db.prepare("SELECT subject,scope FROM oauth_access_tokens WHERE token_hash=?")
      .bind(createHash("sha256").update(access).digest("hex")).first();
    assert.equal(stored?.subject,"user:"+alice.id);
    assert.match(stored.scope,/xingyu.read/);

    const once=await oauthToken(h,{
      grant_type:"authorization_code",client_id:"chatgpt-xingyu",
      code,redirect_uri:callback,code_verifier:verifier,resource:h.origin+"/mcp",
    });
    assert.equal(once.status,400,"authorization code is single-use");

    const listed=await callMcpTool(h,{name:"list_workspaces",token:access,arguments:{}});
    assert.equal(listed.isError,undefined,JSON.stringify(listed.structuredContent));
    assert.deepEqual(listed.structuredContent.workspaces.map(w=>w.id),[alice.workspaceId]);

    const ownedConnections=await jsonRequest(h,"/api/identity/connections",{cookie:alice.cookie});
    assert.equal(ownedConnections.status,200);
    const owned=(await ownedConnections.json()).connections;
    assert.equal(owned.length,1);
    assert.equal(owned[0].clientId,"chatgpt-xingyu");
    const otherConnections=await jsonRequest(h,"/api/identity/connections",{cookie:bob.cookie});
    assert.equal((await otherConnections.json()).connections.length,0);

    const rotated=await oauthToken(h,{
      grant_type:"refresh_token",client_id:"chatgpt-xingyu",refresh_token:refresh,
      resource:h.origin+"/mcp",
    });
    assert.equal(rotated.status,200,JSON.stringify(rotated.body));
    assert.match(rotated.body.access_token??"",/^xy_at_/);
    const duplicateRefresh=await oauthToken(h,{
      grant_type:"refresh_token",client_id:"chatgpt-xingyu",refresh_token:refresh,
      resource:h.origin+"/mcp",
    });
    assert.equal(duplicateRefresh.status,400,"refresh-token reuse must fail");

    // Following a refresh reuse event the entire family is revoked; disconnect must also be safe.
    const revoked=await jsonRequest(h,"/api/identity/connections",{
      method:"DELETE",cookie:alice.cookie,body:{client_id:"chatgpt-xingyu"},
    });
    const revokedBody=await revoked.text();
    assert.equal(revoked.status,200,revokedBody);
    const body={jsonrpc:"2.0",id:11,method:"initialize",params:{
      protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"identity-integration",version:"1.0.0"},
    }};
    const denied=await callMcpRaw(h,body,{token:access});
    assert.equal(denied.status,401,"revocation must stop previously issued access tokens");
    const after=await jsonRequest(h,"/api/identity/connections",{cookie:alice.cookie});
    assert.equal((await after.json()).connections.length,0);
  }finally{await closeTestHarness(h);}
});

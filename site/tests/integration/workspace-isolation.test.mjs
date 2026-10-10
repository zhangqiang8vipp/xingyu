import assert from "node:assert/strict";
import test from "node:test";
import { createHash,randomBytes } from "node:crypto";
import { makeActiveUser as makeUser } from "./identity-fixtures.mjs";
import {
  callMcpTool,closeTestHarness,jsonRequest,openTestHarness,
} from "./harness.mjs";

const normHash=raw=>createHash("sha256").update(raw).digest("hex");
async function tokenFor(harness,userId,scopes="xingyu.read xingyu.draft xingyu.publish offline_access"){
  const bearer="xy_at_"+randomBytes(32).toString("base64url");
  const now=Math.floor(Date.now()/1000);
  await harness.db.prepare(
    "INSERT INTO oauth_access_tokens(token_hash,client_id,subject,resource,scope,expires_at) VALUES(?,?,?,?,?,?)",
  ).bind(normHash(bearer),"chatgpt-xingyu","user:"+userId,harness.origin+"/mcp",scopes,now+3600).run();
  return bearer;
}
test("two users stay isolated in web and OAuth MCP workspaces",async()=>{
  const harness=await openTestHarness();
  try{
    const a=await makeUser(harness,"alice");
    const b=await makeUser(harness,"bob");
    assert.notEqual(a.workspaceId,b.workspaceId);
    const anonymous=await jsonRequest(harness,"/api/workspaces/"+a.workspaceId+"/posts");
    assert.equal(anonymous.status,401);

    const created=await jsonRequest(harness,"/api/workspaces/"+a.workspaceId+"/posts",{
      method:"POST",cookie:a.cookie,
      body:{title:"Alice private research",content_markdown:"# Alice confidential notes\nPrivate text here."},
    });
    const createdData=await created.json();
    assert.equal(created.status,201,JSON.stringify(createdData));
    const article=createdData.post;
    assert.ok(article.publicId);
    assert.equal(article.workspaceId,a.workspaceId);
    assert.ok(article.spaceId,"ordinary-user posts must always be in a private space");

    const forbidden=await jsonRequest(harness,"/api/workspaces/"+a.workspaceId+"/posts/"+article.publicId,{
      cookie:b.cookie,
    });
    assert.ok([403,404].includes(forbidden.status));
    const cross=await jsonRequest(harness,"/api/workspaces/"+b.workspaceId+"/posts/"+article.publicId,{
      cookie:b.cookie,
    });
    assert.equal(cross.status,404);

    const oldPublic=await harness.dispatch("/posts/"+article.publicId+"/"+article.slug);
    assert.equal(oldPublic.status,404,"personal notes cannot be reached by public URLs");
    const aToken=await tokenFor(harness,a.id);
    const bToken=await tokenFor(harness,b.id);
    const aSpaces=await callMcpTool(harness,{name:"list_workspaces",token:aToken,arguments:{}});
    assert.equal(aSpaces.isError,undefined,JSON.stringify(aSpaces.structuredContent));
    assert.equal(aSpaces.structuredContent.workspaces.length,1);
    assert.equal(aSpaces.structuredContent.workspaces[0].id,a.workspaceId);

    const bForbidden=await callMcpTool(harness,{
      name:"get_post",token:bToken,arguments:{
        workspace_id:a.workspaceId,identifier:article.publicId,view:"content",
      },
    });
    assert.equal(bForbidden.isError,true,"MCP token cannot select another user's workspace");
    const bHidden=await callMcpTool(harness,{
      name:"get_post",token:bToken,arguments:{
        workspace_id:b.workspaceId,identifier:article.publicId,view:"content",
      },
    });
    assert.equal(bHidden.isError,true,"article ID should not authorize cross-workspace content reads");

    const aRead=await callMcpTool(harness,{
      name:"get_post",token:aToken,arguments:{
        workspace_id:a.workspaceId,identifier:article.publicId,view:"content",
      },
    });
    assert.equal(aRead.isError,undefined,JSON.stringify(aRead.structuredContent));
    assert.match(aRead.structuredContent.post.content_markdown,/Alice confidential notes/);

    const bWrite=await callMcpTool(harness,{
      name:"create_draft",token:bToken,arguments:{
        workspace_id:a.workspaceId,title:"Cross user write",content_markdown:"should not persist",
      },
    });
    assert.equal(bWrite.isError,true,"MCP write must re-check workspace membership");
    const count=await harness.db.prepare("SELECT COUNT(*) AS n FROM posts WHERE title='Cross user write'").first();
    assert.equal(count.n,0);
  }finally{await closeTestHarness(harness);}
});
test("workspace foreign-key-style D1 guards reject invalid cross-tenant references",async()=>{
  const harness=await openTestHarness();
  try{
    const a=await makeUser(harness,"guard-a");
    const b=await makeUser(harness,"guard-b");
    const catA=await harness.db.prepare("SELECT id FROM categories WHERE workspace_id=? LIMIT 1").bind(a.workspaceId).first();
    const spaceB=await harness.db.prepare("SELECT id FROM spaces WHERE workspace_id=? LIMIT 1").bind(b.workspaceId).first();
    assert.ok(catA?.id&&spaceB?.id);
    await assert.rejects(harness.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,category_id,space_id) VALUES(?,?,'Cross','cross-workspace-test',?,?)",
    ).bind(a.workspaceId,"ws-cross-should-fail",catA.id,spaceB.id).run());
    await assert.rejects(harness.db.prepare(
      "INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,?,'Cross','foreign-parent')",
    ).bind(a.workspaceId,spaceB.id).run());
  }finally{await closeTestHarness(harness);}
});

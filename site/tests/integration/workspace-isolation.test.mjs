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
    const marked=await jsonRequest(harness,"/api/workspaces/"+a.workspaceId+"/posts/"+article.publicId+"/status",{
      method:"POST",cookie:a.cookie,body:{expected_version:article.version,status:"published"},
    });
    const markedData=await marked.json();
    assert.equal(marked.status,200,JSON.stringify(markedData));
    assert.equal(markedData.post.status,"published");
    assert.ok(markedData.post.spaceId,"marked-as-complete personal content stays private");

    // Authenticated R2 objects must never leak via another workspace ID or old public media routes.
    const boundary="xingyu-private-upload-"+randomBytes(10).toString("hex");
    const multipart=[
      "--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"alice-secret.txt\"\r\nContent-Type: text/plain\r\n\r\n",
      "ALICE ATTACHMENT SECRET\r\n",
      "--"+boundary+"\r\nContent-Disposition: form-data; name=\"post_identifier\"\r\n\r\n",
      article.publicId+"\r\n",
      "--"+boundary+"--\r\n",
    ].join("");
    // Next/vinext validates multipart Origin against Host separately from JSON API requests.
    const uploadUrl=new URL("/api/workspaces/"+a.workspaceId+"/attachments",harness.origin);
    const uploaded=await harness.dispatch(uploadUrl.toString(),{
      method:"POST",
      headers:{host:uploadUrl.host,origin:uploadUrl.origin,cookie:a.cookie,
        "content-type":"multipart/form-data; boundary="+boundary},
      body:multipart,
    });
    const uploadResponse=await uploaded.text();
    assert.equal(uploaded.status,201,uploadResponse);
    const uploadData=JSON.parse(uploadResponse);
    const attachmentId=uploadData.attachment.public_id;
    const ownFile=await harness.dispatch("/api/workspaces/"+a.workspaceId+"/attachments/"+attachmentId,{
      headers:{cookie:a.cookie},
    });
    assert.equal(ownFile.status,200);
    assert.equal(await ownFile.text(),"ALICE ATTACHMENT SECRET");
    const othersFile=await harness.dispatch("/api/workspaces/"+a.workspaceId+"/attachments/"+attachmentId,{
      headers:{cookie:b.cookie},
    });
    assert.ok([403,404].includes(othersFile.status),"another user cannot fetch file through the owner's route");
    const foreignFile=await harness.dispatch("/api/workspaces/"+b.workspaceId+"/attachments/"+attachmentId,{
      headers:{cookie:b.cookie},
    });
    assert.equal(foreignFile.status,404,"guessed attachment id cannot bypass workspace filter");
    const anonymousFile=await harness.dispatch("/api/workspaces/"+a.workspaceId+"/attachments/"+attachmentId);
    assert.equal(anonymousFile.status,401);
    const oldFile=await harness.dispatch("/api/attachments/"+attachmentId+"/alice-secret.txt");
    assert.notEqual(oldFile.status,200,"legacy public attachment route cannot serve tenant files");
    const objectKey=(await harness.db.prepare("SELECT object_key FROM attachments WHERE public_id=?")
      .bind(attachmentId).first())?.object_key;
    assert.match(objectKey??"",/^attachments\/ws\d+\//);
    const guessedR2=await harness.dispatch("/api/media/"+objectKey);
    assert.equal(guessedR2.status,404,"legacy R2 media route must not expose tenant paths");


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

    const publishedSearch=await callMcpTool(harness,{
      name:"search_posts",token:aToken,arguments:{
        workspace_id:a.workspaceId,query:"Alice private research",status:"published",
      },
    });
    assert.equal(publishedSearch.isError,undefined,JSON.stringify(publishedSearch.structuredContent));
    assert.equal(publishedSearch.structuredContent.posts.length,1);
    assert.equal(publishedSearch.structuredContent.posts[0].public_id,article.publicId);
    const draftSearch=await callMcpTool(harness,{
      name:"search_posts",token:aToken,arguments:{
        workspace_id:a.workspaceId,query:"Alice private research",status:"draft",
      },
    });
    assert.deepEqual(draftSearch.structuredContent.posts,[],"MCP status filter executes inside workspace SQL");
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

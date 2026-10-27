import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,createHash} from "node:crypto";
import {openTestHarness,closeTestHarness,jsonRequest,callMcpTool,callMcpRaw,loginAdmin} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

const digest=value=>createHash("sha256").update(value).digest("hex");
async function api(h,path,{cookie,method="GET",body}={}){
  const response=await jsonRequest(h,path,{cookie,method,body});
  return {status:response.status,body:await response.json().catch(()=>({}))};
}
async function tokenFor(h,userId,clientId){
  const token="xy_at_"+randomBytes(32).toString("base64url");
  await h.db.prepare("INSERT INTO oauth_access_tokens(token_hash,client_id,subject,resource,scope,expires_at) VALUES(?,?,?,?,?,?)")
    .bind(digest(token),clientId,"user:"+userId,h.origin+"/mcp","xingyu.read xingyu.draft",
      Math.floor(Date.now()/1000)+3600).run();
  return token;
}
async function invite(h,spaceId,workspaceId,email,actorId,role="editor"){
  const token=randomBytes(32).toString("base64url");
  const expiry=Math.floor(Date.now()/1000)+3600;
  await h.db.prepare("INSERT INTO space_collaboration_invites(space_id,workspace_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,?,?,?,?,?)")
    .bind(spaceId,workspaceId,email,role,digest(token),actorId,expiry).run();
  return token;
}
async function rootOf(h,workspaceId){
  const row=await h.db.prepare("SELECT id FROM spaces WHERE workspace_id=? AND parent_id IS NULL ORDER BY id LIMIT 1").bind(workspaceId).first();
  assert.ok(row?.id);
  return row.id;
}
test("invited user and two AI clients merge independent Markdown edits without obtaining workspace access",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"collab-owner");
    const member=await makeActiveUser(h,"collab-editor");
    const outsider=await makeActiveUser(h,"collab-outsider");
    const spaceId=await rootOf(h,owner.workspaceId);
    const base="/api/space-collaboration/"+spaceId;
    const forbidden=await api(h,base,{cookie:member.cookie});
    assert.equal(forbidden.status,404);
    const sibling=await h.db.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,NULL,'Uninvited private sibling',?) RETURNING id")
      .bind(owner.workspaceId,"private-"+randomBytes(8).toString("hex")).first();
    const token=await invite(h,spaceId,owner.workspaceId,member.email,owner.id);
    assert.equal((await api(h,"/api/space-invitations?token="+token,{cookie:outsider.cookie})).status,404);
    const shown=await api(h,"/api/space-invitations?token="+token,{cookie:member.cookie});
    assert.equal(shown.status,200);
    assert.equal(shown.body.invitation.spaceId,spaceId);
    assert.equal((await api(h,"/api/space-invitations",{cookie:member.cookie,method:"POST",body:{token}})).status,200);
    assert.equal((await api(h,"/api/space-invitations",{cookie:member.cookie,method:"POST",body:{token}})).status,404);
    assert.equal((await api(h,base,{cookie:member.cookie})).status,200);
    assert.equal((await api(h,"/api/space-collaboration/"+sibling.id,{cookie:member.cookie})).status,404);
    assert.equal((await api(h,"/api/workspaces/"+owner.workspaceId+"/posts",{cookie:member.cookie})).status,404,
      "a space invitation must not grant workspace-wide article access");

    const created=await api(h,base,{cookie:member.cookie,method:"POST",body:{
      action:"create_document",title:"Two AI editors",content:"# Runbook\n## Deployment\noriginal deploy\n## Recovery\noriginal recovery",
    }});
    assert.equal(created.status,201,JSON.stringify(created.body));
    const postId=created.body.result.publicId;
    assert.ok(postId);
    const original=created.body.result;
    assert.equal(original.version,1);
    const a=await tokenFor(h,member.id,"chatgpt-xingyu");
    const b=await tokenFor(h,member.id,"grok-xingyu");
    const agentA=await callMcpTool(h,{name:"propose_document_change",token:a,arguments:{
      public_id:postId,base_version:1,
      content_markdown:"# Runbook\n## Deployment\nnew deploy\n## Recovery\noriginal recovery",
      change_summary:"Agent A: update deployment",
    }});
    assert.equal(agentA.structuredContent.result.status,"merged",JSON.stringify(agentA.structuredContent));
    assert.equal(agentA.structuredContent.result.version,2);
    const agentB=await callMcpTool(h,{name:"propose_document_change",token:b,arguments:{
      public_id:postId,base_version:1,
      content_markdown:"# Runbook\n## Deployment\noriginal deploy\n## Recovery\nnew recovery",
      change_summary:"Agent B: update recovery",
    }});
    assert.equal(agentB.structuredContent.result.status,"merged",JSON.stringify(agentB.structuredContent));
    assert.equal(agentB.structuredContent.result.autoMerged,true);
    assert.equal(agentB.structuredContent.result.version,3);
    const document=await api(h,"/api/space-collaboration/documents/"+postId,{cookie:member.cookie});
    assert.equal(document.body.document.version,3);
    assert.match(document.body.document.content,/new deploy/);
    assert.match(document.body.document.content,/new recovery/);
    const versions=await api(h,"/api/space-collaboration/documents/"+postId+"?history=1",{cookie:member.cookie});
    assert.deepEqual(versions.body.revisions.map(v=>v.version),[3,2,1]);

    const agentA2=await callMcpTool(h,{name:"propose_document_change",token:a,arguments:{
      public_id:postId,base_version:3,
      content_markdown:"# Runbook\n## Deployment\nagent A update\n## Recovery\nnew recovery",
      change_summary:"Agent A: overlapping update",
    }});
    assert.equal(agentA2.structuredContent.result.version,4);
    const overlapping=await callMcpTool(h,{name:"propose_document_change",token:b,arguments:{
      public_id:postId,base_version:3,
      content_markdown:"# Runbook\n## Deployment\nagent B update\n## Recovery\nnew recovery",
      change_summary:"Agent B: overlapping update",
    }});
    assert.equal(overlapping.structuredContent.result.status,"conflict");
    const proposalId=overlapping.structuredContent.result.proposalId;
    const beforeReview=await api(h,"/api/space-collaboration/documents/"+postId,{cookie:member.cookie});
    assert.equal(beforeReview.body.document.version,4);
    assert.doesNotMatch(beforeReview.body.document.content,/agent B update/);
    const resolveMember=await api(h,"/api/space-collaboration/documents/"+postId,{cookie:member.cookie,method:"POST",body:{
      action:"resolve",proposalId,expectedVersion:4,content:"# merged reviewed",
    }});
    assert.equal(resolveMember.status,403);
    const resolveOwner=await api(h,"/api/space-collaboration/documents/"+postId,{cookie:owner.cookie,method:"POST",body:{
      action:"resolve",proposalId,expectedVersion:4,
      content:"# Runbook\n## Deployment\nagent A and B reviewed\n## Recovery\nnew recovery",
    }});
    assert.equal(resolveOwner.status,200,JSON.stringify(resolveOwner.body));
    assert.equal(resolveOwner.body.result.version,5);

    const revoke=await api(h,base,{cookie:owner.cookie,method:"POST",body:{action:"remove_member",userId:member.id}});
    assert.equal(revoke.status,200);
    assert.equal((await api(h,"/api/space-collaboration/documents/"+postId,{cookie:member.cookie})).status,404);
    const denied=await callMcpTool(h,{name:"propose_document_change",token:b,arguments:{
      public_id:postId,base_version:5,content_markdown:"stale agent update",change_summary:"revoked agent",
    }});
    assert.equal(denied.isError,true);
    const safe=await api(h,"/api/space-collaboration/documents/"+postId,{cookie:owner.cookie});
    assert.equal(safe.body.document.version,5,"revoked AI must not alter content");
  }finally{await closeTestHarness(h);}
});
test("subspaces inherit permissions until an admin restricts them; invitations fail closed without mail",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"collab-tree-owner");
    const invited=await makeActiveUser(h,"collab-tree-invited");
    const root=await rootOf(h,owner.workspaceId);
    const token=await invite(h,root,owner.workspaceId,invited.email,owner.id);
    assert.equal((await api(h,"/api/space-invitations",{method:"POST",cookie:invited.cookie,body:{token}})).status,200);
    const parent="/api/space-collaboration/"+root;
    const child=await api(h,parent,{method:"POST",cookie:invited.cookie,body:{action:"create_child",name:"Engineering"}});
    assert.equal(child.status,201);
    const childId=child.body.result.id;
    assert.equal((await api(h,"/api/space-collaboration/"+childId,{cookie:invited.cookie})).status,200);
    const disposable=await api(h,parent,{method:"POST",cookie:invited.cookie,body:{action:"create_child",name:"Temporary empty child"}});
    assert.equal(disposable.status,201);
    const removed=await api(h,"/api/space-collaboration/"+disposable.body.result.id,{method:"POST",cookie:invited.cookie,body:{action:"delete_empty"}});
    assert.equal(removed.status,200,"invited editor may safely remove an empty unshared child");
    const restricted=await api(h,"/api/space-collaboration/"+childId,{method:"POST",cookie:owner.cookie,
      body:{action:"set_inheritance",enabled:false}});
    assert.equal(restricted.status,200);
    assert.equal((await api(h,"/api/space-collaboration/"+childId,{cookie:invited.cookie})).status,404);
    assert.equal((await api(h,parent,{cookie:invited.cookie})).body.children.some(s=>s.id===childId),false);
    const missingMailer=await api(h,parent,{method:"POST",cookie:owner.cookie,body:{
      action:"invite",email:"new-guest@example.test",role:"viewer",
    }});
    assert.equal(missingMailer.status,503,"unconfigured mail transport must never silently succeed");
    const pending=await h.db.prepare("SELECT COUNT(*) AS n FROM space_collaboration_invites WHERE space_id=? AND email='new-guest@example.test'")
      .bind(root).first();
    assert.equal(pending.n,0);
  }finally{await closeTestHarness(h);}
});


test("OAuth MCP actually advertises invitation-scoped collaboration tools and correct agent instructions", async () => {
  const h=await openTestHarness();
  try {
    const owner=await makeActiveUser(h,"mcp-collab-discovery-owner");
    const invited=await makeActiveUser(h,"mcp-collab-discovery-editor");
    const outsider=await makeActiveUser(h,"mcp-collab-discovery-outsider");
    const root=await rootOf(h,owner.workspaceId);
    const inviteToken=await invite(h,root,owner.workspaceId,invited.email,owner.id);
    const accepted=await api(h,"/api/space-invitations",{cookie:invited.cookie,method:"POST",body:{token:inviteToken}});
    assert.equal(accepted.status,200);

    const ownerToken=await tokenFor(h,owner.id,"chatgpt-owner-discovery");
    const memberToken=await tokenFor(h,invited.id,"claude-invited-discovery");
    const outsiderToken=await tokenFor(h,outsider.id,"grok-not-invited");
    const required=[
      "list_collaboration_spaces",
      "list_collaboration_navigation",
      "list_collaboration_documents",
      "get_collaboration_document",
      "create_collaboration_document",
      "invite_space_member",
      "propose_document_change",
      "get_document_conflict",
      "resolve_document_conflict",
      "list_document_revisions",
    ];
    for (const token of [ownerToken,memberToken]){
      const init=await callMcpRaw(h,{jsonrpc:"2.0",id:1,method:"initialize",
        params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"xingyu-collab-discovery",version:"1.0.0"}}},{token});
      assert.equal(init.status,200,init.text);
      const instructions=String(init.payload?.result?.instructions??"");
      assert.match(instructions,/list_collaboration_spaces/, "MCP must guide AI to shared spaces");
      assert.match(instructions,/propose_document_change/, "MCP must prefer three-way merged writes");

      const listed=await callMcpRaw(h,{jsonrpc:"2.0",id:2,method:"tools/list",params:{}},{token});
      assert.equal(listed.status,200,listed.text);
      const names=new Set((listed.payload?.result?.tools??[]).map(t=>t.name));
      for(const name of required)assert.ok(names.has(name),"MCP tools/list missing "+name);

      const available=await callMcpTool(h,{name:"list_collaboration_spaces",token,arguments:{}});
      assert.equal(available.structuredContent?.ok,true,JSON.stringify(available.structuredContent));
      assert.ok(available.structuredContent?.result?.some(s=>s.id===root),
        "Invited or owner account must discover their own space in MCP");
    }
    const denied=await callMcpTool(h,{name:"list_collaboration_documents",token:outsiderToken,
      arguments:{space_id:root}});
    assert.equal(denied.isError,true);
    assert.equal(denied.structuredContent?.ok,false);
  }finally {await closeTestHarness(h);}
});


test("legacy owner OAuth MCP manifests must include newly added collaboration tools", async () => {
  const h=await openTestHarness();
  try{
    const existing=await h.db.prepare("SELECT id FROM spaces WHERE workspace_id=1 ORDER BY id LIMIT 1").first();
    const spaceId=existing?.id??(await h.db.prepare(
      "INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(1,NULL,'Owner MCP collaboration','owner-mcp-collaboration') RETURNING id"
    ).first()).id;
    const token=await tokenFor(h,1,"chatgpt-owner");
    const advertised=await callMcpRaw(h,{jsonrpc:"2.0",id:7,method:"tools/list",params:{}},{token});
    assert.equal(advertised.status,200,advertised.text);
    const names=new Set((advertised.payload?.result?.tools??[]).map(t=>t.name));
    for(const required of ["list_spaces","create_draft","list_collaboration_spaces","get_collaboration_document","propose_document_change"]){
      assert.ok(names.has(required),"Owner MCP must advertise "+required);
    }
    const result=await callMcpTool(h,{name:"list_collaboration_spaces",token,arguments:{}});
    assert.equal(result.structuredContent?.ok,true,JSON.stringify(result.structuredContent));
    assert.ok(result.structuredContent.result.some(s=>s.id===spaceId),
      "A root space created by the existing owner must be discoverable by collaboration MCP");
  }finally{await closeTestHarness(h);}
});


test("knowledge space UI shows invited ancestor path but never sibling content, with role-specific actions",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"space-ui-owner");
    const editor=await makeActiveUser(h,"space-ui-editor");
    const viewer=await makeActiveUser(h,"space-ui-viewer");
    const outsider=await makeActiveUser(h,"space-ui-outsider");
    const root=await rootOf(h,owner.workspaceId);
    const target=(await h.db.prepare(
      "INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,?,'交接文档',?) RETURNING id"
    ).bind(owner.workspaceId,root,"handoff-"+randomBytes(4).toString("hex")).first()).id;
    const privateSibling=(await h.db.prepare(
      "INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,?,'Confidential sibling',?) RETURNING id"
    ).bind(owner.workspaceId,root,"private-"+randomBytes(4).toString("hex")).first()).id;
    const child=(await h.db.prepare(
      "INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,?,'卫健委',?) RETURNING id"
    ).bind(owner.workspaceId,target,"health-"+randomBytes(4).toString("hex")).first()).id;

    const ownerNavigation=await api(h,"/api/space-collaboration/navigation",{cookie:owner.cookie});
    assert.equal(ownerNavigation.status,200);
    assert.ok(ownerNavigation.body.nodes.some(n=>n.id===root&&n.canRead),
      "owner can discover their own personal space without inviting themselves");
    const denied=await api(h,"/api/spaces/"+target,{cookie:outsider.cookie});
    assert.equal(denied.status,404,"non-invitee must not discover the target");
    const editorToken=await invite(h,target,owner.workspaceId,editor.email,owner.id);
    const viewerToken=await invite(h,target,owner.workspaceId,viewer.email,owner.id,"viewer");
    assert.equal((await api(h,"/api/space-invitations",{cookie:editor.cookie,method:"POST",body:{token:editorToken}})).status,200);
    assert.equal((await api(h,"/api/space-invitations",{cookie:viewer.cookie,method:"POST",body:{token:viewerToken}})).status,200);
    const privateDoc=await api(h,"/api/space-collaboration/"+privateSibling,{cookie:owner.cookie,method:"POST",body:{
      action:"create_document",title:"Secret sibling content",content:"NOT-FOR-INVITEES",
    }});
    assert.equal(privateDoc.status,201,JSON.stringify(privateDoc.body));
    const publicDoc=await api(h,"/api/space-collaboration/"+target,{cookie:editor.cookie,method:"POST",body:{
      action:"create_document",title:"交接清单",content:"# 交接清单\n## 卫健委",
    }});
    assert.equal(publicDoc.status,201,JSON.stringify(publicDoc.body));

    for(const user of [editor,viewer]){
      const list=await api(h,"/api/space-collaboration/navigation",{cookie:user.cookie});
      assert.equal(list.status,200,JSON.stringify(list.body));
      const nodes=list.body.nodes;
      assert.ok(nodes.some(n=>n.id===root&&n.ancestorOnly&&n.canRead===false),"parent name is visible only as breadcrumb");
      assert.ok(nodes.some(n=>n.id===target&&n.canRead&&n.parentId===root));
      assert.ok(nodes.some(n=>n.id===child&&n.canRead&&n.parentId===target));
      assert.equal(nodes.some(n=>n.id===privateSibling),false,"sibling must not be discoverable");

      const roots=await api(h,"/api/spaces?parent=root",{cookie:user.cookie});
      assert.equal(roots.status,200);
      const ownedParent=roots.body.spaces.find(n=>n.id===root);
      assert.equal(ownedParent?.ancestorOnly,true);
      assert.equal(ownedParent?.articleCount,0);

      const breadcrumbs=await api(h,"/api/spaces/"+root,{cookie:user.cookie});
      assert.equal(breadcrumbs.status,200,JSON.stringify(breadcrumbs.body));
      assert.equal(breadcrumbs.body.space.canRead,false);
      assert.deepEqual(breadcrumbs.body.space.children.map(n=>n.id),[target]);
      assert.equal(breadcrumbs.body.space.articleCount,0);
      assert.equal((await api(h,"/api/spaces/"+root+"/posts?scope=all",{cookie:user.cookie})).body.rows.length,0);

      const subtree=await api(h,"/api/spaces?parent="+root,{cookie:user.cookie});
      assert.deepEqual(subtree.body.spaces.map(n=>n.id),[target]);
      const own=await api(h,"/api/spaces/"+target,{cookie:user.cookie});
      assert.equal(own.status,200);
      assert.deepEqual(own.body.space.path.map(n=>n.id),[root,target]);
      assert.equal(own.body.space.isInvited,true);
      assert.equal(own.body.space.canWrite,user===editor);
      assert.equal(own.body.space.canManage,false);
      assert.deepEqual(own.body.space.children.map(n=>n.id),[child]);

      const posts=await api(h,"/api/spaces/"+target+"/posts?scope=all",{cookie:user.cookie});
      assert.equal(posts.status,200,JSON.stringify(posts.body));
      assert.deepEqual(posts.body.rows.map(n=>n.title),["交接清单"]);
      assert.ok(posts.body.rows[0].spacePath.endsWith("交接文档"));
      assert.ok(!JSON.stringify(posts.body).includes("NOT-FOR-INVITEES"));
      assert.equal((await api(h,"/api/spaces/"+privateSibling,{cookie:user.cookie})).status,404);
      assert.equal((await api(h,"/api/spaces/"+privateSibling+"/posts",{cookie:user.cookie})).status,404);
    }
    assert.equal((await api(h,"/api/space-collaboration/"+target,{cookie:viewer.cookie,method:"POST",body:{
      action:"create_child",name:"Should not exist",
    }})).status,403);

    const blocked=await api(h,"/api/space-collaboration/"+child,{cookie:owner.cookie,method:"POST",body:{
      action:"set_inheritance",enabled:false,
    }});
    assert.equal(blocked.status,200);
    assert.equal((await api(h,"/api/spaces/"+child,{cookie:editor.cookie})).status,404);
    const filtered=await api(h,"/api/spaces?parent="+target,{cookie:editor.cookie});
    assert.deepEqual(filtered.body.spaces.map(n=>n.id),[]);
    const removed=await api(h,"/api/space-collaboration/"+target,{cookie:owner.cookie,method:"POST",body:{
      action:"remove_member",userId:editor.id,
    }});
    assert.equal(removed.status,200);
    assert.equal((await api(h,"/api/spaces/"+target,{cookie:editor.cookie})).status,404);
    assert.equal((await api(h,"/api/space-collaboration/navigation",{cookie:editor.cookie})).body.nodes.some(n=>n.id===root),false);
  }finally{await closeTestHarness(h);}
});

test("legacy password owner can manage invitations from the native space menu",async()=>{
  const h=await openTestHarness();
  try{
    const adminCookie=await loginAdmin(h);
    const existing=await h.db.prepare("SELECT id FROM spaces WHERE workspace_id=1 AND parent_id IS NULL LIMIT 1").first();
    const root=existing?.id??(await h.db.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(1,NULL,?,?) RETURNING id")
      .bind("网站管理空间","admin-test-"+randomBytes(6).toString("hex")).first()).id;
    const managed=await api(h,"/api/space-collaboration/"+root,{cookie:adminCookie});
    assert.equal(managed.status,200,JSON.stringify(managed.body));
    assert.equal(managed.body.access.canManage,true);
    assert.ok(Array.isArray(managed.body.members));
    const anonymous=await api(h,"/api/space-collaboration/"+root);
    assert.equal(anonymous.status,401);
  }finally{await closeTestHarness(h);}
});


test("organization owners navigate their own knowledge trees; external invitees see path only",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"org-collab-owner");
    const member=await makeActiveUser(h,"org-collab-invitee");
    const suffix=randomBytes(6).toString("hex");
    const organization=await api(h,"/api/organizations",{cookie:owner.cookie,method:"POST",body:{name:"协作组织-"+suffix}});
    assert.equal(organization.status,201,JSON.stringify(organization.body));
    const orgId=organization.body.organization.id;
    const ws=(await h.db.prepare("INSERT INTO workspaces(kind,owner_user_id,slug,name,status) VALUES('organization',?,?,?,'active') RETURNING id")
      .bind(owner.id,"org-shared-"+suffix,"组织知识空间").first()).id;
    await h.db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,?,'owner','active')")
      .bind(ws,owner.id).run();
    await h.db.prepare("INSERT INTO organization_workspaces(organization_id,workspace_id) VALUES(?,?)")
      .bind(orgId,ws).run();
    const root=(await h.db.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,NULL,?,?) RETURNING id")
      .bind(ws,"组织顶级空间","org-root-"+suffix).first()).id;
    const shared=(await h.db.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,?,?,?) RETURNING id")
      .bind(ws,root,"交接文档","org-handoff-"+suffix).first()).id;
    const other=(await h.db.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,?,?,?) RETURNING id")
      .bind(ws,root,"其他机密","org-private-"+suffix).first()).id;
    const ownerRoot=await api(h,"/api/spaces?parent=root",{cookie:owner.cookie});
    assert.equal(ownerRoot.status,200);
    assert.ok(ownerRoot.body.spaces.some(n=>n.id===root&&n.canManage&&!n.ancestorOnly),
      "organization owner does not need a self-invitation to reach their tree");
    assert.equal((await api(h,"/api/spaces/"+root,{cookie:member.cookie})).status,404);

    const token=await invite(h,shared,ws,member.email,owner.id);
    assert.equal((await api(h,"/api/space-invitations",{cookie:member.cookie,method:"POST",body:{token}})).status,200);
    const memberRoot=await api(h,"/api/spaces?parent=root",{cookie:member.cookie});
    assert.equal(memberRoot.status,200);
    assert.equal(memberRoot.body.spaces.find(n=>n.id===root)?.ancestorOnly,true);
    const branch=await api(h,"/api/spaces?parent="+root,{cookie:member.cookie});
    assert.deepEqual(branch.body.spaces.map(n=>n.id),[shared]);
    assert.equal((await api(h,"/api/spaces/"+shared,{cookie:member.cookie})).body.space.canWrite,true);
    assert.equal((await api(h,"/api/spaces/"+other,{cookie:member.cookie})).status,404);
  }finally{await closeTestHarness(h);}
});

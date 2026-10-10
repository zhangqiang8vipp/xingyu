import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomBytes} from "node:crypto";
import {openTestHarness,closeTestHarness,jsonRequest,callMcpTool} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

const hash=text=>createHash("sha256").update(text).digest("hex");
async function call(h,url,opts){
  const res=await jsonRequest(h,url,opts);
  return {status:res.status,data:await res.json().catch(()=>({}))};
}
async function org(h,user,name="组织知识协作"){
  const r=await call(h,"/api/organizations",{method:"POST",cookie:user.cookie,body:{name}});
  assert.equal(r.status,201,JSON.stringify(r.data));
  return r.data.organization;
}
async function join(h,organization,user,inviter) {
  const token=randomBytes(32).toString("base64url");
  await h.db.prepare(
    "INSERT INTO organization_invitations(organization_id,email,role,token_hash,invited_by,expires_at) "+
    "VALUES(?,?,'member',?,?,?)",
  ).bind(organization.id,user.email,hash(token),inviter.id,Math.floor(Date.now()/1000)+3600).run();
  const res=await call(h,"/api/organization-invitations",{method:"POST",cookie:user.cookie,body:{token}});
  assert.equal(res.status,200,JSON.stringify(res.data));
}
async function team(h,organization,owner,name){
  const result=await call(h,"/api/organizations/"+organization.id+"/teams",{
    method:"POST",cookie:owner.cookie,body:{name},
  });
  assert.equal(result.status,201,JSON.stringify(result.data));return result.data.team;
}
async function addTeamMember(h,organization,teamId,owner,user){
  const result=await call(h,"/api/organizations/"+organization.id+"/teams/"+teamId+"/members",{
    method:"POST",cookie:owner.cookie,body:{userId:user.id},
  });
  assert.equal(result.status,200,JSON.stringify(result.data));
}
async function workspace(h,organization,owner){
  const result=await call(h,"/api/organizations/"+organization.id+"/workspaces",{
    method:"POST",cookie:owner.cookie,body:{name:"AI 开发知识库"},
  });
  assert.equal(result.status,201,JSON.stringify(result.data));
  assert.equal(result.data.workspace.kind,"organization");
  return result.data.workspace;
}
async function grant(h,organization,workspaceId,teamId,owner,role){
  const result=await call(h,"/api/organizations/"+organization.id+"/workspaces/"+workspaceId+"/grants",{
    method:"POST",cookie:owner.cookie,body:{teamId,role},
  });
  assert.equal(result.status,201,JSON.stringify(result.data));
}
async function mcpToken(h,userId,scopes="xingyu.read xingyu.draft xingyu.publish"){
  const token="xy_at_"+randomBytes(32).toString("base64url");
  await h.db.prepare(
    "INSERT INTO oauth_access_tokens(token_hash,client_id,subject,resource,scope,expires_at) VALUES(?,?,?,?,?,?)",
  ).bind(hash(token),"chatgpt-xingyu","user:"+userId,h.origin+"/mcp",scopes,Math.floor(Date.now()/1000)+3600).run();
  return token;
}
async function makeSpace(h,workspaceId,owner,name,parentId=null) {
  const res=await call(h,"/api/workspaces/"+workspaceId+"/spaces",{
    method:"POST",cookie:owner.cookie,body:{name,parent_id:parentId},
  });
  assert.equal(res.status,201,JSON.stringify(res.data));
  return res.data.space;
}
async function makePost(h,workspaceId,owner,title,spaceId){
  const result=await call(h,"/api/workspaces/"+workspaceId+"/posts",{
    method:"POST",cookie:owner.cookie,body:{title,space:String(spaceId),content_markdown:"# Private internal research"},
  });
  assert.equal(result.status,201,JSON.stringify(result.data));
  return result.data.post;
}
test("team grants inherit live workspace roles and revoke web/MCP access immediately",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"team-owner");
    const bob=await makeActiveUser(h,"team-bob");
    const stranger=await makeActiveUser(h,"team-stranger");
    const a=await org(h,owner);
    const b=await org(h,stranger,"另一个团队组织");
    await join(h,a,bob,owner);
    const alpha=await team(h,a,owner,"研发团队");
    const outsiderTeam=await team(h,b,stranger,"无关团队");
    const w=await workspace(h,a,owner);
    const root=(await call(h,"/api/workspaces/"+w.id+"/spaces?parent_id=null",{cookie:owner.cookie})).data.spaces[0];
    const secret=await makePost(h,w.id,owner,"不应默认对整个组织公开",root.id);

    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts",{cookie:bob.cookie})).status,404,
      "joining an organization must never implicitly grant workspace access");
    const deniedGrant=await call(h,"/api/organizations/"+a.id+"/workspaces/"+w.id+"/grants",{
      method:"POST",cookie:owner.cookie,body:{teamId:outsiderTeam.id,role:"viewer"},
    });
    assert.equal(deniedGrant.status,404,"cannot grant cross-organization team");
    await assert.rejects(h.db.prepare(
      "INSERT INTO workspace_team_grants(organization_id,workspace_id,team_id,role) VALUES(?,?,?,'viewer')",
    ).bind(a.id,w.id,outsiderTeam.id).run(),"DB rejects cross-tenant grant even with forged IDs");
    const personalAttempt=await call(h,"/api/workspaces/"+owner.workspaceId+"/spaces/"+root.id+"/access",{
      method:"PUT",cookie:owner.cookie,body:{restricted:true},
    });
    assert.equal(personalAttempt.status,404,"no organizational ACL can be placed on a personal workspace");

    await addTeamMember(h,a,alpha.id,owner,bob);
    await grant(h,a,w.id,alpha.id,owner,"viewer");
    const wsList=await call(h,"/api/workspaces",{cookie:bob.cookie});
    assert.ok(wsList.data.workspaces.some(x=>x.id===w.id&&x.role==="viewer"));
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+secret.publicId,{cookie:bob.cookie})).status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts",{
      method:"POST",cookie:bob.cookie,body:{title:"Viewer write forbidden"},
    })).status,403);
    const token=await mcpToken(h,bob.id);
    const canRead=await callMcpTool(h,{name:"get_post",token,
      arguments:{workspace_id:w.id,identifier:secret.publicId,view:"content"}});
    assert.equal(canRead.isError,undefined);
    assert.equal((await callMcpTool(h,{name:"create_draft",token,
      arguments:{workspace_id:w.id,title:"Viewer cannot MCP write"}})).isError,true);

    await grant(h,a,w.id,alpha.id,owner,"editor");
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts",{
      method:"POST",cookie:bob.cookie,body:{title:"Editor can now write"},
    })).status,201);
    assert.equal((await callMcpTool(h,{name:"create_draft",token,
      arguments:{workspace_id:w.id,title:"Editor MCP write enabled"}})).isError,undefined);

    const revoke=await call(h,"/api/organizations/"+a.id+"/workspaces/"+w.id+"/grants/"+alpha.id,{
      method:"DELETE",cookie:owner.cookie,
    });
    assert.equal(revoke.status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+secret.publicId,{cookie:bob.cookie})).status,404);
    assert.equal((await callMcpTool(h,{name:"get_post",token,
      arguments:{workspace_id:w.id,identifier:secret.publicId,view:"content"}})).isError,true);
    assert.equal((await call(h,"/api/workspaces",{cookie:bob.cookie})).data.workspaces
      .some(x=>x.id===w.id),false);

    await grant(h,a,w.id,alpha.id,owner,"editor");
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts",{cookie:bob.cookie})).status,200);
    const remove=await call(h,"/api/organizations/"+a.id+"/teams/"+alpha.id+"/members",{
      method:"DELETE",cookie:owner.cookie,body:{userId:bob.id},
    });
    assert.equal(remove.status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts",{cookie:bob.cookie})).status,404);
    await assert.rejects(h.db.prepare(
      "INSERT INTO team_memberships(organization_id,team_id,user_id) VALUES(?,?,?)",
    ).bind(a.id,alpha.id,stranger.id).run(),"non-organization user cannot join a team even by direct SQL");
    assert.equal((await call(h,"/api/workspaces/"+owner.workspaceId+"/posts",{cookie:stranger.cookie})).status,404);
    assert.equal((await call(h,"/api/workspaces/"+owner.workspaceId+"/posts",{cookie:bob.cookie})).status,404);
  }finally{await closeTestHarness(h);}
});

test("restricted ancestor ACL filters search, posts, attachments and MCP while preserving writer limits",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"acl-owner");
    const bob=await makeActiveUser(h,"acl-bob");
    const carol=await makeActiveUser(h,"acl-carol");
    const stranger=await makeActiveUser(h,"acl-stranger");
    const o=await org(h,owner,"授权控制组织");
    await join(h,o,bob,owner);await join(h,o,carol,owner);
    const a=await team(h,o,owner,"项目组A"),b=await team(h,o,owner,"项目组B");
    await addTeamMember(h,o,a.id,owner,bob);
    await addTeamMember(h,o,b.id,owner,carol);
    const w=await workspace(h,o,owner);
    await grant(h,o,w.id,a.id,owner,"editor");
    await grant(h,o,w.id,b.id,owner,"editor");
    const root=(await call(h,"/api/workspaces/"+w.id+"/spaces?parent_id=null",{cookie:owner.cookie})).data.spaces[0];
    const secret=await makeSpace(h,w.id,owner,"财务机密",root.id);
    const deep=await makeSpace(h,w.id,owner,"年度预算",secret.id);
    const publicPost=await makePost(h,w.id,owner,"共同研发笔记",root.id);
    const privatePost=await makePost(h,w.id,owner,"预算保密信息",deep.id);
    const path="/api/workspaces/"+w.id+"/spaces/"+secret.id+"/access";
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+privatePost.publicId,{cookie:carol.cookie})).status,200);
    const restrict=await call(h,path,{method:"PUT",cookie:owner.cookie,body:{restricted:true}});
    assert.equal(restrict.status,200,JSON.stringify(restrict.data));
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+privatePost.publicId,{cookie:bob.cookie})).status,404);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+privatePost.publicId,{cookie:carol.cookie})).status,404);
    const listing=await call(h,"/api/workspaces/"+w.id+"/posts",{cookie:bob.cookie});
    assert.equal(listing.status,200);
    assert.ok(listing.data.posts.some(p=>p.publicId===publicPost.publicId));
    assert.equal(listing.data.posts.some(p=>p.publicId===privatePost.publicId),false,"hidden posts never appear in directory");
    const search=await call(h,"/api/workspaces/"+w.id+"/posts?query=%E9%A2%84%E7%AE%97",{cookie:carol.cookie});
    assert.equal(search.data.posts.length,0,"secret posts never leak via search results");
    const spaces=await call(h,"/api/workspaces/"+w.id+"/spaces?parent_id=all",{cookie:bob.cookie});
    assert.equal(spaces.data.spaces.some(s=>s.id===secret.id||s.id===deep.id),false);

    assert.equal((await call(h,path+"/grants",{method:"POST",cookie:owner.cookie,
      body:{principalType:"team",principalId:a.id,role:"viewer"}})).status,201);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+privatePost.publicId,{cookie:bob.cookie})).status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+privatePost.publicId,{cookie:carol.cookie})).status,404);
    const restrictedWrite=await call(h,"/api/workspaces/"+w.id+"/posts",{
      method:"POST",cookie:bob.cookie,body:{title:"Viewer ACL cannot write",space:String(deep.id)},
    });
    assert.equal(restrictedWrite.status,403,"ACL viewer cap must block team editor write");
    const bobToken=await mcpToken(h,bob.id),carolToken=await mcpToken(h,carol.id);
    assert.equal((await callMcpTool(h,{name:"get_post",token:bobToken,
      arguments:{workspace_id:w.id,identifier:privatePost.publicId,view:"content"}})).isError,undefined);
    assert.equal((await callMcpTool(h,{name:"get_post",token:carolToken,
      arguments:{workspace_id:w.id,identifier:privatePost.publicId,view:"content"}})).isError,true);

    // Only approved viewers can download attachments associated with restricted posts.
    const uploaded=await callMcpTool(h,{name:"upload_attachment",token:await mcpToken(h,owner.id),
      arguments:{workspace_id:w.id,filename:"budget.txt",content_type:"text/plain",
        content_base64:Buffer.from("CONFIDENTIAL BUDGET").toString("base64"),
        post_identifier:privatePost.publicId}});
    assert.equal(uploaded.isError,undefined,JSON.stringify(uploaded.structuredContent));
    const attId=uploaded.structuredContent.attachment.public_id;
    const ownerAttachment=await call(h,"/api/workspaces/"+w.id+"/attachments/"+attId,{cookie:owner.cookie});
    assert.equal(ownerAttachment.status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/attachments/"+attId,{cookie:bob.cookie})).status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/attachments/"+attId,{cookie:carol.cookie})).status,404);
    assert.equal((await callMcpTool(h,{name:"download_attachment",token:carolToken,
      arguments:{workspace_id:w.id,public_id:attId}})).isError,true);

    const rootAcl="/api/workspaces/"+w.id+"/spaces/"+root.id+"/access";
    assert.equal((await call(h,rootAcl,{method:"PUT",cookie:owner.cookie,body:{restricted:true}})).status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+privatePost.publicId,{cookie:bob.cookie})).status,404,
      "grant at child never bypasses restricted ancestor");
    assert.equal((await call(h,rootAcl+"/grants",{method:"POST",cookie:owner.cookie,
      body:{principalType:"team",principalId:a.id,role:"viewer"}})).status,201);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+privatePost.publicId,{cookie:bob.cookie})).status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts",{
      method:"POST",cookie:bob.cookie,body:{title:"Parent Viewer prevents editing",space:String(deep.id)},
    })).status,403);
    assert.equal((await call(h,rootAcl+"/grants",{method:"POST",cookie:owner.cookie,
      body:{principalType:"team",principalId:a.id,role:"editor"}})).status,201);
    assert.equal((await call(h,path+"/grants",{method:"POST",cookie:owner.cookie,
      body:{principalType:"team",principalId:a.id,role:"editor"}})).status,201);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts",{
      method:"POST",cookie:bob.cookie,body:{title:"Team editor with permitted ancestors",space:String(deep.id)},
    })).status,201);

    assert.equal((await call(h,rootAcl+"/grants",{method:"POST",cookie:owner.cookie,
      body:{principalType:"user",principalId:stranger.id,role:"editor"}})).status,403,
      "outsiders cannot be assigned ACL even by direct principal ID");
    await assert.rejects(h.db.prepare(
      "INSERT INTO space_principal_grants(workspace_id,space_id,principal_type,principal_id,role) "+
      "VALUES(?,?,'user',?,'viewer')",
    ).bind(w.id,root.id,stranger.id).run(),"D1 must enforce ACL principal organization membership");

    assert.equal((await call(h,path,{method:"PUT",cookie:owner.cookie,body:{restricted:false}})).status,200);
    assert.equal((await call(h,rootAcl,{method:"PUT",cookie:owner.cookie,body:{restricted:false}})).status,200);
    assert.equal((await call(h,"/api/workspaces/"+w.id+"/posts/"+privatePost.publicId,{cookie:carol.cookie})).status,200);
  }finally{await closeTestHarness(h);}
});

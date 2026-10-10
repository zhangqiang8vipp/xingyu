import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomBytes} from "node:crypto";
import {closeTestHarness,openTestHarness,jsonRequest,callMcpTool} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

const hash=text=>createHash("sha256").update(text).digest("hex");
async function response(h,path,options){
  const res=await jsonRequest(h,path,options);
  return {status:res.status,data:await res.json().catch(()=>({}))};
}
async function inviteToken(h,workspaceId,email,inviterId,role="viewer"){
  const token=randomBytes(32).toString("base64url");
  const now=Math.floor(Date.now()/1000);
  const row=await h.db.prepare("INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,?,?,?,?) RETURNING id")
    .bind(workspaceId,email,role,hash(token),inviterId,now+3600).first();
  assert.ok(row?.id);
  return {token,id:row.id};
}
async function oauthToken(h,userId,scopes="xingyu.read xingyu.draft xingyu.publish offline_access"){
  const token="xy_at_"+randomBytes(32).toString("base64url");
  await h.db.prepare("INSERT INTO oauth_access_tokens(token_hash,client_id,subject,resource,scope,expires_at) VALUES(?,?,?,?,?,?)")
    .bind(hash(token),"chatgpt-xingyu","user:"+userId,h.origin+"/mcp",scopes,Math.floor(Date.now()/1000)+3600).run();
  return token;
}
test("shared workspaces invite by verified email and enforce live website/MCP RBAC",async()=>{
  const h=await openTestHarness();
  try{
    const alice=await makeActiveUser(h,"share-owner");
    const bob=await makeActiveUser(h,"share-bob");
    const charlie=await makeActiveUser(h,"share-stranger");
    const created=await response(h,"/api/workspaces",{method:"POST",cookie:alice.cookie,body:{name:"Cross-user research team"}});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const w=created.data.workspace;
    assert.equal(w.kind,"shared");assert.equal(w.role,"owner");
    assert.notEqual(w.id,alice.workspaceId);
    assert.ok((await h.db.prepare("SELECT 1 FROM spaces WHERE workspace_id=? AND parent_id IS NULL").bind(w.id).first()));
    assert.ok((await h.db.prepare("SELECT 1 FROM categories WHERE workspace_id=?").bind(w.id).first()));

    const personalInvite=await response(h,"/api/workspaces/"+alice.workspaceId+"/invitations",{
      method:"POST",cookie:alice.cookie,body:{email:bob.email,role:"viewer"},
    });
    assert.equal(personalInvite.status,403,"personal workspaces are not shareable");
    await assert.rejects(h.db.prepare(
      "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,?,'viewer','active')",
    ).bind(alice.workspaceId,bob.id).run(),"DB trigger must independently protect private workspaces");
    await assert.rejects(h.db.prepare(
      "DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?",
    ).bind(w.id,alice.id).run(),"DB trigger must prevent deleting an owner");

    const stranger=await response(h,"/api/workspaces/"+w.id+"/members",{cookie:bob.cookie});
    assert.equal(stranger.status,404);
    const mailOff=await response(h,"/api/workspaces/"+w.id+"/invitations",{
      method:"POST",cookie:alice.cookie,body:{email:bob.email,role:"viewer"},
    });
    assert.equal(mailOff.status,503,"mail sender missing must fail closed");
    const pendingBefore=await h.db.prepare("SELECT COUNT(*) AS count FROM workspace_invitations").first();
    assert.equal(pendingBefore.count,0,"do not create unsendable invitations");

    const invited=await inviteToken(h,w.id,bob.email,alice.id);
    const mismatched=await response(h,"/api/invitations",{method:"POST",cookie:charlie.cookie,body:{token:invited.token}});
    assert.equal(mismatched.status,404,"only the invited verified-email identity can join");
    const preview=await response(h,"/api/invitations?token="+invited.token,{cookie:bob.cookie});
    assert.equal(preview.status,200);
    assert.equal(preview.data.invitation.workspaceId,w.id);
    assert.equal(preview.data.invitation.role,"viewer");
    const accepted=await response(h,"/api/invitations",{method:"POST",cookie:bob.cookie,body:{token:invited.token}});
    assert.equal(accepted.status,200,JSON.stringify(accepted.data));
    assert.equal(accepted.data.workspace.workspaceId,w.id);
    const replay=await response(h,"/api/invitations",{method:"POST",cookie:bob.cookie,body:{token:invited.token}});
    assert.notEqual(replay.status,200,"accepted invitations are one-use");
    const bobWs=await response(h,"/api/workspaces",{cookie:bob.cookie});
    assert.ok(bobWs.data.workspaces.some(x=>x.id===w.id&&x.role==="viewer"));

    const draft=await response(h,"/api/workspaces/"+w.id+"/posts",{
      method:"POST",cookie:alice.cookie,body:{title:"Shared private notes",content_markdown:"# Internal, not public"},
    });
    assert.equal(draft.status,201,JSON.stringify(draft.data));
    const post=draft.data.post;
    assert.equal(post.workspaceId,w.id);
    assert.ok(post.spaceId,"shared notes must never use public root");
    const visible=await response(h,"/api/workspaces/"+w.id+"/posts/"+post.publicId,{cookie:bob.cookie});
    assert.equal(visible.status,200);
    const readonly=await response(h,"/api/workspaces/"+w.id+"/posts",{
      method:"POST",cookie:bob.cookie,body:{title:"Viewer write prohibited"},
    });
    assert.equal(readonly.status,403);
    const bobOAuth=await oauthToken(h,bob.id);
    const toolRead=await callMcpTool(h,{name:"get_post",token:bobOAuth,
      arguments:{workspace_id:w.id,identifier:post.publicId,view:"content"}});
    assert.equal(toolRead.isError,undefined,JSON.stringify(toolRead.structuredContent));
    assert.match(toolRead.structuredContent.post.content_markdown,/Internal, not public/);
    const toolWrite=await callMcpTool(h,{name:"create_draft",token:bobOAuth,
      arguments:{workspace_id:w.id,title:"Viewer MCP write prohibited"}});
    assert.equal(toolWrite.isError,true);
    const publicLink=await h.dispatch("/posts/"+post.publicId+"/"+post.slug);
    assert.equal(publicLink.status,404,"shared published articles must remain private");

    const promoted=await response(h,"/api/workspaces/"+w.id+"/members/"+bob.id,{
      method:"PATCH",cookie:alice.cookie,body:{role:"editor"},
    });
    assert.equal(promoted.status,200,JSON.stringify(promoted.data));
    const edit=await response(h,"/api/workspaces/"+w.id+"/posts",{
      method:"POST",cookie:bob.cookie,body:{title:"Member edit enabled"},
    });
    assert.equal(edit.status,201,JSON.stringify(edit.data));
    const demoted=await response(h,"/api/workspaces/"+w.id+"/members/"+bob.id,{
      method:"PATCH",cookie:alice.cookie,body:{role:"viewer"},
    });
    assert.equal(demoted.status,200);
    const deniedAgain=await callMcpTool(h,{name:"create_draft",token:bobOAuth,
      arguments:{workspace_id:w.id,title:"Role change must take effect immediately"}});
    assert.equal(deniedAgain.isError,true);

    const illegalOwner=await response(h,"/api/workspaces/"+w.id+"/members/"+alice.id,{
      method:"DELETE",cookie:alice.cookie,
    });
    assert.equal(illegalOwner.status,403);
    const revoked=await response(h,"/api/workspaces/"+w.id+"/members/"+bob.id,{
      method:"DELETE",cookie:alice.cookie,
    });
    assert.equal(revoked.status,200);
    assert.equal((await response(h,"/api/workspaces/"+w.id+"/posts/"+post.publicId,{cookie:bob.cookie})).status,404);
    const removedMcp=await callMcpTool(h,{name:"get_post",token:bobOAuth,
      arguments:{workspace_id:w.id,identifier:post.publicId,view:"content"}});
    assert.equal(removedMcp.isError,true);
    const remaining=await response(h,"/api/workspaces",{cookie:bob.cookie});
    assert.equal(remaining.data.workspaces.some(x=>x.id===w.id),false);
  }finally{await closeTestHarness(h);}
});
test("invitation revocation and manager roles cannot escalate to owner",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"collab-manager");
    const manager=await makeActiveUser(h,"collab-admin");
    const guest=await makeActiveUser(h,"collab-guest");
    const create=await response(h,"/api/workspaces",{method:"POST",cookie:owner.cookie,body:{name:"Project sharing"}});
    const w=create.data.workspace;
    assert.equal(create.status,201,JSON.stringify(create.data));
    const adminToken=await inviteToken(h,w.id,manager.email,owner.id,"admin");
    assert.equal((await response(h,"/api/invitations",{method:"POST",cookie:manager.cookie,body:{token:adminToken.token}})).status,200);
    const ownerChange=await response(h,"/api/workspaces/"+w.id+"/members/"+owner.id,{
      method:"PATCH",cookie:manager.cookie,body:{role:"viewer"},
    });
    assert.equal(ownerChange.status,403);
    const ownerDelete=await response(h,"/api/workspaces/"+w.id+"/members/"+owner.id,{
      method:"DELETE",cookie:manager.cookie,
    });
    assert.equal(ownerDelete.status,403);
    const guestInvite=await inviteToken(h,w.id,guest.email,manager.id,"viewer");
    const list=await response(h,"/api/workspaces/"+w.id+"/invitations",{cookie:manager.cookie});
    assert.equal(list.status,200);assert.equal(list.data.invitations.length,1);
    assert.equal(list.data.invitations[0].token,undefined,"raw tokens must never appear in listing");
    const revoked=await response(h,"/api/workspaces/"+w.id+"/invitations/"+guestInvite.id,{
      method:"DELETE",cookie:manager.cookie,
    });
    assert.equal(revoked.status,200);
    const unusable=await response(h,"/api/invitations",{method:"POST",cookie:guest.cookie,body:{token:guestInvite.token}});
    assert.notEqual(unusable.status,200);
    const managerCannotPromote=await response(h,"/api/workspaces/"+w.id+"/members/"+manager.id,{
      method:"PATCH",cookie:manager.cookie,body:{role:"owner"},
    });
    assert.ok([400,403].includes(managerCannotPromote.status));
    assert.equal((await response(h,"/api/workspaces/"+w.id+"/members/leave",{method:"POST",cookie:owner.cookie})).status,403);
    assert.equal((await response(h,"/api/workspaces/"+w.id+"/members/leave",{method:"POST",cookie:manager.cookie})).status,200);
    assert.equal((await response(h,"/api/workspaces/"+w.id+"/members",{cookie:manager.cookie})).status,404);
  }finally{await closeTestHarness(h);}
});

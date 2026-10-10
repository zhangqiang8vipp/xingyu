import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomBytes} from "node:crypto";
import {openTestHarness,closeTestHarness,jsonRequest} from "./harness.mjs";
import {makeActiveUser} from "./identity-fixtures.mjs";

const hash=text=>createHash("sha256").update(text).digest("hex");
async function api(h,path,opts){
  const response=await jsonRequest(h,path,opts);
  return {status:response.status,data:await response.json().catch(()=>({}))};
}
async function createOrg(h,owner,name){
  const res=await api(h,"/api/organizations",{method:"POST",cookie:owner.cookie,body:{name}});
  assert.equal(res.status,201,JSON.stringify(res.data));
  assert.equal(res.data.organization.role,"owner");
  return res.data.organization;
}
async function seedInvite(h,org,email,actor,role="member",expiry=3600){
  const raw=randomBytes(32).toString("base64url"),now=Math.floor(Date.now()/1000);
  const invite=await h.db.prepare(
    "INSERT INTO organization_invitations(organization_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,?,?,?,?) RETURNING id",
  ).bind(org.id,email,role,hash(raw),actor.id,now+expiry).first();
  assert.ok(invite?.id);
  return {id:invite.id,token:raw};
}
async function join(h,person,inv){
  return api(h,"/api/organization-invitations",{method:"POST",cookie:person.cookie,body:{token:inv.token}});
}

test("users join multiple organizations through verified-email single-use invitations, without workspace escalation",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"org-owner");
    const bob=await makeActiveUser(h,"org-joiner");
    const stranger=await makeActiveUser(h,"org-outsider");
    const first=await createOrg(h,owner,"星屿科技");
    const second=await createOrg(h,stranger,"开放文档协会");
    assert.notEqual(first.id,second.id);
    assert.equal((await api(h,"/api/organizations/"+first.id+"/members",{cookie:bob.cookie})).status,404);
    assert.equal((await api(h,"/api/organizations/"+first.id+"/units",{cookie:bob.cookie})).status,404);
    assert.equal((await api(h,"/api/organizations/"+first.id+"/members")).status,401);

    const mailOff=await api(h,"/api/organizations/"+first.id+"/invitations",{
      method:"POST",cookie:owner.cookie,body:{email:bob.email,role:"member"},
    });
    assert.equal(mailOff.status,503,"missing email delivery config must fail closed");
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM organization_invitations").first()).n,0);

    const invitation=await seedInvite(h,first,bob.email,owner);
    const wrong=await join(h,stranger,invitation);
    assert.equal(wrong.status,404,"another identity cannot claim an invite");
    const preview=await api(h,"/api/organization-invitations?token="+invitation.token,{cookie:bob.cookie});
    assert.equal(preview.status,200,JSON.stringify(preview.data));
    assert.equal(preview.data.invitation.organizationId,first.id);
    assert.equal((await join(h,bob,invitation)).status,200);
    assert.notEqual((await join(h,bob,invitation)).status,200,"one-time tokens cannot be replayed");
    const another=await seedInvite(h,second,bob.email,stranger);
    assert.equal((await join(h,bob,another)).status,200);

    const bobOrgs=await api(h,"/api/organizations",{cookie:bob.cookie});
    assert.equal(bobOrgs.status,200);
    assert.deepEqual(bobOrgs.data.organizations.map(x=>x.id).sort((a,b)=>a-b),
      [first.id,second.id].sort((a,b)=>a-b));
    const originalPersonal=await api(h,"/api/workspaces/"+owner.workspaceId+"/posts",{cookie:bob.cookie});
    assert.equal(originalPersonal.status,404,"org membership never grants private workspace access");
    const listWorkspaces=await api(h,"/api/workspaces",{cookie:bob.cookie});
    assert.equal(listWorkspaces.data.workspaces.some(x=>x.id===owner.workspaceId),false);
    const noOrgWorkspace=await h.db.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE kind='organization'").first();
    assert.equal(noOrgWorkspace.n,0,"organization creation must not implicitly create a content workspace");

    const unlisted=await api(h,"/api/organizations/"+first.id+"/invitations",{cookie:owner.cookie});
    assert.equal(unlisted.status,200);
    assert.equal(unlisted.data.invitations.length,0,"accepted token disappears from pending list");
    const exit=await api(h,"/api/organizations/"+first.id+"/members/leave",{method:"POST",cookie:bob.cookie});
    assert.equal(exit.status,200);
    assert.equal((await api(h,"/api/organizations/"+first.id+"/members",{cookie:bob.cookie})).status,404);
    assert.equal((await api(h,"/api/organizations/"+second.id+"/members",{cookie:bob.cookie})).status,200,
      "leaving one organization must not change memberships in another");
    assert.equal((await api(h,"/api/organizations/"+first.id+"/members/leave",{method:"POST",cookie:owner.cookie})).status,403);
    await assert.rejects(h.db.prepare(
      "DELETE FROM organization_memberships WHERE organization_id=? AND user_id=?",
    ).bind(first.id,owner.id).run(),"database must independently prevent owner removal");
  }finally{await closeTestHarness(h);}
});

test("department tree rejects cycles/cross-tenant references and keeps assignments within organization",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"org-dept-owner");
    const bob=await makeActiveUser(h,"org-dept-member");
    const stranger=await makeActiveUser(h,"org-dept-other");
    const a=await createOrg(h,owner,"研发组织");
    const b=await createOrg(h,stranger,"另一个组织");
    const baseA="/api/organizations/"+a.id;
    const baseB="/api/organizations/"+b.id;
    const root=await api(h,baseA+"/units",{
      method:"POST",cookie:owner.cookie,body:{name:"技术中心",parentId:null},
    });
    assert.equal(root.status,201,JSON.stringify(root.data));
    const rootId=root.data.unit.id;
    const child=await api(h,baseA+"/units",{
      method:"POST",cookie:owner.cookie,body:{name:"研发部",parentId:rootId},
    });
    assert.equal(child.status,201,JSON.stringify(child.data));
    const childId=child.data.unit.id;
    const remote=await api(h,baseB+"/units",{
      method:"POST",cookie:stranger.cookie,body:{name:"人事部",parentId:null},
    });
    assert.equal(remote.status,201);
    const otherId=remote.data.unit.id;
    assert.equal((await api(h,baseA+"/units",{
      method:"POST",cookie:owner.cookie,body:{name:"外部子部门",parentId:otherId},
    })).status,409);
    assert.equal((await api(h,baseA+"/units/"+rootId,{
      method:"PATCH",cookie:owner.cookie,body:{parentId:childId},
    })).status,409,"cannot make a department a child of its own descendant");
    assert.equal((await api(h,baseA+"/units/"+childId,{
      method:"PATCH",cookie:owner.cookie,body:{parentId:otherId},
    })).status,409,"cross-org reparenting is forbidden");
    await assert.rejects(h.db.prepare("UPDATE organization_units SET parent_id=? WHERE id=?")
      .bind(childId,rootId).run(),"DB trigger prevents a cycle even without HTTP");
    await assert.rejects(h.db.prepare("INSERT INTO organization_units(organization_id,parent_id,name) VALUES(?,?,?)")
      .bind(a.id,otherId,"DB foreign parent").run(),"DB trigger prevents cross-organization nesting");

    const invited=await seedInvite(h,a,bob.email,owner);
    assert.equal((await join(h,bob,invited)).status,200);
    const publicTree=await api(h,baseA+"/units",{cookie:bob.cookie});
    assert.equal(publicTree.status,200);
    assert.equal(publicTree.data.units.length,2);
    assert.equal((await api(h,baseA+"/units",{
      method:"POST",cookie:bob.cookie,body:{name:"Unauthorized",parentId:null},
    })).status,403,"ordinary members cannot change department tree");
    assert.equal((await api(h,baseB+"/units",{cookie:bob.cookie})).status,404);
    const assign=await api(h,baseA+"/units/"+childId+"/members",{
      method:"POST",cookie:owner.cookie,body:{userId:bob.id},
    });
    assert.equal(assign.status,200,JSON.stringify(assign.data));
    const tree=await api(h,baseA+"/units",{cookie:owner.cookie});
    assert.deepEqual(tree.data.assignments.map(x=>x.userId),[bob.id]);
    assert.equal((await api(h,baseA+"/units/"+childId+"/members",{
      method:"POST",cookie:owner.cookie,body:{userId:stranger.id},
    })).status,403,"non-org members cannot be assigned to departments");
    await assert.rejects(h.db.prepare(
      "INSERT INTO organization_unit_memberships(organization_id,unit_id,user_id) VALUES(?,?,?)",
    ).bind(a.id,childId,stranger.id).run(),"direct DB calls must reject cross-org assignments");
    await assert.rejects(h.db.prepare(
      "INSERT INTO organization_unit_memberships(organization_id,unit_id,user_id) VALUES(?,?,?)",
    ).bind(b.id,childId,stranger.id).run(),"department and organization IDs must match");
    assert.equal((await api(h,baseA+"/units/"+rootId,{method:"DELETE",cookie:owner.cookie})).status,409);
    assert.equal((await api(h,baseA+"/units/"+childId,{method:"DELETE",cookie:owner.cookie})).status,409);

    const removed=await api(h,baseA+"/members/"+bob.id,{method:"DELETE",cookie:owner.cookie});
    assert.equal(removed.status,200);
    const after=await h.db.prepare(
      "SELECT COUNT(*) AS n FROM organization_unit_memberships WHERE organization_id=? AND user_id=?",
    ).bind(a.id,bob.id).first();
    assert.equal(after.n,0,"organization member removal automatically clears department assignments");
    assert.equal((await api(h,baseA+"/units/"+childId,{method:"DELETE",cookie:owner.cookie})).status,200);
    assert.equal((await api(h,baseA+"/units/"+rootId,{method:"DELETE",cookie:owner.cookie})).status,200);
  }finally{await closeTestHarness(h);}
});

test("organization Owner/Admin/Member privileges and revoked/expired invitations remain isolated",async()=>{
  const h=await openTestHarness();
  try{
    const owner=await makeActiveUser(h,"org-rbac-owner");
    const admin=await makeActiveUser(h,"org-rbac-admin");
    const bob=await makeActiveUser(h,"org-rbac-bob");
    const guest=await makeActiveUser(h,"org-rbac-guest");
    const org=await createOrg(h,owner,"RBAC 组织");
    const root="/api/organizations/"+org.id;
    const grant=await seedInvite(h,org,admin.email,owner,"admin");
    assert.equal((await join(h,admin,grant)).status,200);
    const memberGrant=await seedInvite(h,org,bob.email,owner,"member");
    assert.equal((await join(h,bob,memberGrant)).status,200);
    assert.equal((await api(h,root+"/members/"+admin.id,{
      method:"PATCH",cookie:admin.cookie,body:{role:"member"},
    })).status,403);
    assert.equal((await api(h,root+"/members/"+owner.id,{
      method:"DELETE",cookie:admin.cookie,
    })).status,403);
    assert.equal((await api(h,root+"/members/"+bob.id,{
      method:"PATCH",cookie:bob.cookie,body:{role:"admin"},
    })).status,403);
    assert.equal((await api(h,root+"/invitations",{
      method:"POST",cookie:admin.cookie,body:{email:guest.email,role:"admin"},
    })).status,403,"an admin cannot grant another admin role");
    const pending=await seedInvite(h,org,guest.email,admin);
    const list=await api(h,root+"/invitations",{cookie:admin.cookie});
    assert.equal(list.status,200);
    assert.equal(list.data.invitations.length,1);
    assert.equal(list.data.invitations[0].token,undefined);
    assert.equal((await api(h,root+"/invitations/"+pending.id,{
      method:"DELETE",cookie:admin.cookie,
    })).status,200);
    assert.notEqual((await join(h,guest,pending)).status,200,"revoked token unusable");
    const expired=await seedInvite(h,org,guest.email,owner,"member",-60);
    assert.equal((await api(h,"/api/organization-invitations?token="+expired.token,{cookie:guest.cookie})).status,404);
    assert.equal((await api(h,root+"/members/"+admin.id,{
      method:"PATCH",cookie:owner.cookie,body:{role:"member"},
    })).status,200);
    assert.equal((await api(h,root+"/units",{
      method:"POST",cookie:admin.cookie,body:{name:"Forbidden",parentId:null},
    })).status,403,"demotion takes effect immediately");
    const renamed=await api(h,root,{method:"PATCH",cookie:owner.cookie,body:{name:"RBAC 组织 2026"}});
    assert.equal(renamed.status,200,JSON.stringify(renamed.data));
  }finally{await closeTestHarness(h);}
});

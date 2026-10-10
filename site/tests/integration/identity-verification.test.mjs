import assert from "node:assert/strict";
import test from "node:test";
import { createHash,randomBytes } from "node:crypto";
import { closeTestHarness,jsonRequest,openTestHarness } from "./harness.mjs";

test("email verification tokens are single-use and activate only their own account",async()=>{
  const harness=await openTestHarness();
  try{
    const signup=await jsonRequest(harness,"/api/identity/register",{
      method:"POST",body:{email:"should-not-register@example.test",name:"Denied",password:"strong-test-password-2026"},
    });
    assert.equal(signup.status,503,"missing Resend configuration must fail closed");
    const noAccount=await harness.db.prepare("SELECT id FROM users WHERE display_name='Denied'").first();
    assert.equal(noAccount,null);

    const pending=await harness.db.prepare("INSERT INTO users(display_name,status) VALUES('Pending customer','pending') RETURNING id").first();
    assert.ok(pending?.id);
    await harness.db.prepare("INSERT INTO user_identities(user_id,provider,subject,email,name) VALUES(?,'email','verified@example.test','verified@example.test','Pending customer')")
      .bind(pending.id).run();
    const token=randomBytes(32).toString("base64url");
    const hash=createHash("sha256").update(token).digest("hex");
    await harness.db.prepare("INSERT INTO email_verifications(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .bind(hash,pending.id,Math.floor(Date.now()/1000)+1800).run();
    const bad=await jsonRequest(harness,"/api/identity/verify",{method:"POST",body:{token:"invalid"}});
    assert.equal(bad.status,400);
    const before=await harness.db.prepare("SELECT status FROM users WHERE id=?").bind(pending.id).first();
    assert.equal(before?.status,"pending");

    const confirmed=await jsonRequest(harness,"/api/identity/verify",{method:"POST",body:{token}});
    assert.equal(confirmed.status,200,await confirmed.text());
    const row=await harness.db.prepare("SELECT status FROM users WHERE id=?").bind(pending.id).first();
    assert.equal(row?.status,"active");
    const own=await harness.db.prepare(
      "SELECT w.id,w.kind,m.role FROM workspaces w JOIN workspace_memberships m ON m.workspace_id=w.id WHERE w.owner_user_id=? AND m.user_id=?",
    ).bind(pending.id,pending.id).first();
    assert.equal(own?.kind,"personal");
    assert.equal(own?.role,"owner");
    assert.notEqual(own?.id,1);
    const root=await harness.db.prepare("SELECT id FROM spaces WHERE workspace_id=? AND slug=?")
      .bind(own.id,"private-u"+pending.id).first();
    assert.ok(root,"personal workspace must contain a private root space");
    const role=await harness.db.prepare("SELECT role FROM site_memberships WHERE user_id=?").bind(pending.id).first();
    assert.equal(role,null,"registration must never grant site admin");

    const reused=await jsonRequest(harness,"/api/identity/verify",{method:"POST",body:{token}});
    assert.equal(reused.status,400,"a verification token cannot be replayed");
  }finally{await closeTestHarness(harness);}
});

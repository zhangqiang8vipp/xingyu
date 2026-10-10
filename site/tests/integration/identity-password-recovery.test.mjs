import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes,createHash} from "node:crypto";
import {closeTestHarness,jsonRequest,loginAdmin,openTestHarness,TEST_ADMIN_PASSWORD} from "./harness.mjs";
import {identityCookie,makeActiveUser,TEST_USER_PASSWORD} from "./identity-fixtures.mjs";

test("owner keeps the existing password; old admin password-only access retires after migration",async()=>{
  const h=await openTestHarness();
  try{
    const oldCookie=await loginAdmin(h);
    const signin=await jsonRequest(h,"/api/identity/login",{
      method:"POST",body:{email:"zhangqiang8vip@gmail.com",password:TEST_ADMIN_PASSWORD},
    });
    assert.equal(signin.status,200,await signin.clone().text());
    const ownerCookie=identityCookie(signin);
    const creds=await h.db.prepare("SELECT password_hash,legacy_admin FROM user_credentials WHERE user_id=1").first();
    assert.equal(creds.legacy_admin,0);
    assert.match(creds.password_hash,/^pbkdf2-sha256\$310000\$/);
    assert.equal((await jsonRequest(h,"/api/admin/diagnostics",{cookie:oldCookie})).status,401);
    assert.equal((await jsonRequest(h,"/api/admin/diagnostics",{cookie:ownerCookie})).status,200);
    assert.equal((await jsonRequest(h,"/api/admin/login",{method:"POST",body:{password:TEST_ADMIN_PASSWORD}})).status,403);
    const ws=await jsonRequest(h,"/api/workspaces",{cookie:ownerCookie});
    assert.equal((await ws.json()).workspaces[0].id,1);
  }finally{await closeTestHarness(h);}
});
test("reset token is purpose-bound and single-use; new password revokes old web/MCP sessions",async()=>{
  const h=await openTestHarness();
  try{
    const user=await makeActiveUser(h,"password-recovery");
    const now=Math.floor(Date.now()/1000);
    const access="xy_at_"+randomBytes(32).toString("base64url");
    const accessHash=createHash("sha256").update(access).digest("hex");
    await h.db.prepare("INSERT INTO oauth_access_tokens(token_hash,client_id,subject,resource,scope,expires_at) VALUES(?,?,?,?,?,?)")
      .bind(accessHash,"chatgpt-xingyu","user:"+user.id,h.origin+"/mcp","xingyu.read",now+3600).run();
    const token=randomBytes(32).toString("base64url");
    await h.db.prepare("INSERT INTO email_verifications(token_hash,purpose,user_id,expires_at) VALUES(?,'reset_password',?,?)")
      .bind(createHash("sha256").update(token).digest("hex"),user.id,now+1800).run();

    const verificationOnlyToken=randomBytes(32).toString("base64url");
    await h.db.prepare("INSERT INTO email_verifications(token_hash,purpose,user_id,expires_at) VALUES(?,'verify_email',?,?)")
      .bind(createHash("sha256").update(verificationOnlyToken).digest("hex"),user.id,now+1800).run();
    const wrongPurpose=await jsonRequest(h,"/api/identity/reset-password",{
      method:"POST",body:{token:verificationOnlyToken,password:"new-long-password-12345"},
    });
    assert.equal(wrongPurpose.status,400);
    const changed=await jsonRequest(h,"/api/identity/reset-password",{
      method:"POST",body:{token,password:"new-long-password-12345"},
    });
    assert.equal(changed.status,200,await changed.clone().text());
    assert.equal((await (await jsonRequest(h,"/api/identity/me",{cookie:user.cookie})).json()).user,null);
    const oldToken=await h.db.prepare("SELECT revoked_at FROM oauth_access_tokens WHERE token_hash=?").bind(accessHash).first();
    assert.ok(oldToken?.revoked_at);
    assert.equal((await jsonRequest(h,"/api/identity/login",{
      method:"POST",body:{email:user.email,password:TEST_USER_PASSWORD},
    })).status,401);
    assert.equal((await jsonRequest(h,"/api/identity/login",{
      method:"POST",body:{email:user.email,password:"new-long-password-12345"},
    })).status,200);
    assert.equal((await jsonRequest(h,"/api/identity/reset-password",{
      method:"POST",body:{token,password:"another-long-password-2026"},
    })).status,400);
  }finally{await closeTestHarness(h);}
});

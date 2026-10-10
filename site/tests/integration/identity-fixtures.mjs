import assert from "node:assert/strict";
import {pbkdf2Sync,randomBytes} from "node:crypto";
import {jsonRequest} from "./harness.mjs";

export const TEST_USER_PASSWORD="integration-test-strong-password-2026";
function credential(password=TEST_USER_PASSWORD){
  const salt=randomBytes(16);
  return ["pbkdf2-sha256","310000",salt.toString("base64url"),
    pbkdf2Sync(password,salt,310000,32,"sha256").toString("base64url")].join("$");
}
export function identityCookie(response){
  const entries=response.headers.getSetCookie?.()??[response.headers.get("set-cookie")??""];
  const cookie=entries.find(value=>value.startsWith("xingyu_identity_session="));
  assert.ok(cookie,"login response must contain identity session cookie");
  return cookie.split(";")[0];
}
export async function makeActiveUser(harness,label){
  const email=label+"@example.test";
  const row=await harness.db.prepare("INSERT INTO users(display_name,status) VALUES(?,'active') RETURNING id").bind(label).first();
  assert.ok(row?.id);
  await harness.db.prepare("INSERT INTO user_identities(user_id,provider,subject,email,name) VALUES(?,'email',?,?,?)").bind(row.id,email,email,label).run();
  await harness.db.prepare("INSERT INTO user_credentials(user_id,password_hash,legacy_admin) VALUES(?,?,0)").bind(row.id,credential()).run();
  const response=await jsonRequest(harness,"/api/identity/login",{
    method:"POST",body:{email,password:TEST_USER_PASSWORD},
  });
  const payload=await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));
  const cookie=identityCookie(response);
  const list=await jsonRequest(harness,"/api/workspaces",{cookie});
  const workspaces=await list.json();
  assert.equal(list.status,200,JSON.stringify(workspaces));
  assert.equal(workspaces.workspaces.length,1);
  const workspace=workspaces.workspaces[0];
  assert.equal(workspace.kind,"personal");
  assert.equal(workspace.role,"owner");
  assert.notEqual(workspace.id,1);
  return {id:row.id,email,cookie,workspaceId:workspace.id};
}

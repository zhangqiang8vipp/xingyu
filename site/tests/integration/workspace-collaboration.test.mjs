import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeTestHarness, openTestHarness, jsonRequest, callMcpTool } from "./harness.mjs";
import { makeActiveUser } from "./identity-fixtures.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
async function response(h, path, options) {
  const res = await jsonRequest(h, path, options);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function tokenFor(h, userId) {
  const token = "xy_at_" + randomBytes(32).toString("base64url");
  await h.db.prepare("INSERT INTO oauth_access_tokens(token_hash,client_id,subject,resource,scope,expires_at) VALUES(?,?,?,?,?,?)")
    .bind(hash(token), "chatgpt-xingyu", "user:" + userId, h.origin + "/mcp", "xingyu.read xingyu.draft xingyu.publish", Math.floor(Date.now() / 1000) + 3600).run();
  return token;
}

test("regular accounts use only personal workspaces; legacy shared workspace content stays inaccessible", async () => {
  const h = await openTestHarness();
  try {
    const alice = await makeActiveUser(h, "workspace-owner");
    const bob = await makeActiveUser(h, "workspace-bob");
    const createShared = await response(h, "/api/workspaces", { method: "POST", cookie: alice.cookie, body: { name: "Retired shared workspace" } });
    assert.equal(createShared.status, 403, "registered accounts cannot create shared workspaces");

    const aliceWorkspaces = await response(h, "/api/workspaces", { cookie: alice.cookie });
    const bobWorkspaces = await response(h, "/api/workspaces", { cookie: bob.cookie });
    assert.deepEqual(aliceWorkspaces.data.workspaces.map(w => w.id), [alice.workspaceId]);
    assert.deepEqual(bobWorkspaces.data.workspaces.map(w => w.id), [bob.workspaceId]);

    const personalInvite = await response(h, "/api/workspaces/" + alice.workspaceId + "/invitations", {
      method: "POST", cookie: alice.cookie, body: { email: bob.email, role: "viewer" },
    });
    assert.equal(personalInvite.status, 403, "personal workspaces are not shareable");
    await assert.rejects(h.db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,? ,'viewer','active')")
      .bind(alice.workspaceId, bob.id).run(), "DB trigger independently protects private workspaces");

    const suffix = randomUUID().replaceAll("-", "");
    const slug = "legacy-shared-" + suffix;
    const legacy = await h.db.prepare("INSERT INTO workspaces(kind,owner_user_id,slug,name,status) VALUES('shared',?,?,?,'active') RETURNING id")
      .bind(alice.id, slug, "Legacy shared workspace").first();
    await h.db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,? ,'owner','active')")
      .bind(legacy.id, alice.id).run();
    await h.db.prepare("INSERT INTO categories(workspace_id,name,slug,color) VALUES(?,?,?,'#123456')")
      .bind(legacy.id, "Legacy notes", slug + "-notes").run();
    const category = await h.db.prepare("SELECT id FROM categories WHERE workspace_id=? LIMIT 1").bind(legacy.id).first();
    const space = await h.db.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,NULL,?,?) RETURNING id")
      .bind(legacy.id, "Legacy private space", slug + "-root").first();
    const publicId = "LEGACY_SHARED_" + suffix;
    await h.db.prepare("INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,featured,author_id,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(legacy.id, publicId, "Legacy shared private post", slug, "private", "# legacy secret", category.id, space.id, "draft", 0, alice.id, alice.id, alice.id).run();

    assert.equal((await response(h, "/api/workspaces/" + legacy.id + "/posts", { cookie: alice.cookie })).status, 404,
      "even the legacy workspace owner cannot use shared workspace content routes");
    assert.equal((await response(h, "/api/workspaces/" + legacy.id + "/posts/" + publicId, { cookie: bob.cookie })).status, 404);
    const legacyInviteToken = randomBytes(32).toString("base64url");
    await h.db.prepare("INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,'viewer',?,?,?)")
      .bind(legacy.id, bob.email, hash(legacyInviteToken), alice.id, Math.floor(Date.now() / 1000) + 3600).run();
    assert.equal((await response(h, "/api/invitations?token=" + legacyInviteToken, { cookie: bob.cookie })).status, 403,
      "regular accounts cannot preview legacy shared workspace invitations");
    assert.equal((await response(h, "/api/invitations", { method: "POST", cookie: bob.cookie, body: { token: legacyInviteToken } })).status, 403,
      "regular accounts cannot accept legacy shared workspace invitations");
    await assert.rejects(h.db.prepare("DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?").bind(legacy.id, alice.id).run(),
      "DB trigger must prevent deleting an owner");

    const aliceToken = await tokenFor(h, alice.id);
    const bobToken = await tokenFor(h, bob.id);
    const ownList = await callMcpTool(h, { name: "list_my_posts", token: aliceToken, arguments: {} });
    assert.equal(ownList.isError, undefined, JSON.stringify(ownList.structuredContent));
    assert.equal(ownList.structuredContent.posts.some(post => post.publicId === publicId), false,
      "personal MCP must not list articles from legacy shared workspaces");
    const legacyRead = await callMcpTool(h, { name: "get_my_post", token: aliceToken, arguments: { identifier: publicId } });
    assert.equal(legacyRead.isError, true);
    const broadRead = await callMcpTool(h, { name: "get_post", token: bobToken, arguments: { identifier: publicId } });
    assert.equal(broadRead.isError, true, "broad workspace article tools are not registered for regular accounts");
  } finally { await closeTestHarness(h); }
});

test("shared workspace role changes never grant regular users access to private content", async () => {
  const h = await openTestHarness();
  try {
    const alice = await makeActiveUser(h, "workspace-role-owner");
    const bob = await makeActiveUser(h, "workspace-role-member");
    const shared = await h.db.prepare("INSERT INTO workspaces(kind,owner_user_id,slug,name,status) VALUES('shared',?,?,?,'active') RETURNING id")
      .bind(alice.id, "role-test-" + randomUUID(), "Legacy role test",).first();
    await h.db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,? ,'owner','active')").bind(shared.id, alice.id).run();
    await h.db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,? ,'editor','active')").bind(shared.id, bob.id).run();
    assert.equal((await response(h, "/api/workspaces/" + shared.id + "/members", { cookie: alice.cookie })).status, 404);
    assert.equal((await response(h, "/api/workspaces/" + shared.id + "/posts", { cookie: bob.cookie })).status, 404);
    const token = await tokenFor(h, bob.id);
    assert.equal((await callMcpTool(h, { name: "create_my_draft", token, arguments: { title: "Personal only" } })).isError, undefined);
    assert.equal((await callMcpTool(h, { name: "get_post", token, arguments: { workspace_id: shared.id, identifier: "not-found" } })).isError, true);
  } finally { await closeTestHarness(h); }
});

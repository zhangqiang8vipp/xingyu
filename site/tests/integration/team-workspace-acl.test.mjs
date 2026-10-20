import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { openTestHarness, closeTestHarness, jsonRequest, callMcpTool } from "./harness.mjs";
import { makeActiveUser } from "./identity-fixtures.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
async function call(h, url, options) {
  const res = await jsonRequest(h, url, options);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function createOrg(h, user, name) {
  const r = await call(h, "/api/organizations", { method: "POST", cookie: user.cookie, body: { name } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.organization;
}
async function joinOrg(h, organization, user, inviter) {
  const token = randomBytes(32).toString("base64url");
  await h.db.prepare("INSERT INTO organization_invitations(organization_id,email,role,token_hash,invited_by,expires_at) VALUES(?,? ,'member',?,?,?)")
    .bind(organization.id, user.email, hash(token), inviter.id, Math.floor(Date.now() / 1000) + 3600).run();
  const r = await call(h, "/api/organization-invitations", { method: "POST", cookie: user.cookie, body: { token } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
async function createTeam(h, organization, owner, name) {
  const r = await call(h, "/api/organizations/" + organization.id + "/teams", { method: "POST", cookie: owner.cookie, body: { name } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.team;
}
async function addTeamMember(h, organization, teamId, owner, user) {
  const r = await call(h, "/api/organizations/" + organization.id + "/teams/" + teamId + "/members", { method: "POST", cookie: owner.cookie, body: { userId: user.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
async function tokenFor(h, userId) {
  const token = "xy_at_" + randomBytes(32).toString("base64url");
  await h.db.prepare("INSERT INTO oauth_access_tokens(token_hash,client_id,subject,resource,scope,expires_at) VALUES(?,?,?,?,?,?)")
    .bind(hash(token), "chatgpt-xingyu", "user:" + userId, h.origin + "/mcp", "xingyu.read xingyu.draft xingyu.publish", Math.floor(Date.now() / 1000) + 3600).run();
  return token;
}

test("organization MCP remains available while team membership never grants workspace article access", async () => {
  const h = await openTestHarness();
  try {
    const owner = await makeActiveUser(h, "team-owner");
    const bob = await makeActiveUser(h, "team-bob");
    const stranger = await makeActiveUser(h, "team-stranger");
    const organization = await createOrg(h, owner, "研发组织");
    const otherOrg = await createOrg(h, stranger, "另一个组织");
    await joinOrg(h, organization, bob, owner);
    const team = await createTeam(h, organization, owner, "研发团队");
    const outsiderTeam = await createTeam(h, otherOrg, stranger, "无关团队");
    await addTeamMember(h, organization, team.id, owner, bob);

    const suffix = randomUUID().replaceAll("-", "");
    const slug = "legacy-org-ws-" + suffix;
    const legacy = await h.db.prepare("INSERT INTO workspaces(kind,owner_user_id,slug,name,status) VALUES('organization',?,?,?,'active') RETURNING id")
      .bind(owner.id, slug, "Legacy organization workspace").first();
    await h.db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,? ,'owner','active')").bind(legacy.id, owner.id).run();
    await h.db.prepare("INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,? ,'editor','active')").bind(legacy.id, bob.id).run();
    await h.db.prepare("INSERT INTO organization_workspaces(organization_id,workspace_id) VALUES(?,?)").bind(organization.id, legacy.id).run();
    await h.db.prepare("INSERT INTO workspace_team_grants(organization_id,workspace_id,team_id,role) VALUES(?,?,?,'editor')")
      .bind(organization.id, legacy.id, team.id).run();
    await h.db.prepare("INSERT INTO categories(workspace_id,name,slug,color) VALUES(?,?,?,'#567c88')").bind(legacy.id, "组织资料", slug + "-notes").run();
    const category = await h.db.prepare("SELECT id FROM categories WHERE workspace_id=? LIMIT 1").bind(legacy.id).first();
    const space = await h.db.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,NULL,?,?) RETURNING id")
      .bind(legacy.id, "组织知识库", slug + "-root").first();
    const publicId = "ORG_PRIVATE_" + suffix;
    await h.db.prepare("INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,featured,author_id,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(legacy.id, publicId, "Team private article", slug, "private", "# team secret", category.id, space.id, "draft", 0, owner.id, owner.id, owner.id).run();

    assert.equal((await call(h, "/api/organizations/" + organization.id + "/workspaces", { cookie: owner.cookie })).status, 200);
    assert.equal((await call(h, "/api/organizations/" + organization.id + "/workspaces", { cookie: bob.cookie })).status, 200);
    assert.equal((await call(h, "/api/workspaces/" + legacy.id + "/posts", { cookie: owner.cookie })).status, 404,
      "organization owners use organization structure, not shared article workspaces");
    assert.equal((await call(h, "/api/workspaces/" + legacy.id + "/posts/" + publicId, { cookie: bob.cookie })).status, 404,
      "team grants cannot expose another authors private article");
    assert.equal((await call(h, "/api/organizations/" + organization.id + "/workspaces", { method: "POST", cookie: owner.cookie, body: { name: "No shared workspace" } })).status, 403);

    const ownerToken = await tokenFor(h, owner.id);
    const bobToken = await tokenFor(h, bob.id);
    const teams = await callMcpTool(h, { name: "list_organization_teams", token: bobToken, arguments: { organization_id: organization.id } });
    assert.equal(teams.isError, undefined, JSON.stringify(teams.structuredContent));
    assert.ok(teams.structuredContent.teams.some(item => item.name === "研发团队"));
    const ownerRead = await callMcpTool(h, { name: "get_my_post", token: ownerToken, arguments: { identifier: publicId } });
    assert.equal(ownerRead.isError, true, "personal MCP must not read organization workspace articles");
    const bobRead = await callMcpTool(h, { name: "get_my_post", token: bobToken, arguments: { identifier: publicId } });
    assert.equal(bobRead.isError, true);
    const oldTool = await callMcpTool(h, { name: "get_post", token: bobToken, arguments: { workspace_id: legacy.id, identifier: publicId } });
    assert.equal(oldTool.isError, true, "broad workspace tools are not registered for ordinary users");
    const bobOrgs = await callMcpTool(h, { name: "list_organizations", token: bobToken, arguments: {} });
    assert.equal(bobOrgs.isError, undefined);
    assert.match(JSON.stringify(bobOrgs.structuredContent), /研发组织/);
    assert.doesNotMatch(JSON.stringify(bobOrgs.structuredContent), /另一个组织/);

    await assert.rejects(h.db.prepare("INSERT INTO workspace_team_grants(organization_id,workspace_id,team_id,role) VALUES(?,?,?,'viewer')")
      .bind(organization.id, legacy.id, outsiderTeam.id).run(), "DB rejects cross-tenant team grants");
    assert.equal((await call(h, "/api/workspaces/" + owner.workspaceId + "/posts", { cookie: bob.cookie })).status, 404);
  } finally { await closeTestHarness(h); }
});

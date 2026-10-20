import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { openTestHarness, closeTestHarness, jsonRequest, callMcpTool } from "./harness.mjs";
import { makeActiveUser } from "./identity-fixtures.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");

async function api(h, path, options) {
  const response = await jsonRequest(h, path, options);
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function tokenFor(h, userId, scope = "xingyu.read xingyu.draft xingyu.publish offline_access") {
  const token = "xy_at_" + randomBytes(32).toString("base64url");
  await h.db.prepare(
    "INSERT INTO oauth_access_tokens(token_hash,client_id,subject,resource,scope,expires_at) VALUES(?,?,?,?,?,?)",
  ).bind(hash(token), "gemini-xingyu", "user:" + userId, h.origin + "/mcp", scope,
    Math.floor(Date.now() / 1000) + 3600).run();
  return token;
}

async function seedPublicPost(h) {
  const category = await h.db.prepare(
    "SELECT id FROM categories WHERE workspace_id=1 ORDER BY id LIMIT 1",
  ).first();
  assert.ok(category, "the public site workspace should have its default category");
  const suffix = randomUUID().replaceAll("-", "");
  const publicId = "PORTAL_PUBLIC_" + suffix;
  const slug = "portal-public-" + suffix;
  const inserted = await h.db.prepare(
    "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,featured,published_at) " +
    "VALUES(1,?,?,?,?,?,?,NULL,'published',0,?) RETURNING id",
  ).bind(publicId, "公开测试文章 " + suffix.slice(0, 8), slug, "公开摘要", "# 公开正文", category.id,
    new Date().toISOString()).first();
  return { publicId, slug, id: inserted.id };
}

test("personal knowledge portal isolates private articles and only exposes published public posts", async () => {
  const h = await openTestHarness();
  try {
    const alice = await makeActiveUser(h, "portal-alice");
    const bob = await makeActiveUser(h, "portal-bob");
    const publicPost = await seedPublicPost(h);

    const created = await api(h, "/api/knowledge/posts", {
      method: "POST", cookie: alice.cookie,
      body: { title: "Alice private note", content_markdown: "# Secret Alice" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const privateId = created.data.post.publicId;
    const workspaceId = created.data.workspaceId;
    const privateAttachment = "att_" + randomBytes(16).toString("hex");
    const publicAttachment = "att_" + randomBytes(16).toString("hex");
    const collaboratorAttachment = "att_" + randomBytes(16).toString("hex");
    const collaboratorPublicId = "BOB_IN_ALICE_WORKSPACE_" + randomUUID().replaceAll("-", "");
    const privateCategory = await h.db.prepare("SELECT id FROM categories WHERE workspace_id=? ORDER BY id LIMIT 1").bind(workspaceId).first();
    const privateSpace = await h.db.prepare("SELECT id FROM spaces WHERE workspace_id=? AND parent_id IS NULL ORDER BY id LIMIT 1").bind(workspaceId).first();
    const collaboratorPost = await h.db.prepare(
      "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,featured,author_id,created_by,updated_by) " +
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id",
    ).bind(workspaceId, collaboratorPublicId, "Bob private in Alice workspace", "bob-private-" + randomUUID().slice(0, 8),
      "collaborator secret", "# Bob secret", privateCategory.id, privateSpace.id, "draft", 0, bob.id, bob.id, bob.id).first();
    await h.db.prepare(
      "INSERT INTO attachments(workspace_id,public_id,post_id,object_key,original_name,content_type,size,sha256) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(workspaceId, collaboratorAttachment, collaboratorPost.id,
      "attachments/ws" + workspaceId + "/2026/10/" + collaboratorAttachment + "/bob-secret.txt",
      "bob-secret.txt", "text/plain", 10, hash("bob-secret")).run();
    await h.db.prepare(
      "INSERT INTO attachments(workspace_id,public_id,post_id,object_key,original_name,content_type,size,sha256) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(created.data.workspaceId, privateAttachment, created.data.post.id,
      "attachments/ws" + created.data.workspaceId + "/2026/10/" + privateAttachment + "/alice-secret.txt",
      "alice-secret.txt", "text/plain", 12, hash("alice-secret")).run();
    await h.db.prepare(
      "INSERT INTO attachments(workspace_id,public_id,post_id,object_key,original_name,content_type,size,sha256) VALUES(1,?,?,?,?,?,?,?)",
    ).bind(publicAttachment, publicPost.id, "attachments/2026/10/" + publicAttachment + "/public-guide.pdf",
      "public-guide.pdf", "application/pdf", 24, hash("public-guide")).run();

    const aliceMine = await api(h, "/api/knowledge/posts?type=mine", { cookie: alice.cookie });
    assert.equal(aliceMine.status, 200);
    assert.ok(aliceMine.data.posts.some(post => post.publicId === privateId));
    assert.equal(aliceMine.data.posts.some(post => post.publicId === collaboratorPublicId), false,
      "workspace owner must not see another author private article");
    assert.equal((await api(h, "/api/knowledge/posts/" + collaboratorPublicId, { cookie: alice.cookie })).status, 404,
      "knowing a collaborator article ID must not bypass author isolation");
    assert.equal((await api(h, "/api/workspaces/" + workspaceId + "/posts", { cookie: bob.cookie })).status, 404,
      "a registered user cannot access another personal workspace through legacy APIs");

    const bobMine = await api(h, "/api/knowledge/posts?type=mine", { cookie: bob.cookie });
    assert.equal(bobMine.status, 200);
    assert.equal(bobMine.data.posts.some(post => post.publicId === privateId), false,
      "one user's personal article must never appear in another user's list");

    assert.equal((await api(h, "/api/knowledge/posts/" + privateId, { cookie: bob.cookie })).status, 404,
      "private article identifiers cannot bypass personal-workspace ACL");

    const bobPublic = await api(h, "/api/knowledge/posts/" + publicPost.publicId, { cookie: bob.cookie });
    assert.equal(bobPublic.status, 200, JSON.stringify(bobPublic.data));
    assert.equal(bobPublic.data.post.visibility, "public");
    assert.equal(bobPublic.data.post.canEdit, false);
    assert.equal(bobPublic.data.post.content, "# 公开正文");

    const publicList = await api(h, "/api/knowledge/posts?type=public", { cookie: bob.cookie });
    assert.equal(publicList.status, 200);
    assert.ok(publicList.data.posts.some(post => post.publicId === publicPost.publicId));
    assert.equal(publicList.data.posts.some(post => post.publicId === privateId), false);

    const bobFiles = await api(h, "/api/knowledge/files", { cookie: bob.cookie });
    assert.equal(bobFiles.status, 200, JSON.stringify(bobFiles.data));
    assert.ok(bobFiles.data.files.some(file => file.id === publicAttachment && file.visibility === "public"));
    assert.equal(bobFiles.data.files.some(file => file.id === privateAttachment), false, "the file library must not reveal another user private attachments");
    const aliceFiles = await api(h, "/api/knowledge/files", { cookie: alice.cookie });
    assert.equal(aliceFiles.status, 200, JSON.stringify(aliceFiles.data));
    assert.ok(aliceFiles.data.files.some(file => file.id === privateAttachment && file.visibility === "personal"));
    assert.ok(aliceFiles.data.files.some(file => file.id === publicAttachment && file.visibility === "public"));
    assert.equal(aliceFiles.data.files.some(file => file.id === collaboratorAttachment), false,
      "the personal file list must exclude attachments belonging to another author");

    const deniedPublicEdit = await api(h, "/api/knowledge/posts/" + publicPost.publicId, {
      method: "PATCH", cookie: bob.cookie,
      body: { expected_version: 1, title: "Hijack public article" },
    });
    assert.equal(deniedPublicEdit.status, 404, "personal editor must not modify public site articles");

    const updated = await api(h, "/api/knowledge/posts/" + privateId, {
      method: "PATCH", cookie: alice.cookie,
      body: { expected_version: 1, title: "Alice private note updated", content_markdown: "# Still private" },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.post.title, "Alice private note updated");
    assert.equal(updated.data.post.visibility, "personal");
  } finally {
    await closeTestHarness(h);
  }
});

test("authenticated MCP exposes public read and organization structure tools without cross-user leakage", async () => {
  const h = await openTestHarness();
  try {
    const alice = await makeActiveUser(h, "mcp-org-alice");
    const bob = await makeActiveUser(h, "mcp-org-bob");
    const publicPost = await seedPublicPost(h);
    const aliceToken = await tokenFor(h, alice.id);
    const bobToken = await tokenFor(h, bob.id);

    const publicRead = await callMcpTool(h, {
      name: "get_public_post", token: bobToken,
      arguments: { public_id: publicPost.publicId },
    });
    assert.equal(publicRead.isError, undefined, JSON.stringify(publicRead));
    assert.match(JSON.stringify(publicRead.structuredContent ?? publicRead), /公开正文/);

    const privateDraft = await api(h, "/api/knowledge/posts", {
      method: "POST", cookie: alice.cookie,
      body: { title: "Alice MCP private note", content_markdown: "# MCP private secret" },
    });
    assert.equal(privateDraft.status, 201);
    const privateRead = await callMcpTool(h, {
      name: "get_public_post", token: bobToken,
      arguments: { public_id: privateDraft.data.post.publicId },
    });
    assert.equal(privateRead.isError, true, "public MCP tool must not expose personal drafts");

    const createdOrg = await callMcpTool(h, {
      name: "create_organization", token: bobToken,
      arguments: { name: "Bob MCP Organization" },
    });
    assert.equal(createdOrg.isError, undefined, JSON.stringify(createdOrg));
    const bobOrgs = await callMcpTool(h, { name: "list_organizations", token: bobToken, arguments: {} });
    assert.equal(bobOrgs.isError, undefined, JSON.stringify(bobOrgs));
    assert.match(JSON.stringify(bobOrgs.structuredContent ?? bobOrgs), /Bob MCP Organization/);
    const aliceOrgs = await callMcpTool(h, { name: "list_organizations", token: aliceToken, arguments: {} });
    assert.equal(aliceOrgs.isError, undefined, JSON.stringify(aliceOrgs));
    assert.doesNotMatch(JSON.stringify(aliceOrgs.structuredContent ?? aliceOrgs), /Bob MCP Organization/,
      "organization listings must be scoped to the authenticated user");
  } finally {
    await closeTestHarness(h);
  }
});

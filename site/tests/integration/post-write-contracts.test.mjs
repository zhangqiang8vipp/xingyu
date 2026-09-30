import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AttachmentCleanupRequiredError, cleanupFailedAttachmentUpload, enqueueExpiredUnboundAttachments } from "../../db/attachment-cleanup.ts";
import {
  callMcpTool,
  closeTestHarness,
  countPostsBySlug,
  jsonRequest,
  loginAdmin,
  openTestHarness,
  TEST_LEGACY_MCP_TOKEN,
} from "./harness.mjs";

const createSlug = "atomic-create-contract";
const updateSlug = "atomic-update-contract";
const attachmentId = "att_0123456789abcdef0123456789abcdef";
const secondAttachmentId = "att_fedcba9876543210fedcba9876543210";
const markdown = `[attachment](/api/attachments/${attachmentId}/example.md)`;

function payload(slug, content) {
  return {
    title: slug,
    slug,
    excerpt: "contract",
    content,
    categoryId: 1,
    spaceId: null,
    status: "draft",
    featured: false,
    publishedAt: null,
  };
}

test("attachment binding failure rolls back article creation and editing", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    await harness.db.prepare(`INSERT INTO attachments
      (public_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, 'contract-object', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(attachmentId).run();
    await harness.db.prepare(`CREATE TRIGGER fail_attachment_binding BEFORE UPDATE OF post_id ON attachments
      BEGIN SELECT RAISE(ABORT, 'injected attachment failure'); END`).run();

    const failedCreate = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload(createSlug, markdown),
    });
    assert.equal(failedCreate.status, 500, "a D1 attachment failure must not be reported as a user conflict");
    assert.equal(await countPostsBySlug(harness.db, createSlug), 0,
      "a failed creation must leave no article row");

    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload(updateSlug, "before"),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();

    const failedUpdate = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie, body: { ...payload("atomic-update-new-slug", markdown), version: post.version },
    });
    assert.equal(failedUpdate.status, 500, "a D1 attachment failure must not be reported as a user conflict");
    const persisted = await harness.db.prepare("SELECT slug, content FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, { slug: updateSlug, content: "before" },
      "a failed update must keep the old article unchanged");
    const history = await harness.db.prepare("SELECT COUNT(*) AS count FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).first();
    assert.equal(history?.count, 0, "a failed update must not leave a slug-history entry");

    await harness.db.prepare("DROP TRIGGER fail_attachment_binding").run();
    const retriedUpdate = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie, body: { ...payload("atomic-update-new-slug", markdown), version: post.version },
    });
    assert.equal(retriedUpdate.status, 200, `retrying after the database recovers must succeed: ${await retriedUpdate.clone().text()}`);
    const updatedAttachment = await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(attachmentId).first();
    assert.equal(updatedAttachment?.post_id, post.id);
    const savedHistory = await harness.db.prepare("SELECT slug FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).first();
    assert.equal(savedHistory?.slug, updateSlug);

    await harness.db.prepare(`INSERT INTO attachments
      (public_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, 'contract-object-2', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(secondAttachmentId).run();
    const createWithAttachment = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie,
      body: payload(createSlug, `[attachment](/api/attachments/${secondAttachmentId}/example.md)`),
    });
    assert.equal(createWithAttachment.status, 201, "normal creation must still bind its attachment");
    const { post: attachedPost } = await createWithAttachment.json();
    const createdAttachment = await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(secondAttachmentId).first();
    assert.equal(createdAttachment?.post_id, attachedPost.id);
  } finally {
    await closeTestHarness(harness);
  }
});

test("post slug conflicts and storage failures produce different responses", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("occupied-post-slug", "before"),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();
    const duplicate = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("occupied-post-slug", "duplicate"),
    });
    assert.equal(duplicate.status, 409, "a duplicate post slug remains a user conflict");

    await harness.db.prepare(`CREATE TRIGGER reject_test_post_insert BEFORE INSERT ON posts
      WHEN NEW.slug = 'injected-create-failure' BEGIN SELECT RAISE(FAIL, 'injected post storage failure'); END`).run();
    await harness.db.prepare(`CREATE TRIGGER reject_test_post_update BEFORE UPDATE ON posts
      WHEN NEW.slug = 'injected-update-failure' BEGIN SELECT RAISE(FAIL, 'injected post storage failure'); END`).run();
    const failedCreate = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("injected-create-failure", "new"),
    });
    assert.equal(failedCreate.status, 500, "a post insert failure must not be reported as a slug conflict");
    const failedUpdate = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie, body: { ...payload("injected-update-failure", "changed"), version: post.version },
    });
    assert.equal(failedUpdate.status, 500, "a post update failure must not be reported as a slug conflict");
    assert.deepEqual(await harness.db.prepare("SELECT slug, content, version FROM posts WHERE id = ?")
      .bind(post.id).first(), { slug: "occupied-post-slug", content: "before", version: post.version });
    assert.equal(await countPostsBySlug(harness.db, "injected-create-failure"), 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("missing or already-owned Markdown attachments cannot produce a successful article write", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const missing = `[file](/api/attachments/${attachmentId}/missing.md)`;
    const invalidCreate = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("missing-attachment-create", missing),
    });
    assert.equal(invalidCreate.status, 409);
    assert.equal(await countPostsBySlug(harness.db, "missing-attachment-create"), 0);

    await harness.db.prepare(`INSERT INTO attachments
      (public_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, 'unbound-object', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(secondAttachmentId).run();
    const mixed = `${missing}\n[file](/api/attachments/${secondAttachmentId}/example.md)`;
    const invalidMixedCreate = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("partly-valid-attachment-create", mixed),
    });
    assert.equal(invalidMixedCreate.status, 409);
    assert.equal(await countPostsBySlug(harness.db, "partly-valid-attachment-create"), 0);
    const stillUnbound = await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(secondAttachmentId).first();
    assert.equal(stillUnbound?.post_id, null, "a rejected creation must not touch its valid attachment either");

    await harness.db.prepare(`INSERT INTO attachments
      (public_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, 'owned-object', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(attachmentId).run();
    const owner = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("attachment-owner", markdown),
    });
    assert.equal(owner.status, 201, await owner.clone().text());

    const wrongOwner = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("other-attachment-owner", markdown),
    });
    assert.equal(wrongOwner.status, 409);
    assert.equal(await countPostsBySlug(harness.db, "other-attachment-owner"), 0);

    const editable = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("attachment-target", "unchanged"),
    });
    assert.equal(editable.status, 201);
    const { post } = await editable.json();
    for (const [slug, content] of [
      ["missing-attachment-update", missing],
      ["owned-attachment-update", markdown],
    ]) {
      const rejected = await jsonRequest(harness, `/api/posts/${post.id}`, {
        method: "PATCH", cookie, body: { ...payload(slug, content), version: post.version },
      });
      assert.equal(rejected.status, 409);
      const persisted = await harness.db.prepare("SELECT slug, content, version FROM posts WHERE id = ?")
        .bind(post.id).first();
      assert.deepEqual(persisted, { slug: "attachment-target", content: "unchanged", version: post.version });
      const history = await harness.db.prepare("SELECT COUNT(*) AS count FROM post_slug_history WHERE post_id = ?")
        .bind(post.id).first();
      assert.equal(history?.count, 0);
    }
  } finally {
    await closeTestHarness(harness);
  }
});

test("more than 200 distinct internal attachment links are rejected rather than truncated", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    await harness.db.prepare(`WITH RECURSIVE seq(n) AS (
      SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 199
    ) INSERT INTO attachments (public_id, object_key, original_name, content_type, size, sha256)
      SELECT 'att_' || printf('%032x', n), 'bulk-' || n, 'file.md', 'text/markdown', 1, 'contract'
      FROM seq`).run();
    const content = Array.from({ length: 201 }, (_, n) =>
      `[file](/api/attachments/att_${n.toString(16).padStart(32, "0")}/file.md)`).join("\n");
    const seeded = await harness.db.prepare("SELECT COUNT(*) AS count FROM attachments").first();
    assert.equal(seeded?.count, 200);
    const response = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("too-many-attachments", content),
    });
    assert.equal(response.status, 400,
      `the editor should explain the reference limit before writing: ${await response.clone().text()}`);
    assert.match((await response.json()).error, /最多引用 200 个不同的内部附件/);
    assert.equal(await countPostsBySlug(harness.db, "too-many-attachments"), 0);
    const bound = await harness.db.prepare("SELECT COUNT(*) AS count FROM attachments WHERE post_id IS NOT NULL").first();
    assert.equal(bound?.count, 0);
    const accepted = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("maximum-attachments", content.split("\n").slice(0, 200).join("\n")),
    });
    assert.equal(accepted.status, 201, `200 valid references should be saved: ${await accepted.clone().text()}`);
    const linked = await harness.db.prepare("SELECT COUNT(*) AS count FROM attachments WHERE post_id IS NOT NULL").first();
    assert.equal(linked?.count, 200);
  } finally {
    await closeTestHarness(harness);
  }
});

test("article writes and category deletion cannot leave posts with a missing category", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const unknown = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: { ...payload("missing-category", "body"), categoryId: 9999 },
    });
    assert.notEqual(unknown.status, 201);
    assert.equal(await countPostsBySlug(harness.db, "missing-category"), 0);

    await harness.db.prepare("INSERT INTO categories (id, name, slug) VALUES (2, 'Temporary', 'temporary')").run();
    const [created, removed] = await Promise.all([
      jsonRequest(harness, "/api/posts", {
        method: "POST", cookie, body: { ...payload("category-race", "body"), categoryId: 2 },
      }),
      jsonRequest(harness, "/api/categories/2", { method: "DELETE", cookie }),
    ]);
    assert.ok(!(created.status === 201 && removed.status === 200),
      "creating a post and deleting its category cannot both succeed");
    const orphan = await harness.db.prepare(`SELECT COUNT(*) AS count FROM posts p
      LEFT JOIN categories c ON c.id = p.category_id WHERE c.id IS NULL`).first();
    assert.equal(orphan?.count, 0);
    const storedPost = await harness.db.prepare("SELECT category_id FROM posts WHERE slug = 'category-race'").first();
    const storedCategory = await harness.db.prepare("SELECT id FROM categories WHERE id = 2").first();
    assert.equal(Boolean(storedPost), Boolean(storedCategory),
      "either the post and category survive together, or neither does");

    const editable = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("category-update-original", "original body"),
    });
    assert.equal(editable.status, 201);
    const { post } = await editable.json();
    const rejectedUpdate = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("category-update-invalid", "changed body"), categoryId: 9999, version: post.version },
    });
    assert.equal(rejectedUpdate.status, 409);
    const retained = await harness.db.prepare("SELECT slug, content, category_id, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(retained, {
      slug: "category-update-original", content: "original body", category_id: 1, version: post.version,
    });
    const history = await harness.db.prepare("SELECT COUNT(*) AS count FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).first();
    assert.equal(history?.count, 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("article writes and empty-space deletion cannot leave orphaned or public posts", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const invalid = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie,
      body: { ...payload("missing-space-post", "private body"), spaceId: 9999, status: "published" },
    });
    assert.notEqual(invalid.status, 201);
    assert.equal(await countPostsBySlug(harness.db, "missing-space-post"), 0);

    const createdSpace = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie,
      body: { name: "Concurrent space", slug: "concurrent-space", parentId: null, sortOrder: 0 },
    });
    assert.equal(createdSpace.status, 201);
    const { space } = await createdSpace.json();
    const [postResponse, deleteResponse] = await Promise.all([
      jsonRequest(harness, "/api/posts", {
        method: "POST", cookie,
        body: { ...payload("space-delete-race", "private body"), spaceId: space.id, status: "published" },
      }),
      jsonRequest(harness, `/api/spaces/${space.id}`, {
        method: "DELETE", cookie, body: { mode: "empty" },
      }),
    ]);
    assert.ok(!(postResponse.status === 201 && deleteResponse.status === 200),
      "a private post cannot be saved into a space that was concurrently deleted");
    const orphan = await harness.db.prepare(`SELECT COUNT(*) AS count FROM posts p
      LEFT JOIN spaces s ON s.id = p.space_id WHERE p.space_id IS NOT NULL AND s.id IS NULL`).first();
    assert.equal(orphan?.count, 0);
    const storedPost = await harness.db.prepare("SELECT space_id FROM posts WHERE slug = 'space-delete-race'").first();
    const storedSpace = await harness.db.prepare("SELECT id FROM spaces WHERE id = ?").bind(space.id).first();
    assert.equal(Boolean(storedPost), Boolean(storedSpace));
  } finally {
    await closeTestHarness(harness);
  }
});

test("creating a child and deleting its parent cannot both succeed", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const parentResponse = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie,
      body: { name: "Parent", slug: "parent-race", parentId: null, sortOrder: 0 },
    });
    assert.equal(parentResponse.status, 201);
    const parentId = (await parentResponse.json()).space.id;
    const [childResponse, deleteResponse] = await Promise.all([
      jsonRequest(harness, "/api/spaces", {
        method: "POST", cookie,
        body: { name: "Child", slug: "child-race", parentId, sortOrder: 0 },
      }),
      jsonRequest(harness, `/api/spaces/${parentId}`, {
        method: "DELETE", cookie, body: { mode: "empty" },
      }),
    ]);
    assert.ok(!(childResponse.status === 201 && deleteResponse.status === 200));
    const orphan = await harness.db.prepare(`SELECT COUNT(*) AS count FROM spaces child
      LEFT JOIN spaces parent ON parent.id = child.parent_id
      WHERE child.parent_id IS NOT NULL AND parent.id IS NULL`).first();
    assert.equal(orphan?.count, 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("space tree counts include articles in every descendant", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const createSpace = async (name, parentId) => {
      const response = await jsonRequest(harness, "/api/spaces", {
        method: "POST", cookie, body: { name, parentId },
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()).space.id;
    };
    const rootId = await createSpace("Count root", null);
    const childId = await createSpace("Count child", rootId);
    const grandchildId = await createSpace("Count grandchild", childId);
    const otherRootId = await createSpace("Other count root", null);
    for (const [slug, spaceId] of [["count-child-post", childId], ["count-grandchild-post", grandchildId]]) {
      const response = await jsonRequest(harness, "/api/posts", {
        method: "POST", cookie, body: { ...payload(slug, "private body"), spaceId },
      });
      assert.equal(response.status, 201, await response.clone().text());
    }

    const rootsResponse = await jsonRequest(harness, "/api/spaces?parent=root", { cookie });
    assert.equal(rootsResponse.status, 200);
    const roots = (await rootsResponse.json()).spaces;
    assert.deepEqual(
      [roots.find((space) => space.id === rootId)?.articleCount,
        roots.find((space) => space.id === rootId)?.totalArticleCount,
        roots.find((space) => space.id === otherRootId)?.totalArticleCount],
      [0, 2, 0],
    );

    const childrenResponse = await jsonRequest(harness, `/api/spaces?parent=${rootId}`, { cookie });
    assert.equal(childrenResponse.status, 200);
    const [child] = (await childrenResponse.json()).spaces;
    assert.equal(child.id, childId);
    assert.equal(child.articleCount, 1);
    assert.equal(child.totalArticleCount, 2);
  } finally {
    await closeTestHarness(harness);
  }
});

test("space browsing follows ascending sibling order from admin and MCP updates", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const create = async (name, parentId, sortOrder) => {
      const response = await jsonRequest(harness, "/api/spaces", {
        method: "POST", cookie, body: { name, parentId, sortOrder },
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()).space.id;
    };
    const parentId = await create("Order parent", null, 10);
    const laterId = await create("Order later", parentId, 20);
    const earlierId = await create("Order earlier", parentId, -2);
    const middleId = await create("Order middle", parentId, 5);
    const listChildren = async () => {
      const response = await jsonRequest(harness, `/api/spaces?parent=${parentId}`, { cookie });
      assert.equal(response.status, 200);
      return (await response.json()).spaces.map(({ id }) => id);
    };
    assert.deepEqual(await listChildren(), [earlierId, middleId, laterId]);

    const changed = await jsonRequest(harness, `/api/spaces/${laterId}`, {
      method: "PATCH", cookie, body: { sortOrder: -3 },
    });
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.deepEqual(await listChildren(), [laterId, earlierId, middleId]);

    const mcpChanged = await callMcpTool(harness, {
      name: "update_space", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { space: String(middleId), sort_order: -4, change_summary: "Move middle to first browsing position" },
    });
    assert.equal(mcpChanged.isError, undefined, JSON.stringify(mcpChanged.structuredContent));
    assert.deepEqual(mcpChanged.structuredContent?.receipt?.changed_fields, ["sort_order"]);
    assert.deepEqual(await listChildren(), [middleId, laterId, earlierId]);
    const overviewResponse = await jsonRequest(harness, `/api/spaces/${parentId}`, { cookie });
    assert.equal(overviewResponse.status, 200);
    assert.deepEqual((await overviewResponse.json()).space.children.map(({ id }) => id),
      [middleId, laterId, earlierId], "the child cards use the same browsing order");

    const mcpCreated = await callMcpTool(harness, {
      name: "create_space", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { name: "MCP first", parent: String(parentId), sort_order: -5,
        change_summary: "Create a first-position child" },
    });
    assert.equal(mcpCreated.isError, undefined, JSON.stringify(mcpCreated.structuredContent));
    assert.deepEqual(await listChildren(), [mcpCreated.structuredContent.space.id, middleId, laterId, earlierId]);

    const invalid = await jsonRequest(harness, `/api/spaces/${earlierId}`, {
      method: "PATCH", cookie, body: { sortOrder: 1.5 },
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await listChildren(), [mcpCreated.structuredContent.space.id, middleId, laterId, earlierId]);
  } finally {
    await closeTestHarness(harness);
  }
});

test("space articles browse parent first, then ordered child groups across pages and reader navigation", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const createSpace = async (name, parentId, sortOrder) => {
      const response = await jsonRequest(harness, "/api/spaces", {
        method: "POST", cookie, body: { name, parentId, sortOrder },
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()).space.id;
    };
    const rootId = await createSpace("Reading root", null, 1);
    const secondId = await createSpace("Reading second", rootId, 2);
    const firstId = await createSpace("Reading first", rootId, 1);
    const nestedId = await createSpace("Reading nested", firstId, 1);
    const articles = [];
    for (const [slug, spaceId, sortOrder] of [
      ["root-later", rootId, 5], ["second-only", secondId, 1],
      ["first-only", firstId, 2], ["root-earlier", rootId, -1],
      ["nested-only", nestedId, 1],
    ]) {
      const response = await jsonRequest(harness, "/api/posts", {
        method: "POST", cookie, body: { ...payload(slug, "private"), spaceId, sortOrder },
      });
      assert.equal(response.status, 201, await response.clone().text());
      articles.push((await response.json()).post);
    }
    const expected = [articles[3], articles[0], articles[2], articles[4], articles[1]];
    const rows = [];
    let cursor = null;
    do {
      const params = new URLSearchParams({ scope: "descendants", limit: "2" });
      if (cursor) params.set("cursor", cursor);
      const response = await jsonRequest(harness, `/api/spaces/${rootId}/posts?${params}`, { cookie });
      assert.equal(response.status, 200, await response.clone().text());
      const page = await response.json();
      rows.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(rows.map(({ id }) => id), expected.map(({ id }) => id));
    assert.deepEqual(rows.map(({ sortOrder }) => sortOrder), [-1, 5, 2, 1, 1]);

    const direct = await jsonRequest(harness, `/api/spaces/${rootId}/posts?scope=current`, { cookie });
    assert.deepEqual((await direct.json()).rows.map(({ id }) => id), [articles[3].id, articles[0].id]);
    const reader = await jsonRequest(harness,
      `/api/reader/${articles[0].publicId}?scope=admin&range=space&spaceId=${rootId}&descendants=1&from=spaces`, { cookie });
    assert.equal(reader.status, 200);
    const neighbors = await reader.json();
    assert.equal(neighbors.previousPost?.id, articles[3].id);
    assert.equal(neighbors.nextPost?.id, articles[2].id);
    const otherRootId = await createSpace("Reading later root", null, 2);
    const otherPostResponse = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie,
      body: { ...payload("other-root-post", "private"), spaceId: otherRootId, sortOrder: 0 },
    });
    assert.equal(otherPostResponse.status, 201);
    const otherPost = (await otherPostResponse.json()).post;
    const allSpaces = await jsonRequest(harness, `/api/spaces/${rootId}/posts?scope=all`, { cookie });
    assert.deepEqual((await allSpaces.json()).rows.map(({ id }) => id),
      [...expected.map(({ id }) => id), otherPost.id]);

    const reordered = await callMcpTool(harness, {
      name: "update_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: articles[0].publicId, expected_version: articles[0].version,
        sort_order: -2, change_summary: "Move the root article to the first reading position" },
    });
    assert.equal(reordered.isError, undefined, JSON.stringify(reordered.structuredContent));
    assert.deepEqual(reordered.structuredContent?.receipt?.changed_fields, ["sort_order"]);
    const reorderedDirect = await jsonRequest(harness, `/api/spaces/${rootId}/posts?scope=current`, { cookie });
    assert.deepEqual((await reorderedDirect.json()).rows.map(({ id }) => id),
      [articles[0].id, articles[3].id]);
    const invalid = await jsonRequest(harness, `/api/posts/${articles[0].id}`, {
      method: "PATCH", cookie,
      body: { ...payload("root-later", "private"), spaceId: rootId,
        version: reordered.structuredContent.post.version, sortOrder: 1.5 },
    });
    assert.equal(invalid.status, 400);
  } finally {
    await closeTestHarness(harness);
  }
});

test("space editing still updates its hierarchy and rejects a missing parent", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const first = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie,
      body: { name: "First root", slug: "first-edit-root", parentId: null, sortOrder: 0 },
    });
    const second = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie,
      body: { name: "Second root", slug: "second-edit-root", parentId: null, sortOrder: 0 },
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstId = (await first.json()).space.id;
    const secondId = (await second.json()).space.id;
    const changed = await jsonRequest(harness, `/api/spaces/${firstId}`, {
      method: "PATCH", cookie,
      body: { name: "Renamed child", slug: "renamed-child", parentId: secondId, sortOrder: 7 },
    });
    assert.equal(changed.status, 200, await changed.clone().text());
    const changedBody = await changed.json();
    assert.equal(changedBody.space?.parentId, secondId);
    const saved = await harness.db.prepare("SELECT name, slug, parent_id, sort_order FROM spaces WHERE id = ?")
      .bind(firstId).first();
    assert.deepEqual(saved, {
      name: "Renamed child", slug: "renamed-child", parent_id: secondId, sort_order: 7,
    });
    const rejected = await jsonRequest(harness, `/api/spaces/${firstId}`, {
      method: "PATCH", cookie, body: { name: "Should not save", parentId: 9999 },
    });
    assert.notEqual(rejected.status, 200);
    const retained = await harness.db.prepare("SELECT name, slug, parent_id, sort_order FROM spaces WHERE id = ?")
      .bind(firstId).first();
    assert.deepEqual(retained, saved);
  } finally {
    await closeTestHarness(harness);
  }
});

test("space slug conflicts and storage failures produce different responses", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const first = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "First space", slug: "occupied-space" },
    });
    const second = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "Second space", slug: "second-space" },
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const secondId = (await second.json()).space.id;
    const createConflict = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "Different name", slug: "occupied-space" },
    });
    assert.equal(createConflict.status, 409, "a duplicate space slug must remain a conflict");
    const editConflict = await jsonRequest(harness, `/api/spaces/${secondId}`, {
      method: "PATCH", cookie, body: { slug: "occupied-space" },
    });
    assert.equal(editConflict.status, 409, "an edited slug collision must remain a conflict");

    const firstChild = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "First child", slug: "occupied-child", parentId: secondId },
    });
    const secondChild = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "Second child", slug: "second-child", parentId: secondId },
    });
    assert.equal(firstChild.status, 201);
    assert.equal(secondChild.status, 201);
    const childConflict = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "Third child", slug: "occupied-child", parentId: secondId },
    });
    assert.equal(childConflict.status, 409, "a sibling slug collision must remain a conflict");
    const editChildConflict = await jsonRequest(harness, `/api/spaces/${(await secondChild.json()).space.id}`, {
      method: "PATCH", cookie, body: { slug: "occupied-child" },
    });
    assert.equal(editChildConflict.status, 409, "an edited sibling slug collision must remain a conflict");

    await harness.db.prepare(`CREATE TRIGGER reject_test_space_insert BEFORE INSERT ON spaces
      WHEN NEW.name = 'Injected create failure' BEGIN SELECT RAISE(FAIL, 'injected space storage failure'); END`).run();
    await harness.db.prepare(`CREATE TRIGGER reject_test_space_update BEFORE UPDATE ON spaces
      WHEN NEW.name = 'Injected update failure' BEGIN SELECT RAISE(FAIL, 'injected space storage failure'); END`).run();
    const createFailure = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "Injected create failure", slug: "injected-create-failure" },
    });
    assert.equal(createFailure.status, 500, "a D1 write failure must not be reported as a name collision");
    const updateFailure = await jsonRequest(harness, `/api/spaces/${secondId}`, {
      method: "PATCH", cookie, body: { name: "Injected update failure" },
    });
    assert.equal(updateFailure.status, 500, "a D1 update failure must not be reported as a name collision");
    assert.equal((await harness.db.prepare("SELECT name FROM spaces WHERE id = ?")
      .bind(secondId).first())?.name, "Second space", "failed updates must leave the space unchanged");
  } finally {
    await closeTestHarness(harness);
  }
});

test("concurrent space moves cannot create a cycle or strand moved content", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const create = async (name, parentId = null) => {
      const response = await jsonRequest(harness, "/api/spaces", {
        method: "POST", cookie, body: { name, slug: name.toLowerCase().replaceAll(" ", "-"), parentId },
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()).space.id;
    };

    const first = await create("Cycle first");
    const second = await create("Cycle second");
    const [firstMove, secondMove] = await Promise.all([
      jsonRequest(harness, `/api/spaces/${first}`, {
        method: "PATCH", cookie, body: { parentId: second },
      }),
      jsonRequest(harness, `/api/spaces/${second}`, {
        method: "PATCH", cookie, body: { parentId: first },
      }),
    ]);
    assert.equal([firstMove.status, secondMove.status].filter((status) => status === 200).length, 1);
    const pair = await harness.db.prepare("SELECT id, parent_id FROM spaces WHERE id IN (?, ?) ORDER BY id")
      .bind(first, second).all();
    const parents = new Map(pair.results.map((row) => [row.id, row.parent_id]));
    assert.ok(!(parents.get(first) === second && parents.get(second) === first),
      "opposing moves must not leave a two-node cycle");

    const source = await create("Move source");
    const target = await create("Move target");
    const child = await create("Move child", source);
    const [reparentTarget, deleteSource] = await Promise.all([
      jsonRequest(harness, `/api/spaces/${target}`, {
        method: "PATCH", cookie, body: { parentId: source },
      }),
      jsonRequest(harness, `/api/spaces/${source}`, {
        method: "DELETE", cookie, body: { mode: "move", moveTo: target },
      }),
    ]);
    assert.equal([reparentTarget.status, deleteSource.status].filter((status) => status === 200).length, 1);
    const tree = await harness.db.prepare(`WITH RECURSIVE reachable(id) AS (
      SELECT id FROM spaces WHERE parent_id IS NULL
      UNION SELECT child.id FROM spaces child JOIN reachable ON child.parent_id = reachable.id
    ) SELECT (SELECT COUNT(*) FROM spaces) AS total,
      (SELECT COUNT(*) FROM reachable) AS reachable`).first();
    assert.equal(tree.reachable, tree.total, "every surviving space must remain reachable from a root");
    const childRow = await harness.db.prepare("SELECT parent_id FROM spaces WHERE id = ?").bind(child).first();
    assert.equal(childRow?.parent_id, deleteSource.status === 200 ? target : source);
  } finally {
    await closeTestHarness(harness);
  }
});

test("a preexisting space cycle is audited and cannot loop an article list", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    await harness.db.prepare(`INSERT INTO spaces (id, name, slug, parent_id) VALUES
      (80003, 'Healthy root', 'healthy-root', NULL),
      (80004, 'Healthy child', 'healthy-child', 80003)`).run();
    const healthy = await jsonRequest(harness, "/api/spaces?q=Healthy%20child", { cookie });
    assert.equal(healthy.status, 200, await healthy.clone().text());
    assert.deepEqual((await healthy.json()).spaces[0].path.map((part) => part.name),
      ["Healthy root", "Healthy child"]);
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, category_id, space_id) VALUES
      ('healthy-article', 'Healthy article', 'healthy-article', 1, 80004)`).run();

    await harness.db.prepare(`INSERT INTO spaces (id, name, slug, parent_id) VALUES
      (80001, 'Cycle A', 'cycle-a', 80002), (80002, 'Cycle B', 'cycle-b', 80001)`).run();
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, category_id, space_id) VALUES
      ('cycle-article', 'Cycle article', 'cycle-article', 1, 80001)`).run();
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, category_id, space_id) VALUES
      ('orphan-article', 'Orphan article', 'orphan-article', 1, 89999)`).run();

    const auditSql = readFileSync(new URL("../../drizzle/verify-core-relations.sql", import.meta.url), "utf8");
    const audit = await harness.db.prepare(auditSql).first();
    assert.equal(audit.spaces_unreachable_from_root, 2);
    assert.equal(audit.posts_missing_space, 1);

    const response = await jsonRequest(harness, "/api/spaces/80001/posts?scope=descendants", { cookie });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].spacePath, "层级异常");

    const adminList = await jsonRequest(harness, "/api/posts?scope=private", { cookie });
    assert.equal(adminList.status, 200, await adminList.clone().text());
    const adminRows = (await adminList.json()).rows;
    assert.equal(adminRows.find((row) => row.publicId === "healthy-article")?.spacePath,
      "Healthy root / Healthy child");
    assert.equal(adminRows.find((row) => row.publicId === "cycle-article")?.spacePath,
      "层级异常");
    assert.equal(adminRows.find((row) => row.publicId === "orphan-article")?.spacePath,
      "层级异常");
    const reader = await jsonRequest(harness, "/api/reader/cycle-article?scope=admin", { cookie });
    assert.equal(reader.status, 200, await reader.clone().text());
    assert.equal((await reader.json()).post.spacePath, "层级异常");
    const orphanReader = await jsonRequest(harness, "/api/reader/orphan-article?scope=admin", { cookie });
    assert.equal(orphanReader.status, 200, await orphanReader.clone().text());
    assert.equal((await orphanReader.json()).post.spacePath, "层级异常");

    const deleteCycle = await jsonRequest(harness, "/api/spaces/80001", {
      method: "DELETE", cookie, body: { mode: "recursive", confirmName: "Cycle A" },
    });
    assert.equal(deleteCycle.status, 409, "a damaged hierarchy must not be recursively deleted");
    const retained = await harness.db.prepare(`SELECT
      (SELECT COUNT(*) FROM spaces WHERE id IN (80001,80002)) AS spaces,
      (SELECT COUNT(*) FROM posts WHERE public_id='cycle-article') AS posts`).first();
    assert.deepEqual(retained, { spaces: 2, posts: 1 });

    await harness.db.prepare(`INSERT INTO spaces (id, name, slug, parent_id)
      VALUES (80005, 'Orphan space', 'orphan-space', 89998)`).run();
    const deleteOrphan = await jsonRequest(harness, "/api/spaces/80005", {
      method: "DELETE", cookie, body: { mode: "recursive", confirmName: "Orphan space" },
    });
    assert.equal(deleteOrphan.status, 409);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE id=80005").first()).count, 1);
  } finally {
    await closeTestHarness(harness);
  }
});

test("a stale editor cannot overwrite a newer article or bind its attachments", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("optimistic-contract", "initial"),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();
    assert.equal(post.version, 1, "new articles start at version 1");

    const first = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("optimistic-contract", "first writer"), version: post.version },
    });
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json();
    assert.equal(firstBody.post.version, 2);

    await harness.db.prepare(`INSERT INTO attachments
      (public_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, 'stale-object', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(attachmentId).run();
    const stale = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("stale-slug", markdown), version: post.version },
    });
    assert.equal(stale.status, 409, "the stale editor must receive a conflict");
    const persisted = await harness.db.prepare("SELECT slug, content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, { slug: "optimistic-contract", content: "first writer", version: 2 });
    const staleAttachment = await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(attachmentId).first();
    assert.equal(staleAttachment?.post_id, null, "the stale write must not bind attachments");
    const history = await harness.db.prepare("SELECT COUNT(*) AS count FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).first();
    assert.equal(history?.count, 0, "the stale write must not create slug history");
  } finally {
    await closeTestHarness(harness);
  }
});

test("two simultaneous edits from the same version accept exactly one writer", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("concurrent-original", "initial"),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();

    const [left, right] = await Promise.all([
      jsonRequest(harness, `/api/posts/${post.id}`, {
        method: "PATCH", cookie,
        body: { ...payload("concurrent-left", "left body"), version: post.version },
      }),
      jsonRequest(harness, `/api/posts/${post.id}`, {
        method: "PATCH", cookie,
        body: { ...payload("concurrent-right", "right body"), version: post.version },
      }),
    ]);
    assert.deepEqual([left.status, right.status].sort(), [200, 409],
      `one edit must win and the other must conflict: ${left.status}, ${right.status}`);
    const persisted = await harness.db.prepare("SELECT slug, content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    const winner = left.status === 200
      ? { slug: "concurrent-left", content: "left body" }
      : { slug: "concurrent-right", content: "right body" };
    assert.deepEqual(persisted, { ...winner, version: post.version + 1 });
    const history = await harness.db.prepare("SELECT slug FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).all();
    assert.deepEqual(history.results, [{ slug: "concurrent-original" }],
      "the rejected concurrent edit must not leave an extra slug-history row");
  } finally {
    await closeTestHarness(harness);
  }
});

test("a current slug cannot claim another article's historical address", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const original = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("reserved-old-address", "original"),
    });
    const other = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("other-current-address", "other"),
    });
    assert.equal(original.status, 201);
    assert.equal(other.status, 201);
    const originalPost = (await original.json()).post;
    const otherPost = (await other.json()).post;
    const renamed = await jsonRequest(harness, `/api/posts/${originalPost.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("renamed-current-address", "original"), version: originalPost.version },
    });
    assert.equal(renamed.status, 200);
    await assert.rejects(harness.db.prepare("UPDATE posts SET slug = ? WHERE id = ?")
      .bind("reserved-old-address", otherPost.id).run(),
    "the database must reject claiming an address reserved in another article's history");
    await assert.rejects(harness.db.prepare("INSERT INTO post_slug_history (post_id, slug) VALUES (?, ?)")
      .bind(otherPost.id, "renamed-current-address").run(),
    "the database must reject a historical address that shadows another current article");
    const unchangedOther = await harness.db.prepare("SELECT slug FROM posts WHERE id = ?")
      .bind(otherPost.id).first();
    assert.equal(unchangedOther?.slug, "other-current-address");
    const reclaimed = await jsonRequest(harness, `/api/posts/${originalPost.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("reserved-old-address", "original"), version: 2 },
    });
    assert.equal(reclaimed.status, 200, "a post may reclaim its own historical address");
    const restored = await harness.db.prepare("SELECT slug, version FROM posts WHERE id = ?")
      .bind(originalPost.id).first();
    assert.deepEqual(restored, { slug: "reserved-old-address", version: 3 });
  } finally {
    await closeTestHarness(harness);
  }
});

test("a simultaneous edit and delete cannot both consume the same version", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("edit-delete-original", "initial"),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();
    await harness.db.prepare(`INSERT INTO attachments
      (public_id, post_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, ?, 'edit-delete-object', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(attachmentId, post.id).run();

    const [edit, remove] = await Promise.all([
      jsonRequest(harness, `/api/posts/${post.id}`, {
        method: "PATCH", cookie,
        body: { ...payload("edit-delete-updated", "new body"), version: post.version },
      }),
      jsonRequest(harness, `/api/posts/${post.id}`, {
        method: "DELETE", cookie, body: { version: post.version },
      }),
    ]);
    assert.ok(
      (edit.status === 200 && remove.status === 409)
        || (remove.status === 200 && [404, 409].includes(edit.status)),
      `editing and deleting the same version cannot both succeed: ${edit.status}, ${remove.status}`,
    );
    const persisted = await harness.db.prepare("SELECT slug, content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    const history = await harness.db.prepare("SELECT slug FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).all();
    const attachment = await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(attachmentId).first();
    if (edit.status === 200) {
      assert.deepEqual(persisted, { slug: "edit-delete-updated", content: "new body", version: 2 });
      assert.deepEqual(history.results, [{ slug: "edit-delete-original" }]);
      assert.equal(attachment?.post_id, post.id);
    } else {
      assert.equal(persisted, null);
      assert.deepEqual(history.results, []);
      assert.equal(attachment?.post_id, null, "a deleted article's attachment must remain private");
    }
  } finally {
    await closeTestHarness(harness);
  }
});

test("delete rejects a stale list version and rolls back every dependent change on failure", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("delete-version-original", "keep this body"),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();
    const edited = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("delete-version-current", "keep this body"), version: post.version },
    });
    assert.equal(edited.status, 200);
    const listed = await jsonRequest(harness, "/api/posts?q=delete-version-current", { cookie });
    assert.equal(listed.status, 200);
    const listBody = await listed.json();
    assert.equal(listBody.rows?.find((row) => row.id === post.id)?.version, 2,
      "the admin list must expose the version used by its delete action");
    await harness.db.prepare(`INSERT INTO attachments
      (public_id, post_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, ?, 'delete-test-object', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(attachmentId, post.id).run();

    const stale = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "DELETE", cookie, body: { version: post.version },
    });
    assert.equal(stale.status, 409);
    assert.equal(await countPostsBySlug(harness.db, "delete-version-current"), 1);
    const historyBefore = await harness.db.prepare("SELECT slug FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).first();
    assert.equal(historyBefore?.slug, "delete-version-original");

    await harness.db.prepare(`CREATE TRIGGER fail_post_delete BEFORE DELETE ON posts
      BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END`).run();
    const failed = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "DELETE", cookie, body: { version: 2 },
    });
    assert.notEqual(failed.status, 200);
    assert.equal(await countPostsBySlug(harness.db, "delete-version-current"), 1);
    const historyAfterFailure = await harness.db.prepare("SELECT slug FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).first();
    assert.equal(historyAfterFailure?.slug, "delete-version-original", "failed delete must keep slug history");
    await harness.db.prepare("DROP TRIGGER fail_post_delete").run();

    const deleted = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "DELETE", cookie, body: { version: 2 },
    });
    assert.equal(deleted.status, 200, await deleted.clone().text());
    assert.equal(await countPostsBySlug(harness.db, "delete-version-current"), 0);
    const historyAfterDelete = await harness.db.prepare("SELECT COUNT(*) AS count FROM post_slug_history WHERE post_id = ?")
      .bind(post.id).first();
    assert.equal(historyAfterDelete?.count, 0);
    const detached = await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(attachmentId).first();
    assert.equal(detached?.post_id, null, "deleted article attachments remain private and recoverable");
  } finally {
    await closeTestHarness(harness);
  }
});

test("deleting a linked attachment updates the article version atomically", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    await harness.db.prepare(`INSERT INTO attachments
      (public_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, 'attachment-delete-object', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(attachmentId).run();
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("attachment-delete-version", markdown),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();

    const missingVersion = await jsonRequest(harness, `/api/attachments/${attachmentId}`, {
      method: "DELETE", cookie,
    });
    assert.equal(missingVersion.status, 409, "a linked attachment cannot alter article content without its version");
    let persisted = await harness.db.prepare("SELECT content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, { content: markdown, version: 1 });

    await harness.db.prepare(`CREATE TRIGGER fail_post_content_update BEFORE UPDATE OF content ON posts
      BEGIN SELECT RAISE(ABORT, 'injected content update failure'); END`).run();
    const failed = await jsonRequest(harness, `/api/attachments/${attachmentId}`, {
      method: "DELETE", cookie, body: { version: post.version },
    });
    assert.notEqual(failed.status, 200);
    const retained = await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(attachmentId).first();
    assert.equal(retained?.post_id, post.id, "failed article update must roll back attachment deletion");
    await harness.db.prepare("DROP TRIGGER fail_post_content_update").run();

    const deleted = await jsonRequest(harness, `/api/attachments/${attachmentId}`, {
      method: "DELETE", cookie, body: { version: post.version },
    });
    assert.equal(deleted.status, 200, await deleted.clone().text());
    const deletionBody = await deleted.json();
    assert.equal(deletionBody.version, 2);
    persisted = await harness.db.prepare("SELECT content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, { content: "", version: 2 });
    const removed = await harness.db.prepare("SELECT id FROM attachments WHERE public_id = ?")
      .bind(attachmentId).first();
    assert.equal(removed, null);

    const staleSave = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("attachment-delete-version", markdown), version: post.version },
    });
    assert.equal(staleSave.status, 409, "an old editor must not resurrect the deleted attachment link");
  } finally {
    await closeTestHarness(harness);
  }
});

test("moving a knowledge space invalidates article editors opened before the move", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const source = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie,
      body: { name: "Source Space", slug: "move-version-source", parentId: null, sortOrder: 0 },
    });
    const target = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie,
      body: { name: "Target Space", slug: "move-version-target", parentId: null, sortOrder: 0 },
    });
    assert.equal(source.status, 201);
    assert.equal(target.status, 201);
    const sourceId = (await source.json()).space.id;
    const targetId = (await target.json()).space.id;
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie,
      body: { ...payload("space-move-version", "original"), spaceId: sourceId },
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();

    const moved = await jsonRequest(harness, `/api/spaces/${sourceId}`, {
      method: "DELETE", cookie,
      body: { mode: "move", moveTo: targetId },
    });
    assert.equal(moved.status, 200, await moved.clone().text());
    const afterMove = await harness.db.prepare("SELECT space_id, content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(afterMove, { space_id: targetId, content: "original", version: 2 });

    const stale = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("space-move-version", "stale content"), spaceId: targetId, version: 1 },
    });
    assert.equal(stale.status, 409);
    const persisted = await harness.db.prepare("SELECT space_id, content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, afterMove);
  } finally {
    await closeTestHarness(harness);
  }
});

test("recursive space deletion detaches descendant attachments atomically", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const root = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "Archive Root", slug: "archive-root" },
    });
    assert.equal(root.status, 201);
    const rootId = (await root.json()).space.id;
    const child = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie, body: { name: "Archive Child", slug: "archive-child", parentId: rootId },
    });
    assert.equal(child.status, 201);
    const childId = (await child.json()).space.id;
    await harness.db.prepare(`INSERT INTO attachments
      (public_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, 'recursive-space-object', 'example.md', 'text/markdown', 1, 'contract')`)
      .bind(attachmentId).run();
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: { ...payload("recursive-space-article", markdown), spaceId: childId },
    });
    assert.equal(created.status, 201, await created.clone().text());
    const { post } = await created.json();

    await harness.db.prepare(`CREATE TRIGGER fail_recursive_post_delete BEFORE DELETE ON posts
      BEGIN SELECT RAISE(ABORT, 'injected recursive delete failure'); END`).run();
    const failed = await jsonRequest(harness, `/api/spaces/${rootId}`, {
      method: "DELETE", cookie, body: { mode: "recursive", confirmName: "Archive Root" },
    });
    assert.equal(failed.status, 500);
    assert.equal((await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(attachmentId).first())?.post_id, post.id,
      "failed deletion must preserve the attachment binding");
    assert.equal((await harness.db.prepare("SELECT id FROM posts WHERE id = ?")
      .bind(post.id).first())?.id, post.id);

    await harness.db.prepare("DROP TRIGGER fail_recursive_post_delete").run();
    const deleted = await jsonRequest(harness, `/api/spaces/${rootId}`, {
      method: "DELETE", cookie, body: { mode: "recursive", confirmName: "Archive Root" },
    });
    assert.equal(deleted.status, 200, await deleted.clone().text());
    assert.equal((await harness.db.prepare("SELECT id FROM posts WHERE id = ?")
      .bind(post.id).first()), null);
    assert.equal((await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(attachmentId).first())?.post_id, null,
      "deleted articles must leave attachments private and recoverable");
  } finally {
    await closeTestHarness(harness);
  }
});

test("a malformed attachment post ID cannot silently create an unlinked file", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const boundary = "----XingyuAttachmentContract";
    const form = [
      `--${boundary}\r\nContent-Disposition: form-data; name="postId"\r\n\r\nnot-a-post\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="example.md"\r\nContent-Type: text/markdown\r\n\r\ntest\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const response = await harness.dispatch("/api/attachments", {
      method: "POST", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, body: form,
    });
    assert.equal(response.status, 400, await response.clone().text());
    const count = await harness.db.prepare("SELECT count(*) AS total FROM attachments").first();
    assert.equal(count?.total, 0, "invalid article identity must not create an orphan attachment");
  } finally {
    await closeTestHarness(harness);
  }
});

test("admin-only attachment inventory locates R2 objects missing D1 records", async () => {
  const harness = await openTestHarness();
  try {
    const url = "/api/attachments?mode=orphan-candidates";
    const anonymous = await harness.dispatch(url);
    assert.notEqual(anonymous.status, 200, "orphan object keys must never be exposed anonymously");
    const cookie = await loginAdmin(harness);
    const orphanId = "att_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const orphanKey = `attachments/2026/09/${orphanId}/orphan.txt`;
    const linkedId = "att_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const linkedKey = `attachments/2026/09/${linkedId}/linked.txt`;
    await Promise.all([
      harness.env.MEDIA.put(orphanKey, "unlinked object"),
      harness.env.MEDIA.put(linkedKey, "linked object"),
    ]);
    await harness.db.prepare(`INSERT INTO attachments
      (public_id, object_key, original_name, content_type, size, sha256)
      VALUES (?, ?, 'linked.txt', 'text/plain', 13, 'test')`).bind(linkedId, linkedKey).run();
    const response = await harness.dispatch(url, { headers: { cookie } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    const inventory = await response.json();
    assert.deepEqual(inventory.candidates.map((item) => item.objectKey), [orphanKey]);
    assert.equal(inventory.candidates[0].attachmentId, orphanId);
    assert.equal(inventory.nextCursor, null);
    assert.equal((await harness.env.MEDIA.head(orphanKey))?.key, orphanKey,
      "inventory must not silently delete a candidate");
    for (let offset = 1; offset <= 101; offset += 10) {
      await Promise.all(Array.from({ length: Math.min(10, 102 - offset) }, (_, index) => {
        const id = `att_${(offset + index).toString(16).padStart(32, "0")}`;
        return harness.env.MEDIA.put(`attachments/2026/09/${id}/candidate.txt`, "candidate");
      }));
    }
    const seen = new Set();
    let cursor = null;
    let pageCount = 0;
    do {
      const pageResponse = await harness.dispatch(`${url}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { headers: { cookie } });
      assert.equal(pageResponse.status, 200);
      const page = await pageResponse.json();
      for (const candidate of page.candidates) seen.add(candidate.objectKey);
      cursor = page.nextCursor;
      pageCount += 1;
      assert.ok(pageCount <= 4, "orphan inventory cursor must make progress");
    } while (cursor);
    assert.ok(pageCount >= 2, "the inventory must paginate rather than silently truncating results");
    assert.equal(seen.size, 102);
    assert.equal(seen.has(linkedKey), false);
  } finally {
    await closeTestHarness(harness);
  }
});

test("failed R2 rollback reports a recoverable attachment ID without hiding the failed object", async () => {
  const publicId = "att_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const objectKey = `attachments/2026/09/${publicId}/failed.md`;
  const objects = new Set([objectKey]);
  const originalError = new Error("D1 write failed");
  const events = [];
  const originalLogger = console.error;
  console.error = (message) => events.push(JSON.parse(message));
  try {
    await assert.rejects(
      cleanupFailedAttachmentUpload({ delete: async () => { throw new Error("R2 delete failed"); } },
        publicId, objectKey, originalError),
      (error) => error instanceof AttachmentCleanupRequiredError
        && error.publicId === publicId && error.objectKey === objectKey
        && error.cause === originalError && error.message.includes(publicId),
    );
  } finally {
    console.error = originalLogger;
  }
  assert.equal(objects.has(objectKey), true, "failed cleanup must leave the object for reconciliation");
  assert.deepEqual(events.map(({ event, publicId: id, objectKey: key }) => ({ event, id, key })), [{
    event: "attachment_object_cleanup_required", id: publicId, key: objectKey,
  }]);
  await cleanupFailedAttachmentUpload({ delete: async (key) => { objects.delete(key); } },
    publicId, objectKey, originalError);
  assert.equal(objects.has(objectKey), false, "exact-key manual retry can recover the object");
});

test("Worker upload reports an orphan when D1 write and R2 cleanup both fail", async () => {
  const harness = await openTestHarness({ r2DeleteFault: true });
  try {
    const cookie = await loginAdmin(harness);
    await harness.db.prepare(`CREATE TRIGGER reject_test_attachment_insert BEFORE INSERT ON attachments
      BEGIN SELECT RAISE(FAIL, 'injected attachment metadata failure'); END`).run();
    const boundary = "----XingyuR2CleanupFaultContract";
    const form = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.md"\r\nContent-Type: text/markdown\r\n\r\ntest\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const response = await harness.dispatch("/api/attachments", {
      method: "POST", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, body: form,
    });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.match(result.attachmentId, /^att_[a-f0-9]{32}$/,
      "the upload response must give the operator an exact reconciliation ID");
    assert.match(result.error, new RegExp(result.attachmentId));
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM attachments").first())?.count, 0,
      "the failed D1 write must leave no attachment row");

    const objects = (await harness.env.MEDIA.list({ prefix: "attachments/" })).objects;
    assert.equal(objects.length, 1, "failed cleanup must leave the object visible to reconciliation");
    assert.match(objects[0].key, new RegExp(`/${result.attachmentId}/`));
    const inventory = await harness.dispatch("/api/attachments?mode=orphan-candidates", { headers: { cookie } });
    assert.equal(inventory.status, 200, await inventory.clone().text());
    assert.deepEqual((await inventory.json()).candidates.map(({ objectKey }) => objectKey), [objects[0].key],
      "the admin inventory must locate the object without a D1 row");

    const queueRow = await harness.db.prepare(
      "SELECT public_id, object_key, operation, status, attempts, last_error FROM attachment_cleanup_queue WHERE object_key = ?",
    ).bind(objects[0].key).first();
    assert.ok(queueRow, "a failed R2 rollback must persist a durable cleanup queue entry");
    assert.equal(queueRow.public_id, result.attachmentId);
    assert.equal(queueRow.operation, "upload_rollback");
    assert.equal(queueRow.status, "pending");
    assert.ok(Number(queueRow.attempts) >= 1, "the queue entry must count the failed reconciliation attempt");
    assert.ok(queueRow.last_error, "the queue entry must record the cleanup error");

    const anonymousQueue = await harness.dispatch("/api/attachments?mode=cleanup-queue");
    assert.equal(anonymousQueue.status, 401, "the cleanup queue must stay admin-only");

    const queueList = await harness.dispatch("/api/attachments?mode=cleanup-queue", { headers: { cookie } });
    assert.equal(queueList.status, 200, await queueList.clone().text());
    const queueItems = (await queueList.json()).items;
    assert.ok(queueItems.some(({ objectKey }) => objectKey === objects[0].key),
      "the admin queue must list the pending cleanup");

    const resolveWhileStored = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ objectKey: objects[0].key }),
    });
    assert.equal(resolveWhileStored.status, 409,
      `resolve must refuse while the object still exists: ${await resolveWhileStored.clone().text()}`);

    const anonymousResolve = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectKey: objects[0].key }),
    });
    assert.equal(anonymousResolve.status, 401, "resolve must stay admin-only");

    await harness.env.MEDIA.delete(objects[0].key);
    assert.equal(await harness.env.MEDIA.head(objects[0].key), null,
      "an exact-key retry can clean up the failed object");
  } finally {
    await closeTestHarness(harness);
  }
});

test("attachment metadata storage failure is unavailable, not a user conflict", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    await harness.db.prepare(`CREATE TRIGGER reject_test_attachment_insert BEFORE INSERT ON attachments
      BEGIN SELECT RAISE(FAIL, 'injected attachment metadata failure'); END`).run();
    const boundary = "----XingyuAttachmentStorageContract";
    const form = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.md"\r\nContent-Type: text/markdown\r\n\r\ntest\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const response = await harness.dispatch("/api/attachments", {
      method: "POST", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, body: form,
    });
    assert.equal(response.status, 503, "a D1 storage failure must not masquerade as a 409 conflict");
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM attachments").first())?.count, 0);
    assert.equal((await harness.env.MEDIA.list({ prefix: "attachments/" })).objects.length, 0,
      "a failed metadata write must clean up its newly uploaded object");
  } finally {
    await closeTestHarness(harness);
  }
});

test("attachment upload and article deletion cannot leave a dangling post owner", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const boundary = "----XingyuAttachmentOwnerContract";
    const uploadForm = (postId) => [
      `--${boundary}\r\nContent-Disposition: form-data; name="postId"\r\n\r\n${postId}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.md"\r\nContent-Type: text/markdown\r\n\r\nattachment note\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const stableCreate = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("attachment-owner-stable", "normal upload"),
    });
    assert.equal(stableCreate.status, 201, await stableCreate.clone().text());
    const { post: stablePost } = await stableCreate.json();
    const stableUpload = await harness.dispatch("/api/attachments", {
      method: "POST", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, body: uploadForm(stablePost.id),
    });
    assert.equal(stableUpload.status, 201, await stableUpload.clone().text());
    const { id: stableAttachmentId } = await stableUpload.json();
    assert.equal((await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(stableAttachmentId).first())?.post_id, stablePost.id);
    for (let attempt = 0; attempt < 3; attempt++) {
      const created = await jsonRequest(harness, "/api/posts", {
        method: "POST", cookie, body: payload(`attachment-owner-${attempt}`, "before deletion"),
      });
      assert.equal(created.status, 201, await created.clone().text());
      const { post } = await created.json();
      const upload = harness.dispatch("/api/attachments", {
        method: "POST", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, body: uploadForm(post.id),
      });
      const deletion = jsonRequest(harness, `/api/posts/${post.id}`, {
        method: "DELETE", cookie, body: { version: post.version },
      });
      const [uploaded, deleted] = await Promise.all([upload, deletion]);
      assert.equal(deleted.status, 200, await deleted.clone().text());
      assert.ok([201, 404, 409].includes(uploaded.status), await uploaded.clone().text());
      const owner = await harness.db.prepare("SELECT COUNT(*) AS count FROM attachments WHERE post_id = ?")
        .bind(post.id).first();
      assert.equal(owner?.count, 0, "a deleted article cannot retain attachment ownership");
      if (uploaded.status === 201) {
        const { id } = await uploaded.json();
        const detached = await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
          .bind(id).first();
        assert.deepEqual(detached, { post_id: null }, "a successful upload before deletion must become private");
      }
    }
  } finally {
    await closeTestHarness(harness);
  }
});

test("MCP exposes article versions and rejects an explicitly stale update", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("mcp-version-contract", "initial"),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();
    const read = await callMcpTool(harness, {
      name: "get_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.publicId, view: "content" },
    });
    assert.equal(read.structuredContent?.post?.version, 1);

    const missingVersion = await callMcpTool(harness, {
      name: "update_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.publicId, content_markdown: "unsafe update" },
    });
    assert.equal(missingVersion.isError, true, "MCP must reject writes without a read version");
    const beforeVersionedWrite = await harness.db.prepare("SELECT content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(beforeVersionedWrite, { content: "initial", version: 1 });

    const changed = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("mcp-version-contract", "admin update"), version: post.version },
    });
    assert.equal(changed.status, 200);

    const stale = await callMcpTool(harness, {
      name: "update_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.publicId, expected_version: 1, content_markdown: "stale agent update" },
    });
    assert.equal(stale.isError, true);
    assert.match(stale.structuredContent?.error ?? "", /其他编辑者更新/);
    const persisted = await harness.db.prepare("SELECT content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, { content: "admin update", version: 2 });

    const fresh = await callMcpTool(harness, {
      name: "update_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.publicId, expected_version: 2, content_markdown: "agent update" },
    });
    assert.equal(fresh.isError, undefined, JSON.stringify(fresh.structuredContent));
    assert.equal(fresh.structuredContent?.post?.version, 3);
    const final = await harness.db.prepare("SELECT content, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(final, { content: "agent update", version: 3 });
  } finally {
    await closeTestHarness(harness);
  }
});

test("MCP publish and unpublish require the version the user confirmed", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("publish-version-contract", "draft to confirm"),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();

    const changed = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: { ...payload("publish-version-contract", "changed after confirmation"), version: 1 },
    });
    assert.equal(changed.status, 200);

    const stalePublish = await callMcpTool(harness, {
      name: "publish_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.publicId, expected_version: 1 },
    });
    assert.equal(stalePublish.isError, true);
    let persisted = await harness.db.prepare("SELECT status, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, { status: "draft", version: 2 });

    const published = await callMcpTool(harness, {
      name: "publish_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.publicId, expected_version: 2 },
    });
    assert.equal(published.isError, undefined, JSON.stringify(published.structuredContent));
    persisted = await harness.db.prepare("SELECT status, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, { status: "published", version: 3 });

    const staleUnpublish = await callMcpTool(harness, {
      name: "unpublish_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.publicId, expected_version: 2 },
    });
    assert.equal(staleUnpublish.isError, true);
    const withdrawn = await callMcpTool(harness, {
      name: "unpublish_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.publicId, expected_version: 3 },
    });
    assert.equal(withdrawn.isError, undefined, JSON.stringify(withdrawn.structuredContent));
    persisted = await harness.db.prepare("SELECT status, version FROM posts WHERE id = ?")
      .bind(post.id).first();
    assert.deepEqual(persisted, { status: "draft", version: 4 });
  } finally {
    await closeTestHarness(harness);
  }
});

test("MCP article and page writes roll back with failed audit receipts", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const draftResponse = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("mcp-audit-draft", "Original body"),
    });
    assert.equal(draftResponse.status, 201);
    const { post: draft } = await draftResponse.json();
    const publishedResponse = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie,
      body: { ...payload("mcp-audit-published", "Published body"), status: "published" },
    });
    assert.equal(publishedResponse.status, 201);
    const { post: published } = await publishedResponse.json();
    const before = await harness.db.prepare(
      "SELECT id, slug, content, status, version FROM posts WHERE id = ?",
    ).bind(draft.id).first();
    const beforePublished = await harness.db.prepare(
      "SELECT id, slug, content, status, version FROM posts WHERE id = ?",
    ).bind(published.id).first();
    const beforePage = await harness.db.prepare(
      "SELECT title, content, updated_at FROM content_pages WHERE slug = 'about'",
    ).first();
    const beforeCache = await harness.db.prepare(
      "SELECT revision FROM public_cache_state WHERE id = 1",
    ).first();
    await harness.db.prepare(`CREATE TRIGGER fail_mcp_article_audit BEFORE INSERT ON mcp_activity
      BEGIN SELECT RAISE(ABORT, 'injected MCP audit failure'); END`).run();

    for (const [name, arguments_] of [
      ["create_draft", { title: "Audit failure create", slug: "mcp-audit-create", content_markdown: "Body" }],
      ["update_post", { identifier: draft.publicId, expected_version: draft.version,
        slug: "mcp-audit-renamed", content_markdown: "Changed body" }],
      ["publish_post", { identifier: draft.publicId, expected_version: draft.version }],
      ["unpublish_post", { identifier: published.publicId, expected_version: published.version }],
    ]) {
      const result = await callMcpTool(harness, {
        name, token: TEST_LEGACY_MCP_TOKEN,
        arguments: { ...arguments_, change_summary: "Audit rollback contract" },
      });
      assert.equal(result.isError, true, `${name} must not report a successful write without audit`);
      assert.equal(result.structuredContent?.ok, false);
    }
    assert.equal(await countPostsBySlug(harness.db, "mcp-audit-create"), 0);
    assert.deepEqual(await harness.db.prepare(
      "SELECT id, slug, content, status, version FROM posts WHERE id = ?",
    ).bind(draft.id).first(), before);
    assert.deepEqual(await harness.db.prepare(
      "SELECT id, slug, content, status, version FROM posts WHERE id = ?",
    ).bind(published.id).first(), beforePublished);
    assert.equal((await harness.db.prepare(
      "SELECT COUNT(*) AS count FROM post_slug_history WHERE post_id = ?",
    ).bind(draft.id).first())?.count, 0);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM mcp_activity").first())?.count, 0);
    const pageResult = await callMcpTool(harness, {
      name: "update_page", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { slug: "about", title: "Changed about page", change_summary: "Audit rollback contract" },
    });
    assert.equal(pageResult.isError, true, "page writes must also fail when audit storage fails");
    assert.deepEqual(await harness.db.prepare(
      "SELECT title, content, updated_at FROM content_pages WHERE slug = 'about'",
    ).first(), beforePage);
    assert.deepEqual(await harness.db.prepare(
      "SELECT revision FROM public_cache_state WHERE id = 1",
    ).first(), beforeCache, "public cache revision must roll back with the content write");

    await harness.db.prepare("DROP TRIGGER fail_mcp_article_audit").run();
    const created = await callMcpTool(harness, {
      name: "create_draft", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { title: "Audit recovery", slug: "mcp-audit-recovery", change_summary: "Audit recovery" },
    });
    assert.equal(created.isError, undefined, JSON.stringify(created.structuredContent));
    const receiptId = created.structuredContent?.receipt?.activity_id;
    assert.ok(Number.isInteger(receiptId));
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM mcp_activity WHERE id = ?")
      .bind(receiptId).first())?.count, 1);
    const publicId = created.structuredContent.post.public_id;
    const updated = await callMcpTool(harness, {
      name: "update_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: publicId, expected_version: 1, content_markdown: "Recovered edit",
        change_summary: "Edit after audit recovers" },
    });
    assert.equal(updated.isError, undefined, JSON.stringify(updated.structuredContent));
    assert.ok(Number.isInteger(updated.structuredContent?.receipt?.activity_id));
    const publishedAfterRecovery = await callMcpTool(harness, {
      name: "publish_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: publicId, expected_version: 2, change_summary: "Publish after audit recovers" },
    });
    assert.equal(publishedAfterRecovery.isError, undefined, JSON.stringify(publishedAfterRecovery.structuredContent));
    assert.ok(Number.isInteger(publishedAfterRecovery.structuredContent?.receipt?.activity_id));
    const unpublishedAfterRecovery = await callMcpTool(harness, {
      name: "unpublish_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: publicId, expected_version: 3, change_summary: "Withdraw after audit recovers" },
    });
    assert.equal(unpublishedAfterRecovery.isError, undefined, JSON.stringify(unpublishedAfterRecovery.structuredContent));
    assert.ok(Number.isInteger(unpublishedAfterRecovery.structuredContent?.receipt?.activity_id));
    const pageAfterRecovery = await callMcpTool(harness, {
      name: "update_page", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { slug: "about", title: "Recovered about page", change_summary: "Page after audit recovers" },
    });
    assert.equal(pageAfterRecovery.isError, undefined, JSON.stringify(pageAfterRecovery.structuredContent));
    assert.ok(Number.isInteger(pageAfterRecovery.structuredContent?.receipt?.activity_id));
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM mcp_activity").first())?.count, 5);
  } finally {
    await closeTestHarness(harness);
  }
});

test("MCP attachment metadata and audit are atomic; unbound uploads also get receipts", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const createdResponse = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: payload("attachment-audit-owner", "Original body"),
    });
    assert.equal(createdResponse.status, 201);
    const { post } = await createdResponse.json();
    const upload = async (bound) => callMcpTool(harness, {
      name: "upload_attachment", token: TEST_LEGACY_MCP_TOKEN,
      arguments: {
        filename: "audit.txt", content_type: "text/plain",
        content_base64: Buffer.from("audit attachment").toString("base64"),
        ...(bound ? { post_identifier: post.publicId } : {}),
        change_summary: "Attachment audit contract",
      },
    });
    const beforeObjects = (await harness.env.MEDIA.list({ prefix: "attachments/" })).objects.length;
    await harness.db.prepare(`CREATE TRIGGER fail_mcp_attachment_audit BEFORE INSERT ON mcp_activity
      BEGIN SELECT RAISE(ABORT, 'injected attachment audit failure'); END`).run();
    for (const bound of [false, true]) {
      const result = await upload(bound);
      assert.equal(result.isError, true, "upload must fail if audit cannot persist");
      assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM attachments").first())?.count, 0);
      assert.equal((await harness.env.MEDIA.list({ prefix: "attachments/" })).objects.length,
        beforeObjects, "failed D1 write must clean up the new R2 object");
    }
    await harness.db.prepare("DROP TRIGGER fail_mcp_attachment_audit").run();
    for (const bound of [false, true]) {
      const result = await upload(bound);
      assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
      const receiptId = result.structuredContent?.receipt?.activity_id;
      assert.ok(Number.isInteger(receiptId));
      const activity = await harness.db.prepare(
        "SELECT public_id, post_id FROM mcp_activity WHERE id = ?",
      ).bind(receiptId).first();
      assert.equal(activity?.public_id,
        bound ? post.publicId : `attachment:${result.structuredContent.attachment.public_id}`);
      assert.equal(activity?.post_id, bound ? post.id : 0);
    }
  } finally {
    await closeTestHarness(harness);
  }
});

test("MCP space mutations and recursive deletion roll back when audit insertion fails", async () => {
  const harness = await openTestHarness();
  try {
    const create = async (name, parent) => {
      const result = await callMcpTool(harness, {
        name: "create_space", token: TEST_LEGACY_MCP_TOKEN,
        arguments: { name, ...(parent ? { parent: String(parent) } : {}), change_summary: `Create ${name}` },
      });
      assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
      return result.structuredContent.space.id;
    };
    const sourceId = await create("Audit source");
    const childId = await create("Audit child", sourceId);
    const targetId = await create("Audit target");
    const emptyId = await create("Audit empty");
    const cookie = await loginAdmin(harness);
    const articleResponse = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: { ...payload("space-audit-article", "Keep this body"), spaceId: sourceId },
    });
    assert.equal(articleResponse.status, 201);
    const { post: article } = await articleResponse.json();
    const original = await harness.db.prepare("SELECT space_id, version FROM posts WHERE id = ?")
      .bind(article.id).first();
    const auditBefore = (await harness.db.prepare("SELECT COUNT(*) AS count FROM mcp_activity").first())?.count;
    await harness.db.prepare(`CREATE TRIGGER fail_mcp_space_audit BEFORE INSERT ON mcp_activity
      BEGIN SELECT RAISE(ABORT, 'injected space audit failure'); END`).run();

    for (const [name, arguments_] of [
      ["create_space", { name: "Audit rejected" }],
      ["update_space", { space: String(sourceId), name: "Audit renamed" }],
      ["move_space", { space: String(sourceId), parent: String(targetId) }],
      ["delete_space", { space: String(emptyId), mode: "empty" }],
      ["delete_space", { space: String(sourceId), mode: "move", move_to: String(targetId) }],
      ["delete_space", { space: String(sourceId), mode: "recursive", confirm_name: "Audit source" }],
    ]) {
      const result = await callMcpTool(harness, {
        name, token: TEST_LEGACY_MCP_TOKEN,
        arguments: { ...arguments_, change_summary: "Audit rollback contract" },
      });
      assert.equal(result.isError, true, `${name} must fail when its receipt cannot persist`);
    }
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE name = 'Audit rejected'")
      .first())?.count, 0);
    assert.deepEqual(await harness.db.prepare("SELECT name, parent_id FROM spaces WHERE id = ?")
      .bind(sourceId).first(), { name: "Audit source", parent_id: null });
    assert.equal((await harness.db.prepare("SELECT parent_id FROM spaces WHERE id = ?")
      .bind(childId).first())?.parent_id, sourceId);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE id = ?")
      .bind(emptyId).first())?.count, 1);
    assert.deepEqual(await harness.db.prepare("SELECT space_id, version FROM posts WHERE id = ?")
      .bind(article.id).first(), original, "failed move/recursive delete must keep article ownership and version");
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM mcp_activity").first())?.count,
      auditBefore, "failed mutations must not leave audit rows");
    await harness.db.prepare("DROP TRIGGER fail_mcp_space_audit").run();
    const moved = await callMcpTool(harness, {
      name: "delete_space", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { space: String(sourceId), mode: "move", move_to: String(targetId),
        change_summary: "Move content after audit recovers" },
    });
    assert.equal(moved.isError, undefined, JSON.stringify(moved.structuredContent));
    assert.ok(Number.isInteger(moved.structuredContent?.receipt?.activity_id));
    assert.equal((await harness.db.prepare("SELECT parent_id FROM spaces WHERE id = ?")
      .bind(childId).first())?.parent_id, targetId);
    assert.equal((await harness.db.prepare("SELECT space_id FROM posts WHERE id = ?")
      .bind(article.id).first())?.space_id, targetId);
    const recursivelyDeleted = await callMcpTool(harness, {
      name: "delete_space", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { space: String(targetId), mode: "recursive", confirm_name: "Audit target",
        change_summary: "Delete subtree after audit recovers" },
    });
    assert.equal(recursivelyDeleted.isError, undefined, JSON.stringify(recursivelyDeleted.structuredContent));
    assert.ok(Number.isInteger(recursivelyDeleted.structuredContent?.receipt?.activity_id));
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM posts WHERE id = ?")
      .bind(article.id).first())?.count, 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("MCP space no-op updates leave the row and audit log unchanged", async () => {
  const harness = await openTestHarness();
  try {
    const created = await callMcpTool(harness, {
      name: "create_space", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { name: "No-op contract space", change_summary: "Create a test space" },
    });
    assert.equal(created.isError, undefined, JSON.stringify(created.structuredContent));
    const id = created.structuredContent?.space?.id;
    assert.ok(Number.isInteger(id));
    const before = await harness.db.prepare("SELECT name, parent_id, updated_at FROM spaces WHERE id = ?")
      .bind(id).first();
    const auditCount = async () => (await harness.db.prepare(
      "SELECT COUNT(*) AS count FROM mcp_activity WHERE public_id = ?",
    ).bind(`space:${id}`).first()).count;
    assert.equal(await auditCount(), 1);

    for (const [name, arguments_] of [
      ["update_space", { space: String(id), name: before.name, parent: null }],
      ["move_space", { space: String(id), parent: null }],
    ]) {
      const result = await callMcpTool(harness, {
        name, token: TEST_LEGACY_MCP_TOKEN,
        arguments: { ...arguments_, change_summary: "Repeat the current space state" },
      });
      assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
      assert.equal(result.structuredContent?.receipt?.activity_id, null,
        `${name} must not claim a persisted write receipt when nothing changed`);
    }
    assert.deepEqual(await harness.db.prepare(
      "SELECT name, parent_id, updated_at FROM spaces WHERE id = ?",
    ).bind(id).first(), before, "no-op tools must not touch the space row");
    assert.equal(await auditCount(), 1, "no-op tools must not add an audit row");

    const renamed = await callMcpTool(harness, {
      name: "update_space", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { space: String(id), name: "Renamed contract space", change_summary: "Rename the test space" },
    });
    assert.equal(renamed.isError, undefined, JSON.stringify(renamed.structuredContent));
    assert.ok(Number.isInteger(renamed.structuredContent?.receipt?.activity_id));
    assert.equal((await harness.db.prepare("SELECT name FROM spaces WHERE id = ?")
      .bind(id).first())?.name, "Renamed contract space");
    assert.equal(await auditCount(), 2, "a real rename must still be audited");

    const destination = await callMcpTool(harness, {
      name: "create_space", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { name: "Move destination", change_summary: "Create a destination" },
    });
    assert.equal(destination.isError, undefined, JSON.stringify(destination.structuredContent));
    const destinationId = destination.structuredContent?.space?.id;
    const moved = await callMcpTool(harness, {
      name: "move_space", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { space: String(id), parent: String(destinationId), change_summary: "Move the test space" },
    });
    assert.equal(moved.isError, undefined, JSON.stringify(moved.structuredContent));
    assert.ok(Number.isInteger(moved.structuredContent?.receipt?.activity_id));
    assert.equal((await harness.db.prepare("SELECT parent_id FROM spaces WHERE id = ?")
      .bind(id).first())?.parent_id, destinationId);
    assert.equal(await auditCount(), 3, "a real move must still be audited");
  } finally {
    await closeTestHarness(harness);
  }
});

test("deleting an attachment queues its R2 object when cleanup fails", async () => {
  const harness = await openTestHarness({ r2DeleteFault: true });
  try {
    const cookie = await loginAdmin(harness);
    const boundary = "----XingyuDeleteFaultContract";
    const form = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.md"\r\nContent-Type: text/markdown\r\n\r\ntest\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const upload = await harness.dispatch("/api/attachments", {
      method: "POST", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, body: form,
    });
    assert.equal(upload.status, 201, await upload.clone().text());
    const attachment = await upload.json();

    const remove = await harness.dispatch(`/api/attachments/${attachment.id}`, {
      method: "DELETE", headers: { cookie },
    });
    assert.equal(remove.status, 200, await remove.clone().text());
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM attachments").first())?.count, 0,
      "the D1 row must be gone even though the R2 object cleanup failed");

    const row = await harness.db.prepare(
      "SELECT public_id, object_key, operation, status FROM attachment_cleanup_queue WHERE public_id = ?",
    ).bind(attachment.id).first();
    assert.ok(row, "a failed R2 delete after commit must queue a durable cleanup entry");
    assert.equal(row.operation, "delete");
    assert.equal(row.status, "pending");
    assert.match(row.object_key, new RegExp(`/${attachment.id}/`));
    const objects = (await harness.env.MEDIA.list({ prefix: "attachments/" })).objects;
    assert.equal(objects.length, 1, "the committed delete must leave its object for exact-key reclaiming");
  } finally {
    await closeTestHarness(harness);
  }
});

test("queued cleanup resolves once the object is gone and validates its input", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const publicId = "att_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const objectKey = `attachments/2026/09/${publicId}/ghost.md`;
    await harness.db.prepare(
      "INSERT INTO attachment_cleanup_queue (public_id, object_key, operation) VALUES (?, ?, 'delete')",
    ).bind(publicId, objectKey).run();

    const anonymousQueue = await harness.dispatch("/api/attachments?mode=cleanup-queue");
    assert.equal(anonymousQueue.status, 401, "the cleanup queue must stay admin-only");
    const anonymousResolve = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectKey }),
    });
    assert.equal(anonymousResolve.status, 401, "resolve must stay admin-only");

    const invalidResolve = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ objectKey: "../../etc/passwd" }),
    });
    assert.equal(invalidResolve.status, 400, "resolve must validate the object key shape");

    const resolve = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ objectKey }),
    });
    assert.equal(resolve.status, 200, await resolve.clone().text());
    assert.deepEqual(await resolve.json(), { objectKey, operation: "delete", resolved: true });

    const row = await harness.db.prepare(
      "SELECT status FROM attachment_cleanup_queue WHERE object_key = ?",
    ).bind(objectKey).first();
    assert.equal(row?.status, "resolved");

    const again = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ objectKey }),
    });
    assert.equal(again.status, 409, "a second resolve must not claim a double recovery");

    const missing = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ objectKey: "attachments/2026/09/att_cccccccccccccccccccccccccccccccc/never.md" }),
    });
    assert.equal(missing.status, 404, "resolving an unknown object key must not fabricate a recovery");
  } finally {
    await closeTestHarness(harness);
  }
});

test("expired unbound attachments queue for recycling without deleting anything", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const daysAgo = (days) => {
      const date = new Date(Date.now() - days * 86400000);
      return date.toISOString().slice(0, 19).replace("T", " ");
    };
    const expiredId = "att_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const freshId = "att_ffffffffffffffffffffffffffffffff";
    const boundId = "att_11111111111111111111111111111111";
    const detachedId = "att_dddddddddddddddddddddddddddddddd";
    const expiredKey = `attachments/2026/07/${expiredId}/stale.md`;
    const rows = [
      // Unbound for 40 days: the only candidate.
      [expiredId, null, expiredKey, daysAgo(40), daysAgo(40)],
      // Unbound for 5 days: inside the retention window.
      [freshId, null, `attachments/2026/09/${freshId}/fresh.md`, daysAgo(5), daysAgo(5)],
      // Created 40 days ago but still bound to an article.
      [boundId, 1, `attachments/2026/07/${boundId}/bound.md`, daysAgo(40), null],
      // Detached yesterday from an old article: the unbound clock restarted.
      [detachedId, null, `attachments/2026/07/${detachedId}/detached.md`, daysAgo(60), daysAgo(1)],
    ];
    for (const [publicId, postId, objectKey, createdAt, unboundAt] of rows) {
      await harness.db.prepare(`INSERT INTO attachments
          (public_id, post_id, object_key, original_name, content_type, size, sha256, created_at, unbound_at)
          VALUES (?, ?, ?, 'note.md', 'text/markdown', 4, 'x', ?, ?)`)
        .bind(publicId, postId, objectKey, createdAt, unboundAt).run();
    }

    const enqueued = await enqueueExpiredUnboundAttachments(harness.db, 30);
    assert.equal(enqueued, 1, "only the long-unbound attachment may queue for recycling");
    const rows1 = await harness.db.prepare(
      "SELECT public_id, object_key, operation, status, attempts FROM attachment_cleanup_queue",
    ).all();
    assert.equal(rows1.results.length, 1);
    assert.deepEqual(rows1.results[0], {
      public_id: expiredId, object_key: expiredKey, operation: "expired_unbound", status: "pending", attempts: 1,
    });

    const secondScan = await enqueueExpiredUnboundAttachments(harness.db, 30);
    assert.equal(secondScan, 1, "the scan stays idempotent for already queued objects");
    const attempts = await harness.db.prepare(
      "SELECT attempts FROM attachment_cleanup_queue WHERE object_key = ?",
    ).bind(expiredKey).first();
    assert.equal(attempts?.attempts, 2, "repeated scans bump attempts without duplicating rows");

    await assert.rejects(enqueueExpiredUnboundAttachments(harness.db, 0),
      /Invalid unbound attachment retention/);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM attachments").first())?.c, 4,
      "the expiry scan must never delete attachment rows or R2 objects");

    const queueList = await harness.dispatch("/api/attachments?mode=cleanup-queue", { headers: { cookie } });
    assert.equal(queueList.status, 200);
    const items = (await queueList.json()).items;
    assert.ok(items.some(({ objectKey, operation }) => objectKey === expiredKey && operation === "expired_unbound"),
      "the admin queue must surface expired unbound attachments");

    await harness.db.prepare("UPDATE attachments SET post_id = 1 WHERE public_id = ?").bind(expiredId).run();
    const reboundResolve = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ objectKey: expiredKey }),
    });
    assert.equal(reboundResolve.status, 409, "a newly bound attachment must not be resolved as expired");
    assert.equal((await harness.db.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(expiredId).first())?.post_id, 1);
    await harness.db.prepare("UPDATE attachments SET post_id = NULL WHERE public_id = ?").bind(expiredId).run();

    const resolve = await harness.dispatch("/api/attachments", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ objectKey: expiredKey }),
    });
    assert.equal(resolve.status, 200, "the operator can resolve after reclaiming the object");
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM attachments WHERE public_id = ?")
      .bind(expiredId).first())?.c, 0, "resolved expiry must remove the unreachable attachment row");
    assert.equal(await enqueueExpiredUnboundAttachments(harness.db, 30), 0,
      "the next scan must not reopen a resolved cleanup item");
  } finally {
    await closeTestHarness(harness);
  }
});

test("post writes resolve attribution to the site owner and ignore client identity fields", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);

    // Admin create: all three columns resolve server-side to the owner (id 1),
    // even when the payload forges identity fields.
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie, body: {
        ...payload("attribution-owner", "owner body"),
        authorId: 9999, createdBy: 9999, updatedBy: 9999,
      },
    });
    assert.equal(created.status, 201, await created.clone().text());
    const post = (await created.json()).post;
    const createdRow = await harness.db.prepare(
      "SELECT author_id, created_by, updated_by, version FROM posts WHERE id = ?",
    ).bind(post.id).first();
    assert.deepEqual(createdRow, { author_id: 1, created_by: 1, updated_by: 1, version: 1 },
      "creation must attribute the owner and never accept a client-chosen author");

    // A stale update must not touch attribution or content.
    const stale = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie, body: { ...payload("attribution-owner", "race loser"), version: 99 },
    });
    assert.equal(stale.status, 409);
    const afterStale = await harness.db.prepare(
      "SELECT content, author_id, created_by, updated_by, version FROM posts WHERE id = ?",
    ).bind(post.id).first();
    assert.deepEqual(afterStale, { content: "owner body", author_id: 1, created_by: 1, updated_by: 1, version: 1 },
      "a rejected stale edit must leave attribution and content unchanged");

    // A clean admin edit only refreshes updated_by.
    const updated = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie, body: { ...payload("attribution-owner", "owner body v2"), version: 1 },
    });
    assert.equal(updated.status, 200, await updated.clone().text());
    const afterUpdate = await harness.db.prepare(
      "SELECT author_id, created_by, updated_by FROM posts WHERE id = ?",
    ).bind(post.id).first();
    assert.deepEqual(afterUpdate, { author_id: 1, created_by: 1, updated_by: 1 });

    // MCP drafts flow through the same owner resolution; the client label
    // stays in the audit stream instead of becoming an account.
    const mcpCreated = await callMcpTool(harness, {
      name: "create_draft", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { title: "MCP attribution", slug: "attribution-mcp", change_summary: "Attribution contract" },
    });
    assert.equal(mcpCreated.isError, undefined, JSON.stringify(mcpCreated.structuredContent));
    const mcpPost = await harness.db.prepare("SELECT id, author_id, created_by, updated_by FROM posts WHERE slug = ?")
      .bind("attribution-mcp").first();
    assert.deepEqual(mcpPost, { id: mcpPost?.id, author_id: 1, created_by: 1, updated_by: 1 },
      "MCP creates must attribute the owner, not the remote client");
    await jsonRequest(harness, `/api/posts/${mcpPost.id}`, { method: "DELETE", cookie, body: { version: 1 } });
    await jsonRequest(harness, `/api/posts/${post.id}`, { method: "DELETE", cookie, body: { version: 2 } });
  } finally {
    await closeTestHarness(harness);
  }
});

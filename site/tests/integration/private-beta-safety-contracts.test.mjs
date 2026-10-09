import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  callMcpTool,
  closeTestHarness,
  openTestHarness,
  withMcpClient,
  TEST_LEGACY_MCP_TOKEN,
} from "./harness.mjs";

async function createPrivateDraft(harness, suffix) {
  const spaceResult = await callMcpTool(harness, {
    name: "create_space",
    token: TEST_LEGACY_MCP_TOKEN,
    arguments: {
      name: `A5 Private ${suffix}`,
      change_summary: "A5 safety contract: create isolated private knowledge space",
    },
  });
  assert.equal(spaceResult.isError, undefined, JSON.stringify(spaceResult.structuredContent));
  const space = spaceResult.structuredContent?.space;
  assert.ok(space?.id, "create_space must return the persisted space id");
  assert.ok(spaceResult.structuredContent?.receipt?.activity_id,
    "create_space must emit a durable activity receipt");

  const draftResult = await callMcpTool(harness, {
    name: "create_draft",
    token: TEST_LEGACY_MCP_TOKEN,
    arguments: {
      title: `A5 Private Draft ${suffix}`,
      slug: `a5-private-${suffix}`,
      content_markdown: "# Private beta safety contract\n\nInitial private content.",
      space: String(space.id),
      change_summary: "A5 safety contract: create private knowledge draft",
    },
  });
  assert.equal(draftResult.isError, undefined, JSON.stringify(draftResult.structuredContent));
  const post = draftResult.structuredContent?.post;
  assert.ok(post?.public_id, "create_draft must return a stable public_id");
  assert.equal(post.status, "draft");
  assert.equal(post.visibility, "space");
  assert.equal(post.version, 1);
  assert.ok(draftResult.structuredContent?.receipt?.activity_id,
    "create_draft must emit a durable activity receipt");
  return { space, post };
}

async function assertAnonymousPrivate(harness, post, message) {
  const response = await harness.dispatch(`/posts/${post.public_id}/${post.slug}`);
  assert.equal(response.status, 404, message);
  const body = await response.text();
  assert.ok(!body.includes(post.title), "private public response must not leak the article title");
}

test("private MCP lifecycle stays private and optimistic write guards fail closed", async () => {
  const harness = await openTestHarness();
  try {
    const { post } = await createPrivateDraft(harness, "lifecycle");
    await assertAnonymousPrivate(harness, post,
      "a newly-created knowledge-space draft must not have a public article URL");

    const updated = await callMcpTool(harness, {
      name: "update_post",
      token: TEST_LEGACY_MCP_TOKEN,
      arguments: {
        identifier: post.public_id,
        expected_version: 1,
        content_markdown: "# Private beta safety contract\n\nUpdated private content.",
        change_summary: "A5 safety contract: update private draft",
      },
    });
    assert.equal(updated.isError, undefined, JSON.stringify(updated.structuredContent));
    assert.equal(updated.structuredContent?.post?.version, 2);
    assert.ok(updated.structuredContent?.receipt?.activity_id,
      "a successful private update must emit a durable activity receipt");

    const stale = await callMcpTool(harness, {
      name: "update_post",
      token: TEST_LEGACY_MCP_TOKEN,
      arguments: {
        identifier: post.public_id,
        expected_version: 1,
        content_markdown: "# stale overwrite attempt",
        change_summary: "A5 safety contract: stale update must fail",
      },
    });
    assert.equal(stale.isError, true, "a stale private write must be rejected");
    const afterStale = await harness.db.prepare(
      "SELECT content, status, version, space_id FROM posts WHERE public_id = ?",
    ).bind(post.public_id).first();
    assert.equal(afterStale?.content,
      "# Private beta safety contract\n\nUpdated private content.",
      "a stale write must not overwrite the accepted private content");
    assert.equal(afterStale?.version, 2, "a rejected stale write must not bump the version");
    assert.ok(afterStale?.space_id, "a rejected stale write must not move the post out of its private space");

    const published = await callMcpTool(harness, {
      name: "publish_post",
      token: TEST_LEGACY_MCP_TOKEN,
      arguments: {
        identifier: post.public_id,
        expected_version: 2,
        change_summary: "A5 safety contract: mark private knowledge complete",
      },
    });
    assert.equal(published.isError, undefined, JSON.stringify(published.structuredContent));
    assert.equal(published.structuredContent?.post?.status, "published");
    assert.equal(published.structuredContent?.post?.visibility, "space",
      "publishing a knowledge-space post must not convert it to public visibility");
    await assertAnonymousPrivate(harness, post,
      "a published knowledge-space post must remain absent from public reading");

    const afterPublish = await harness.db.prepare(
      "SELECT status, version, space_id FROM posts WHERE public_id = ?",
    ).bind(post.public_id).first();
    assert.deepEqual(afterPublish, { status: "published", version: 3, space_id: afterStale.space_id });

    const unpublished = await callMcpTool(harness, {
      name: "unpublish_post",
      token: TEST_LEGACY_MCP_TOKEN,
      arguments: {
        identifier: post.public_id,
        expected_version: 3,
        change_summary: "A5 safety contract: return private knowledge to draft",
      },
    });
    assert.equal(unpublished.isError, undefined, JSON.stringify(unpublished.structuredContent));
    const finalRow = await harness.db.prepare(
      "SELECT status, version, space_id FROM posts WHERE public_id = ?",
    ).bind(post.public_id).first();
    assert.deepEqual(finalRow, { status: "draft", version: 4, space_id: afterStale.space_id });
    await assertAnonymousPrivate(harness, post,
      "unpublishing private knowledge must not expose it publicly");

    const activity = await harness.db.prepare(`SELECT action, public_id, summary, client_label
      FROM mcp_activity WHERE public_id = ? ORDER BY id`).bind(post.public_id).all();
    assert.deepEqual((activity.results ?? []).map((row) => row.action),
      ["create_draft", "update_post", "publish_post", "unpublish_post"],
      "accepted writes must have an auditable action trail and rejected stale writes must not add a receipt");
    assert.ok(!JSON.stringify(activity.results ?? []).includes(TEST_LEGACY_MCP_TOKEN),
      "audit rows must never persist the raw MCP bearer token");
  } finally {
    await closeTestHarness(harness);
  }
});

test("recursive private-space deletion requires exact confirmation and rejection is atomic", async () => {
  const harness = await openTestHarness();
  try {
    const { space, post } = await createPrivateDraft(harness, "delete-guard");
    const rejected = await callMcpTool(harness, {
      name: "delete_space",
      token: TEST_LEGACY_MCP_TOKEN,
      arguments: {
        space: String(space.id),
        mode: "recursive",
        confirm_name: `${space.name}-wrong`,
        change_summary: "A5 safety contract: wrong destructive confirmation",
      },
    });
    assert.equal(rejected.isError, true, "recursive deletion with wrong confirmation must fail");

    const persistedSpace = await harness.db.prepare("SELECT id, name FROM spaces WHERE id = ?")
      .bind(space.id).first();
    assert.deepEqual(persistedSpace, { id: space.id, name: space.name },
      "a rejected destructive action must leave the private space intact");
    const persistedPost = await harness.db.prepare(
      "SELECT public_id, status, version, space_id FROM posts WHERE public_id = ?",
    ).bind(post.public_id).first();
    assert.deepEqual(persistedPost,
      { public_id: post.public_id, status: "draft", version: 1, space_id: space.id },
      "a rejected destructive action must leave contained private content intact");
    await assertAnonymousPrivate(harness, post,
      "a rejected destructive action must not change the private read boundary");
  } finally {
    await closeTestHarness(harness);
  }
});


test("MCP v1.1 four document blocks round-trip privately through the official client", async () => {
  const harness = await openTestHarness({ vars: { APP_ENV: "beta", INSTANCE_ID: "beta:document-integration" } });
  try {
    const guide = readFileSync(new URL("../../../docs/guides/ai-document-blocks-mcp.md", import.meta.url), "utf8");
    const samples = [...guide.matchAll(/```xingyu-block\r?\n([\s\S]*?)\r?\n```/g)].map((match) => match[1]);
    assert.equal(samples.length, 4);
    const types = samples.map((sample) => JSON.parse(sample).type);
    assert.deepEqual(types, ["quiz_result", "metric_grid", "status_list", "timeline"]);
    const content = "# MCP preserved document\n\nOriginal paragraph.\n\n" + samples.map((sample) => "```xingyu-block\n" + sample + "\n```").join("\n\n");
    await withMcpClient(harness, TEST_LEGACY_MCP_TOKEN, async (client) => {
      assert.equal(client.getServerVersion().version, "1.1.0");
      const instructions = client.getInstructions();
      for (const type of types) assert.ok(instructions.includes(type));
      assert.ok(instructions.includes("任务状态或事件日期"));
      assert.ok(instructions.includes("显式传入 space"));
      const tools = (await client.listTools()).tools;
      assert.ok(tools.find((tool) => tool.name === "create_draft").description.includes("xingyu-block"));
      assert.ok(tools.find((tool) => tool.name === "update_post").description.includes("xingyu-block"));
      const space = (await client.callTool({ name: "create_space", arguments: { name: "AI integration private", change_summary: "Create isolated QA space" } })).structuredContent.space;
      const created = await client.callTool({ name: "create_draft", arguments: { title: "AI block private QA", content_markdown: content, space: String(space.id), change_summary: "Save four factual guide samples" } });
      assert.notEqual(created.isError, true);
      const post = created.structuredContent.post;
      assert.equal(post.status, "draft");
      assert.equal(post.visibility, "space");
      const updatedContent = content + "\n\nExplicit additional paragraph.";
      const updated = await client.callTool({ name: "update_post", arguments: { identifier: post.public_id, expected_version: post.version, content_markdown: updatedContent, change_summary: "Append paragraph without losing blocks" } });
      assert.notEqual(updated.isError, true);
      const stored = await harness.db.prepare("SELECT content,status,space_id,version FROM posts WHERE public_id=?").bind(post.public_id).first();
      assert.equal(stored.content, updatedContent);
      assert.equal(stored.status, "draft");
      assert.equal(stored.space_id, space.id);
      assert.equal(stored.version, 2);
      await assertAnonymousPrivate(harness, post, "AI document blocks must not publish private knowledge");
    });
  } finally {
    await closeTestHarness(harness);
  }
});

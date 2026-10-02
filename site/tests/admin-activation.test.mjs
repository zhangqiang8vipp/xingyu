import assert from "node:assert/strict";
import test from "node:test";
import {
  activationFieldLabels,
  activityActorLabel,
  betaActivationStage,
  isKnowledgeSpacePost,
  isPrivateActivationWrite,
  privateWriteActionLabel,
} from "../domain/admin/activation.ts";

function knowledgeCount(posts) {
  return posts.filter(isKnowledgeSpacePost).length;
}

test("public/root published posts only keep activation at needs-knowledge", () => {
  const posts = [{ spaceId: null, status: "published" }];
  assert.equal(knowledgeCount(posts), 0);
  assert.equal(betaActivationStage({
    knowledgeCount: knowledgeCount(posts),
    connected: true,
    hasPrivateWrite: false,
  }), "needs-knowledge");
});

test("root draft only keeps activation at needs-knowledge", () => {
  const posts = [{ spaceId: null, status: "draft" }];
  assert.equal(knowledgeCount(posts), 0);
  assert.equal(betaActivationStage({
    knowledgeCount: knowledgeCount(posts),
    connected: true,
    hasPrivateWrite: false,
  }), "needs-knowledge");
});

test("root create_draft activity never qualifies as an activation write", () => {
  const qualifies = isPrivateActivationWrite({ action: "create_draft", spaceId: null });
  assert.equal(qualifies, false);
  assert.equal(betaActivationStage({
    knowledgeCount: 1,
    connected: true,
    hasPrivateWrite: qualifies,
  }), "connected-only");
});

test("root update_post activity never qualifies as an activation write", () => {
  const qualifies = isPrivateActivationWrite({ action: "update_post", spaceId: null });
  assert.equal(qualifies, false);
  assert.equal(betaActivationStage({
    knowledgeCount: 1,
    connected: true,
    hasPrivateWrite: qualifies,
  }), "connected-only");
});

test("Knowledge Space create qualifies as an activation write", () => {
  const qualifies = isPrivateActivationWrite({ action: "create_draft", spaceId: 8 });
  assert.equal(qualifies, true);
  assert.equal(betaActivationStage({
    knowledgeCount: 1,
    connected: true,
    hasPrivateWrite: qualifies,
  }), "activated");
});

test("Knowledge Space update qualifies regardless of post status", () => {
  const qualifies = isPrivateActivationWrite({ action: "update_post", spaceId: 8 });
  assert.equal(qualifies, true);
  assert.equal(isPrivateActivationWrite({ action: "publish_post", spaceId: 8 }), false);
});

test("connected-only remains distinct from activated", () => {
  assert.equal(betaActivationStage({ knowledgeCount: 1, connected: true, hasPrivateWrite: false }), "connected-only");
  assert.equal(betaActivationStage({ knowledgeCount: 1, connected: true, hasPrivateWrite: true }), "activated");
});

test("activation copy translates internal field names into user language", () => {
  assert.equal(privateWriteActionLabel("create_draft"), "创建了私有草稿");
  assert.equal(privateWriteActionLabel("update_post"), "更新了私有内容");
  assert.deepEqual(activationFieldLabels(["content_markdown", "space", "unknown_internal_field"]), ["正文", "知识空间", "其他内容"]);
});

test("activity actor identifies the exact OAuth connection session without exposing raw identifiers", () => {
  const connections = [{
    id: "chatgpt-client",
    name: "ChatGPT",
    kind: "oauth",
    sessions: [
      { subject: "named:work:one", label: "工作连接" },
      { subject: "named:personal:two", label: "个人连接" },
    ],
  }];
  assert.equal(activityActorLabel("oauth:chatgpt-client:named:work:one", connections), "ChatGPT · 工作连接");
  assert.equal(activityActorLabel("oauth:chatgpt-client", connections), "ChatGPT");
  assert.equal(activityActorLabel("oauth:unknown:anything", connections), "已连接的 AI");
});

test("database activation queries require Knowledge Space membership", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../db/activation.ts", import.meta.url), "utf8");
  assert.equal(
    (source.match(/isNotNull\(posts\.spaceId\)/g) ?? []).length,
    2,
    "knowledge prerequisite and activation activity query must both require space_id IS NOT NULL",
  );
  assert.match(source, /inArray\(mcpActivity\.action, \["create_draft", "update_post"\]\)/);
});

test("activation panel keeps Knowledge Space semantics user-facing", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../features/admin/AdminIntegrationsPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /知识空间里有真实知识/);
  assert.match(source, /保存到知识空间，作为草稿，不要发布/);
  assert.match(source, /最近一次知识空间写入/);
  assert.match(source, /普通公开博客文章不计入本次激活/);
  assert.match(source, /window\.location\.origin\}\/mcp/);
  assert.doesNotMatch(source, /先在“文章”或“知识空间”/);
  assert.doesNotMatch(source, />AI \/ MCP</);
  assert.doesNotMatch(source, /OAUTH 2\.1|LEGACY TOKEN|有效令牌|MCP_WRITE_TOKEN/);
});

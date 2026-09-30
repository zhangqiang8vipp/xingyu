import assert from "node:assert/strict";
import test from "node:test";
import {
  activationFieldLabels,
  betaActivationStage,
  isPrivateActivationWrite,
  privateWriteActionLabel,
} from "../domain/admin/activation.ts";

test("beta activation separates connected-only from a real private write", () => {
  assert.equal(betaActivationStage({ knowledgeCount: 0, connected: true, hasPrivateWrite: false }), "needs-knowledge");
  assert.equal(betaActivationStage({ knowledgeCount: 2, connected: false, hasPrivateWrite: false }), "needs-connection");
  assert.equal(betaActivationStage({ knowledgeCount: 2, connected: true, hasPrivateWrite: false }), "connected-only");
  assert.equal(betaActivationStage({ knowledgeCount: 2, connected: true, hasPrivateWrite: true }), "activated");
  assert.equal(betaActivationStage({ knowledgeCount: 2, connected: false, hasPrivateWrite: true }), "activated");
});

test("only draft creation or private updates count as the first real write", () => {
  assert.equal(isPrivateActivationWrite({ action: "create_draft", afterStatus: "draft", spaceId: null }), true);
  assert.equal(isPrivateActivationWrite({ action: "update_post", afterStatus: "draft", spaceId: null }), true);
  assert.equal(isPrivateActivationWrite({ action: "update_post", afterStatus: "published", spaceId: 8 }), true);
  assert.equal(isPrivateActivationWrite({ action: "update_post", afterStatus: "published", spaceId: null }), false);
  assert.equal(isPrivateActivationWrite({ action: "publish_post", afterStatus: "published", spaceId: null }), false);
});

test("activation copy translates internal field names into user language", () => {
  assert.equal(privateWriteActionLabel("create_draft"), "创建了私有草稿");
  assert.equal(privateWriteActionLabel("update_post"), "更新了私有内容");
  assert.deepEqual(activationFieldLabels(["content_markdown", "space", "unknown_internal_field"]), ["正文", "知识空间", "其他内容"]);
});

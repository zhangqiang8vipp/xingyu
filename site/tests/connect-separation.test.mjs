import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const file = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("public Connect is a marketing route and never uses live PAT or OAuth APIs", () => {
  const page = file("app/connect/page.tsx");
  assert.match(page, /xy-marketing-page/);
  assert.match(page, /connect-marketing\.css/);
  assert.match(page, /getContentPage\("connect"\)/);
  assert.match(page, /个人访问令牌/);
  assert.match(page, /OAuth 自动授权/);
  assert.match(page, /connect-hero-title/);
  assert.match(page, /AdminPreviewBridge kind="connect"/);
  assert.doesNotMatch(page, /ConnectExperience|PersonalTokensPanel|ConnectionsPanel/);
  assert.doesNotMatch(page, /\/api\/identity\/(?:tokens|connections)/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.equal(existsSync(new URL("../app/connect/ConnectExperience.tsx", import.meta.url)), false);
});

test("authenticated AI connections hosts real PAT + per-user OAuth management", () => {
  const page = file("app/ai-connections/page.tsx");
  const frame = file("features/admin/AdminAccountFrame.tsx");
  const sidebar = file("features/admin/AdminSidebar.tsx");
  const manager = file("features/admin/PersonalTokensPanel.tsx");
  const backend = file("app/api/identity/tokens/route.ts");
  const admin = file("features/admin/AdminIntegrationsPanel.tsx");
  assert.match(page, /currentIdentity\(\)/);
  assert.match(page, /redirect\("\/login\?return_to=%2Fai-connections"\)/);
  assert.match(page, /<PersonalTokensPanel/);
  assert.match(page, /<ConnectionsPanel/);
  assert.match(page, /<AdminAccountFrame area="ai-connections"/);
  assert.match(frame, /type AccountArea="workspace"\|"organizations"\|"ai-connections"/);
  assert.match(sidebar, /href:"\/ai-connections"/);
  assert.match(manager, /"never"/);
  assert.match(manager, /\/api\/identity\/tokens/);
  assert.match(manager, /复制完整 Token/);
  assert.match(backend, /identityFromRequest/);
  assert.match(backend, /sameOrigin/);
  assert.match(admin, /<PersonalTokensPanel/);
});

test("release default copy documents dual auth and never asks for shared static Token", () => {
  const config = file("domain/site/config.ts");
  const seed = file("drizzle/seed-app-defaults.sql");
  assert.match(config, /title: "把星屿，连接到你的 AI。"/);
  assert.match(config, /OAuth/);
  assert.match(seed, /PERSONAL/);
  assert.doesNotMatch(config, /MCP_WRITE_TOKEN/);
});

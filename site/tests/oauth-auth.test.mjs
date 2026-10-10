import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeBase64Url, s256Challenge, verifyS256 } from "../worker/oauth/pkce.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("PKCE S256 matches the authorization-code challenge", async () => {
  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const challenge = await s256Challenge(verifier);
  assert.equal(await verifyS256(verifier, challenge), true);
  assert.equal(await verifyS256(`${verifier}x`, challenge), false);
  assert.equal(normalizeBase64Url("ab+c/d=="), "ab-c_d");
});

test("OAuth tables and dual auth stay beside the existing MCP token", async () => {
  const [schema, bootstrap, worker, mcp, auth] = await Promise.all([
    source("db/schema.ts"),
    source("db/bootstrap.ts"),
    source("worker/index.ts"),
    source("worker/mcp/read-tools.ts"),
    source("worker/mcp-auth.ts"),
  ]);
  assert.match(schema, /oauthClients = sqliteTable\("oauth_clients"/);
  assert.match(schema, /oauthRefreshTokens = sqliteTable\("oauth_refresh_tokens"/);
  assert.match(bootstrap, /schemaVersion = "23"/);
  assert.match(bootstrap, /grok-xingyu/);
  assert.match(bootstrap, /chatgpt-xingyu/);
  assert.match(worker, /isOAuthPath/);
  assert.match(worker, /handleBlogMcpRequest/);
  assert.match(await source("worker/blog-mcp.ts"), /authenticateMcp/);
  assert.match(mcp, /requireScope\(auth, "xingyu.read"\)/);
  assert.match(await source("worker/mcp/draft-tools.ts"), /scopeForPostWrite\(current.status\)/);
  assert.match(auth, /xy_at_/);
  assert.doesNotMatch(mcp, /MCP 写作服务尚未配置/);
});

test("OAuth discovery and Grok public client follow the design contract", async () => {
  const [metadata, token, authorize, adminAuth] = await Promise.all([
    source("worker/oauth/metadata.ts"),
    source("worker/oauth/token.ts"),
    source("worker/oauth/authorize.ts"),
    source("server/auth/admin-auth.ts"),
  ]);
  assert.match(metadata, /oauth-protected-resource\/mcp/);
  assert.match(metadata, /code_challenge_methods_supported: \["S256"\]/);
  assert.match(metadata, /token_endpoint_auth_methods_supported: \["none"\]/);
  assert.match(token, /refresh_token/);
  assert.match(token, /oauth.refresh_reuse_detected/);
  assert.match(authorize, /registerRedirect/);
  assert.match(authorize, /readAuthorizeParams/);
  assert.match(authorize, /hiddenInputs\(checked.publicParams\)/);
  assert.match(adminAuth, /sameSite: "lax"/);
});

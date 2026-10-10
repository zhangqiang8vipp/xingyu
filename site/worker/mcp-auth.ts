import { env } from "cloudflare:workers";
import { activeSubject } from "@/server/auth/identity-session";
import { sha256Bytes, constantTimeBytesEqual } from "@/db/admin-session";
import { ALL_SCOPES, findAccessToken, hashSecret, mcpResourceFor, parseScopeList, touchAccessToken } from "@/db/oauth";
import { oauthLog } from "./oauth/errors";
import { findPersonalAccessToken, touchPersonalAccessToken } from "@/db/personal-access-tokens";
import { userSubject } from "@/server/auth/identity-session";
import { unauthorizedChallenge } from "./oauth/metadata";
import type { McpAuth } from "./mcp/scope-policy";

export { requireScope, ScopeError, scopeFailure, type McpAuth } from "./mcp/scope-policy";

export async function authenticateMcp(request: Request): Promise<McpAuth | Response> {
  const origin = new URL(request.url).origin;
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    oauthLog("mcp.auth.failed", { reason: "missing_bearer" });
    return unauthorizedChallenge(origin);
  }
  const bearer = match[1];
  const expected = env.MCP_WRITE_TOKEN;
  // Legacy bearer is never accepted by the multi-user production service.
  if (env.APP_ENV !== "production" && expected && await bearerMatches(bearer, expected)) {
    return {
      authType: "legacy",
      clientId: "legacy-chatgpt",
      subject: "xingyu-owner",
      scopes: [...ALL_SCOPES],
    };
  }
  if (/^xy_pat_[0-9a-f]{64}$/.test(bearer)) {
    const row = await findPersonalAccessToken(await hashSecret(bearer));
    const now = Math.floor(Date.now() / 1000);
    if (!row || row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= now)
      || row.resource !== mcpResourceFor(origin)) return unauthorizedChallenge(origin);
    const userId = await activeSubject(userSubject(row.userId));
    if (!userId) return unauthorizedChallenge(origin);
    return { authType: "pat", clientId: `pat:${row.id}`, subject: userSubject(userId),
      userId, scopes: parseScopeList(row.scope), patId: row.id };
  }
  if (bearer.startsWith("xy_at_")) {
    const row = await findAccessToken(await hashSecret(bearer));
    const now = Math.floor(Date.now() / 1000);
    if (!row || row.revokedAt || row.expiresAt <= now) {
      oauthLog("mcp.auth.failed", { reason: "oauth_expired_or_revoked" });
      return unauthorizedChallenge(origin);
    }
    if (row.resource !== mcpResourceFor(origin)) {
      oauthLog("mcp.auth.failed", { reason: "resource_mismatch", client_id: row.clientId });
      return unauthorizedChallenge(origin);
    }
    const userId = await activeSubject(row.subject);
    if (!userId) {
      // Historical single-owner subjects may run only in isolated development.
      if (env.APP_ENV !== "production" && row.subject === "xingyu-owner") {
        return {authType:"oauth",clientId:row.clientId,subject:row.subject,scopes:parseScopeList(row.scope),tokenId:row.id};
      }
      return unauthorizedChallenge(origin);
    }
    return {
      userId,
      authType: "oauth",
      clientId: row.clientId,
      subject: row.subject,
      scopes: parseScopeList(row.scope),
      tokenId: row.id,
    };
  }
  oauthLog("mcp.auth.failed", { reason: "invalid_token" });
  return unauthorizedChallenge(origin);
}

export async function rememberTokenUse(auth: McpAuth, ctx: ExecutionContext) {
  if (auth.tokenId) ctx.waitUntil(touchAccessToken(auth.tokenId));
  if (auth.patId) ctx.waitUntil(touchPersonalAccessToken(auth.patId));
}

async function bearerMatches(provided: string, expected: string) {
  const [left, right] = await Promise.all([sha256Bytes(provided), sha256Bytes(expected)]);
  return constantTimeBytesEqual(left, right);
}

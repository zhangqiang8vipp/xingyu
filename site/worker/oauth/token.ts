import { ensureDatabase } from "@/db/bootstrap";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  consumeAuthorizationCode,
  consumeRateLimit,
  findRefreshToken,
  getOAuthClient,
  hashSecret,
  insertAccessToken,
  insertRefreshToken,
  markRefreshTokenUsed,
  mcpResourceFor,
  REFRESH_TOKEN_MAX_TTL_SECONDS,
  revokeRefreshFamily,
} from "@/db/oauth";
import { refreshTokenDecision } from "../mcp/scope-policy";
import { OAuthError, oauthLog } from "./errors";
import { verifyS256 } from "./pkce";
import { newAccessToken, newFamilyId, newRefreshToken } from "./tokens";

export async function handleToken(request: Request) {
  if (request.method !== "POST") throw new OAuthError("invalid_request", 405, "只支持 POST");
  const url = new URL(request.url);
  await ensureDatabase();
  const limit = await consumeRateLimit(await hashSecret(`token:${request.headers.get("cf-connecting-ip") || "unknown"}`), 30, 60);
  if (!limit.allowed) throw new OAuthError("temporarily_unavailable", 429, "请求过于频繁", { "Retry-After": String(limit.retryAfter) });

  const params = new URLSearchParams(await request.text());
  const grantType = params.get("grant_type") ?? "";
  if (grantType === "authorization_code") return exchangeCode(url.origin, params);
  if (grantType === "refresh_token") return rotateRefresh(url.origin, params);
  throw new OAuthError("unsupported_grant_type", 400, "不支持的 grant_type");
}

async function exchangeCode(origin: string, params: URLSearchParams) {
  const clientId = params.get("client_id") ?? "";
  const code = params.get("code") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const verifier = params.get("code_verifier") ?? "";
  const resource = params.get("resource") || mcpResourceFor(origin);
  const client = await getOAuthClient(clientId);
  if (!client || !client.enabled || client.tokenEndpointAuthMethod !== "none") {
    throw new OAuthError("invalid_client", 401, "客户端无效");
  }
  if (resource !== mcpResourceFor(origin)) throw new OAuthError("invalid_target", 400, "resource 必须绑定 MCP 端点");
  if (!code.startsWith("xy_code_")) throw new OAuthError("invalid_grant", 400, "授权码无效");

  const consumed = await consumeAuthorizationCode(await hashSecret(code), clientId, redirectUri, resource);
  if (!consumed || consumed.reusedOrExpired) {
    oauthLog("oauth.code.rejected", { client_id: clientId, reason: consumed?.reusedOrExpired ? "used_or_expired" : "not_found" });
    throw new OAuthError("invalid_grant", 400, "授权码无效或已使用");
  }
  if (!(await verifyS256(verifier, consumed.code.codeChallenge))) {
    throw new OAuthError("invalid_grant", 400, "PKCE 校验失败");
  }

  const issued = await issueTokens({
    clientId,
    subject: consumed.code.subject,
    resource,
    scope: consumed.code.scope,
    familyId: consumed.code.scope.includes("offline_access") ? newFamilyId() : null,
    parentTokenId: null,
    absoluteExpiresAt: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_MAX_TTL_SECONDS,
  });
  oauthLog("oauth.token.issued", { client_id: clientId, grant: "authorization_code", scopes: consumed.code.scope });
  return tokenResponse(issued);
}

async function rotateRefresh(origin: string, params: URLSearchParams) {
  const clientId = params.get("client_id") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";
  const client = await getOAuthClient(clientId);
  if (!client || !client.enabled) throw new OAuthError("invalid_client", 401, "客户端无效");
  if (!refreshToken.startsWith("xy_rt_")) throw new OAuthError("invalid_grant", 400, "刷新令牌无效");

  const row = await findRefreshToken(await hashSecret(refreshToken));
  const now = Math.floor(Date.now() / 1000);
  const decision = refreshTokenDecision(row, clientId, now);
  if (decision === "invalid") throw new OAuthError("invalid_grant", 400, "刷新令牌无效");
  if (decision === "expired") throw new OAuthError("invalid_grant", 400, "刷新令牌已失效");
  if (decision === "reuse" || !(row && await markRefreshTokenUsed(row.id))) {
    if (row) await revokeRefreshFamily(row.familyId);
    oauthLog("oauth.refresh_reuse_detected", { client_id: clientId, family_id: row?.familyId });
    throw new OAuthError("invalid_grant", 400, "刷新令牌重复使用，已撤销该授权");
  }
  if (row.resource !== mcpResourceFor(origin)) throw new OAuthError("invalid_target", 400, "resource 必须绑定 MCP 端点");

  const issued = await issueTokens({
    clientId,
    subject: row.subject,
    resource: row.resource,
    scope: row.scope,
    familyId: row.familyId,
    parentTokenId: row.id,
    absoluteExpiresAt: row.absoluteExpiresAt,
  });
  oauthLog("oauth.token.refreshed", { client_id: clientId, family_id: row.familyId });
  return tokenResponse(issued);
}

async function issueTokens(input: {
  clientId: string;
  subject: string;
  resource: string;
  scope: string;
  familyId: string | null;
  parentTokenId: number | null;
  absoluteExpiresAt: number;
}) {
  const accessToken = newAccessToken();
  await insertAccessToken({
    tokenHash: await hashSecret(accessToken),
    clientId: input.clientId,
    subject: input.subject,
    resource: input.resource,
    scope: input.scope,
  });
  let refreshToken: string | undefined;
  if (input.familyId && input.scope.includes("offline_access")) {
    refreshToken = newRefreshToken();
    await insertRefreshToken({
      tokenHash: await hashSecret(refreshToken),
      familyId: input.familyId,
      parentTokenId: input.parentTokenId,
      clientId: input.clientId,
      subject: input.subject,
      resource: input.resource,
      scope: input.scope,
      absoluteExpiresAt: input.absoluteExpiresAt,
    });
  }
  return { accessToken, refreshToken, scope: input.scope };
}

function tokenResponse(issued: { accessToken: string; refreshToken?: string; scope: string }) {
  return Response.json({
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: issued.scope,
    ...(issued.refreshToken ? { refresh_token: issued.refreshToken } : {}),
  }, {
    headers: { "Cache-Control": "no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" },
  });
}

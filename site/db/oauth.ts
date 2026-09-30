import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./index";
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthClients,
  oauthConsents,
  oauthRateLimits,
  oauthRefreshTokens,
} from "./schema";
import { bytesToHex, sha256Bytes } from "./admin-session";

export { CHATGPT_CLIENT_ID, GROK_CLIENT_ID, isKnownChatGptRedirect, shouldAcceptRedirect } from "@/worker/oauth/redirect-policy";
export const OAUTH_SUBJECT = "xingyu-owner";
export const ALL_SCOPES = ["xingyu.read", "xingyu.draft", "xingyu.publish", "offline_access"] as const;
export const DEFAULT_GROK_SCOPES = ["xingyu.read", "xingyu.draft", "offline_access"] as const;
export const AUTH_CODE_TTL_SECONDS = 300;
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_IDLE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_TOKEN_MAX_TTL_SECONDS = 90 * 24 * 60 * 60;

export type OAuthScope = (typeof ALL_SCOPES)[number];

export async function hashSecret(value: string) {
  return bytesToHex(await sha256Bytes(value));
}

export function parseScopeList(value: string) {
  return [...new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))] as OAuthScope[];
}

export function scopeListText(scopes: string[]) {
  return scopes.join(" ");
}

export function parseRedirectUris(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function mcpResourceFor(origin: string) {
  return `${origin}/mcp`;
}

export async function getOAuthClient(clientId: string) {
  const [client] = await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  return client ?? null;
}

export async function saveClientRedirectUri(clientId: string, redirectUri: string) {
  const client = await getOAuthClient(clientId);
  if (!client) return;
  const uris = parseRedirectUris(client.redirectUris);
  if (uris.includes(redirectUri)) return;
  await getDb().update(oauthClients).set({
    redirectUris: JSON.stringify([...uris, redirectUri]),
    updatedAt: new Date().toISOString(),
  }).where(eq(oauthClients.clientId, clientId));
}

export async function insertAuthorizationCode(input: {
  codeHash: string;
  clientId: string;
  subject: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const [row] = await getDb().insert(oauthAuthorizationCodes).values({
    ...input,
    codeChallengeMethod: "S256",
    expiresAt: now + AUTH_CODE_TTL_SECONDS,
  }).returning({ id: oauthAuthorizationCodes.id });
  return row;
}

export async function consumeAuthorizationCode(codeHash: string, clientId: string, redirectUri: string, resource: string) {
  const now = Math.floor(Date.now() / 1000);
  const [code] = await getDb().select().from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, codeHash)).limit(1);
  if (!code || code.clientId !== clientId || code.redirectUri !== redirectUri || code.resource !== resource) return null;
  if (code.usedAt || code.expiresAt <= now) return { reusedOrExpired: true as const, code };
  const updated = await getDb().update(oauthAuthorizationCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthAuthorizationCodes.id, code.id), isNull(oauthAuthorizationCodes.usedAt)))
    .returning({ id: oauthAuthorizationCodes.id });
  if (!updated[0]) return { reusedOrExpired: true as const, code };
  return { reusedOrExpired: false as const, code };
}

export async function insertAccessToken(input: {
  tokenHash: string;
  clientId: string;
  subject: string;
  resource: string;
  scope: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const [row] = await getDb().insert(oauthAccessTokens).values({
    ...input,
    expiresAt: now + ACCESS_TOKEN_TTL_SECONDS,
  }).returning({ id: oauthAccessTokens.id, expiresAt: oauthAccessTokens.expiresAt });
  return row;
}

export async function insertRefreshToken(input: {
  tokenHash: string;
  familyId: string;
  parentTokenId?: number | null;
  clientId: string;
  subject: string;
  resource: string;
  scope: string;
  absoluteExpiresAt: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const [row] = await getDb().insert(oauthRefreshTokens).values({
    ...input,
    parentTokenId: input.parentTokenId ?? null,
    expiresAt: Math.min(now + REFRESH_TOKEN_IDLE_TTL_SECONDS, input.absoluteExpiresAt),
  }).returning({ id: oauthRefreshTokens.id });
  return row;
}

export async function findAccessToken(tokenHash: string) {
  const [row] = await getDb().select().from(oauthAccessTokens).where(eq(oauthAccessTokens.tokenHash, tokenHash)).limit(1);
  return row ?? null;
}

export async function touchAccessToken(id: number) {
  await getDb().update(oauthAccessTokens).set({ lastUsedAt: Math.floor(Date.now() / 1000) }).where(eq(oauthAccessTokens.id, id));
}

export async function findRefreshToken(tokenHash: string) {
  const [row] = await getDb().select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, tokenHash)).limit(1);
  return row ?? null;
}

export async function markRefreshTokenUsed(id: number) {
  const now = Math.floor(Date.now() / 1000);
  const updated = await getDb().update(oauthRefreshTokens)
    .set({ usedAt: now })
    .where(and(eq(oauthRefreshTokens.id, id), isNull(oauthRefreshTokens.usedAt), isNull(oauthRefreshTokens.revokedAt)))
    .returning({ id: oauthRefreshTokens.id });
  return Boolean(updated[0]);
}

export async function revokeRefreshFamily(familyId: string) {
  const now = Math.floor(Date.now() / 1000);
  await getDb().update(oauthRefreshTokens).set({ revokedAt: now })
    .where(and(eq(oauthRefreshTokens.familyId, familyId), isNull(oauthRefreshTokens.revokedAt)));
}

export async function revokeClientTokens(clientId: string, subject: string) {
  const now = Math.floor(Date.now() / 1000);
  await getDb().update(oauthAccessTokens).set({ revokedAt: now })
    .where(and(eq(oauthAccessTokens.clientId, clientId), eq(oauthAccessTokens.subject, subject), isNull(oauthAccessTokens.revokedAt)));
  await getDb().update(oauthRefreshTokens).set({ revokedAt: now })
    .where(and(eq(oauthRefreshTokens.clientId, clientId), eq(oauthRefreshTokens.subject, subject), isNull(oauthRefreshTokens.revokedAt)));
}

export async function upsertConsent(input: { subject: string; clientId: string; resource: string; grantedScopes: string }) {
  const now = Math.floor(Date.now() / 1000);
  await getDb().insert(oauthConsents).values({
    ...input,
    grantedAt: now,
    revokedAt: null,
  }).onConflictDoUpdate({
    target: [oauthConsents.subject, oauthConsents.clientId, oauthConsents.resource],
    set: { grantedScopes: input.grantedScopes, grantedAt: now, revokedAt: null },
  });
}

export async function revokeConsent(clientId: string, subject: string) {
  const now = Math.floor(Date.now() / 1000);
  await getDb().update(oauthConsents).set({ revokedAt: now })
    .where(and(eq(oauthConsents.clientId, clientId), eq(oauthConsents.subject, subject), isNull(oauthConsents.revokedAt)));
  await revokeClientTokens(clientId, subject);
}

export async function consumeRateLimit(identifier: string, limit: number, windowSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const [row] = await getDb().select().from(oauthRateLimits).where(eq(oauthRateLimits.identifier, identifier)).limit(1);
  if (!row || now - row.windowStarted >= windowSeconds) {
    await getDb().insert(oauthRateLimits).values({ identifier, attempts: 1, windowStarted: now, updatedAt: now })
      .onConflictDoUpdate({
        target: oauthRateLimits.identifier,
        set: { attempts: 1, windowStarted: now, updatedAt: now },
      });
    return { allowed: true, retryAfter: 0 };
  }
  if (row.attempts >= limit) {
    return { allowed: false, retryAfter: row.windowStarted + windowSeconds - now };
  }
  await getDb().update(oauthRateLimits).set({ attempts: row.attempts + 1, updatedAt: now })
    .where(eq(oauthRateLimits.identifier, identifier));
  return { allowed: true, retryAfter: 0 };
}

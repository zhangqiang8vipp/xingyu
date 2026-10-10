import { env } from "cloudflare:workers";
import { hashSecret, mcpResourceFor } from "./oauth";

/** PAT scopes exclude OAuth-only offline_access. */
export const PAT_SCOPES = ["xingyu.read", "xingyu.draft", "xingyu.publish"] as const;
export const PAT_LIFETIMES = [7, 30, 90, 180, 365, "never"] as const;
export const MAX_ACTIVE_PATS = 30;
export type PatScope = (typeof PAT_SCOPES)[number];
export type PatLifetime = (typeof PAT_LIFETIMES)[number];
export type PersonalAccessToken = {
  id: number; userId: number; name: string; tokenHash: string;
  tokenSuffix: string; resource: string; scope: string;
  expiresAt: number | null; revokedAt: number | null;
  lastUsedAt: number | null; createdAt: number;
};

export function parsePatScopes(input: unknown): PatScope[] | null {
  if (!Array.isArray(input) || input.length > PAT_SCOPES.length) return null;
  if (!input.every((s): s is PatScope =>
    typeof s === "string" && PAT_SCOPES.includes(s as PatScope))) return null;
  const scopes = [...new Set(input)];
  return scopes.includes("xingyu.read") ? scopes : null;
}

export function parsePatLifetime(input: unknown): PatLifetime | null {
  return PAT_LIFETIMES.some(value => value === input) ? input as PatLifetime : null;
}

function generatePat() {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  return "xy_pat_" + Array.from(entropy, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function listPersonalAccessTokens(userId: number) {
  const rows = await env.DB.prepare(
    "SELECT id,name,token_suffix AS tokenSuffix,scope,expires_at AS expiresAt," +
    "revoked_at AS revokedAt,last_used_at AS lastUsedAt,created_at AS createdAt " +
    "FROM personal_access_tokens WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100"
  ).bind(userId).all<Omit<PersonalAccessToken, "userId" | "tokenHash" | "resource">>();
  return rows.results ?? [];
}

/** Return raw secret only to the creation response. Never log or persist it. */
export async function createPersonalAccessToken(input: {
  userId: number; name: string; scopes: PatScope[];
  lifetime: PatLifetime; origin: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM personal_access_tokens " +
    "WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)"
  ).bind(input.userId, now).first<{ total: number }>();
  if (Number(count?.total ?? 0) >= MAX_ACTIVE_PATS) return null;
  const token = generatePat();
  const expiresAt = input.lifetime === "never" ? null : now + input.lifetime * 86400;
  const result = await env.DB.prepare(
    "INSERT INTO personal_access_tokens " +
    "(user_id,name,token_hash,token_suffix,resource,scope,expires_at,created_at) " +
    "VALUES (?,?,?,?,?,?,?,?) RETURNING id"
  ).bind(input.userId, input.name, await hashSecret(token), token.slice(-4),
    mcpResourceFor(input.origin), input.scopes.join(" "), expiresAt, now).first<{ id: number }>();
  if (!result) throw new Error("Unable to create personal access token");
  return { id: result.id, token, name: input.name, scopes: input.scopes, expiresAt };
}

export async function findPersonalAccessToken(hash: string) {
  return await env.DB.prepare(
    "SELECT id,user_id AS userId,name,token_hash AS tokenHash,token_suffix AS tokenSuffix," +
    "resource,scope,expires_at AS expiresAt,revoked_at AS revokedAt," +
    "last_used_at AS lastUsedAt,created_at AS createdAt " +
    "FROM personal_access_tokens WHERE token_hash=? LIMIT 1"
  ).bind(hash).first<PersonalAccessToken>();
}

export async function revokePersonalAccessToken(userId: number, id: number) {
  const result = await env.DB.prepare(
    "UPDATE personal_access_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL"
  ).bind(Math.floor(Date.now() / 1000), id, userId).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function touchPersonalAccessToken(id: number) {
  await env.DB.prepare(
    "UPDATE personal_access_tokens SET last_used_at=? WHERE id=? AND revoked_at IS NULL"
  ).bind(Math.floor(Date.now() / 1000), id).run();
}

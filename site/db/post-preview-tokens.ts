import { env } from "cloudflare:workers";
import { ensureDatabase } from "./bootstrap";

const TOKEN_PATTERN = /^pv_[A-Za-z0-9_-]{43}$/;
const MIN_LIFETIME_SECONDS = 15 * 60;
const MAX_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

export type PostPreviewLink = {
  id: number;
  expiresAt: number;
  createdAt: string;
  revokedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  active: boolean;
};

export async function createPostPreviewToken(postId: number, lifetimeSeconds: number) {
  await ensureDatabase();
  if (!Number.isInteger(postId) || postId < 1) throw new PreviewTokenError("文章不存在", 404);
  const post = await env.DB.prepare("SELECT id, public_id AS publicId, title FROM posts WHERE id = ?")
    .bind(postId).first<{ id: number; publicId: string; title: string }>();
  if (!post) throw new PreviewTokenError("文章不存在", 404);
  const lifetime = Math.min(MAX_LIFETIME_SECONDS, Math.max(MIN_LIFETIME_SECONDS, Math.floor(lifetimeSeconds)));
  const token = `pv_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = Math.floor(Date.now() / 1000) + lifetime;
  const result = await env.DB.prepare("INSERT INTO post_preview_tokens (post_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .bind(postId, tokenHash, expiresAt).run();
  return {
    token,
    link: {
      id: Number(result.meta.last_row_id), expiresAt, createdAt: new Date().toISOString(),
      revokedAt: null, lastViewedAt: null, viewCount: 0, active: true,
    } satisfies PostPreviewLink,
    post,
  };
}

export async function listPostPreviewTokens(postId: number) {
  await ensureDatabase();
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(`SELECT id, expires_at AS expiresAt, created_at AS createdAt,
      revoked_at AS revokedAt, last_viewed_at AS lastViewedAt, view_count AS viewCount
    FROM post_preview_tokens WHERE post_id = ? ORDER BY id DESC LIMIT 30`)
    .bind(postId).all<Omit<PostPreviewLink, "active">>();
  return (rows.results ?? []).map((row) => ({ ...row, active: !row.revokedAt && row.expiresAt > now }));
}

export async function revokePostPreviewToken(postId: number, previewId: number) {
  await ensureDatabase();
  const result = await env.DB.prepare(`UPDATE post_preview_tokens SET revoked_at = CURRENT_TIMESTAMP
    WHERE id = ? AND post_id = ? AND revoked_at IS NULL`).bind(previewId, postId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function resolvePostPreviewToken(token: string, trackView = false) {
  if (!TOKEN_PATTERN.test(token)) return null;
  await ensureDatabase();
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const grant = await env.DB.prepare(`SELECT t.id, t.post_id AS postId, t.expires_at AS expiresAt,
      p.public_id AS postPublicId, p.workspace_id AS workspaceId
    FROM post_preview_tokens t JOIN posts p ON p.id = t.post_id
    WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ? LIMIT 1`)
    .bind(tokenHash, now).first<{ id: number; postId: number; expiresAt: number; postPublicId: string; workspaceId:number }>();
  if (!grant) return null;
  if (trackView) {
    await env.DB.prepare(`UPDATE post_preview_tokens SET view_count = view_count + 1,
      last_viewed_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(grant.id).run();
  }
  return grant;
}

export async function previewTokenCanReadPost(token: string, postId: number) {
  const grant = await resolvePostPreviewToken(token, false);
  return grant?.postId === postId;
}

export class PreviewTokenError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

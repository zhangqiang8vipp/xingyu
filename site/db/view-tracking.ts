/** Pure view-tracking primitives: no Cloudflare bindings, testable directly. */

/** Local fallback only; production must set the VIEWS_IDENTITY_SECRET secret. */
export const VIEWS_IDENTITY_SECRET_FALLBACK = "xingyu-local-views-identity-secret";
export const VIEWS_REQUEST_WINDOW_MS = 60_000;
export const VIEWS_REQUEST_CAPACITY = 240;
export const VIEWS_BLOCK_MS = 300_000;
export const POST_VIEWS_RETENTION_DAYS = 90;

export type TrackResult = boolean | "unknown" | "limited" | Error;

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function rateIdentityHash(secret: string, address: string) {
  return hmacHex(secret, `rate:${address}`);
}

function viewedOnToday() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Coarse server-side reader identity. Cloudflare's connecting-IP header is
 * used; the value is only ever fed into a keyed HMAC — no IP, prefix or
 * client-supplied identifier is stored anywhere.
 */
export function coarseReaderAddress(request: Request) {
  const connecting = request.headers.get("cf-connecting-ip")?.trim();
  if (connecting) return connecting;
  return "local";
}

async function viewerIdHash(secret: string, address: string) {
  return hmacHex(secret, `view:${address}:${viewedOnToday()}`);
}

export async function trackPostView(db: D1Database, secret: string, request: Request, slug: string): Promise<TrackResult> {
  if (typeof slug !== "string" || !slug || slug.length > 200) {
    return new Error("invalid slug");
  }
  const address = coarseReaderAddress(request);
  const limitHash = await rateIdentityHash(secret, address);
  const viewerHash = await viewerIdHash(secret, address);
  const now = Date.now();

  // A single UPSERT reserves the rate slot across concurrent Worker instances.
  const limit = await db.prepare(`INSERT INTO view_request_limits
      (identity_hash, attempts, window_started, blocked_until, updated_at)
      VALUES (?, 1, ?, 0, ?)
      ON CONFLICT(identity_hash) DO UPDATE SET
        attempts = CASE WHEN excluded.updated_at - view_request_limits.window_started >= ?
          THEN 1 ELSE view_request_limits.attempts + 1 END,
        window_started = CASE WHEN excluded.updated_at - view_request_limits.window_started >= ?
          THEN excluded.updated_at ELSE view_request_limits.window_started END,
        blocked_until = CASE
          WHEN excluded.updated_at - view_request_limits.window_started >= ? THEN 0
          WHEN view_request_limits.attempts >= ? THEN excluded.updated_at + ?
          ELSE 0 END,
        updated_at = excluded.updated_at
      WHERE view_request_limits.blocked_until <= excluded.updated_at
      RETURNING attempts, blocked_until`)
    .bind(limitHash, now, now, VIEWS_REQUEST_WINDOW_MS, VIEWS_REQUEST_WINDOW_MS,
      VIEWS_REQUEST_WINDOW_MS, VIEWS_REQUEST_CAPACITY, VIEWS_BLOCK_MS)
    .first<{ attempts: number; blocked_until: number }>();
  if (!limit || Number(limit.attempts) > VIEWS_REQUEST_CAPACITY || Number(limit.blocked_until) > now) {
    return "limited";
  }

  const post = await db.prepare(
    "SELECT id FROM posts WHERE (public_id = ? OR slug = ?) AND status = 'published' AND space_id IS NULL",
  ).bind(slug, slug).first<{ id: number }>();
  if (!post) return "unknown";

  try {
    // One D1 batch: the event insert and the counter increment commit or roll
    // back together, and the guard keeps the counter in sync with the event.
    const results = await db.batch([
      db.prepare("INSERT OR IGNORE INTO post_views (post_id, visitor_hash, viewed_on) VALUES (?, ?, ?)")
        .bind(post.id, viewerHash, viewedOnToday()),
      db.prepare("UPDATE posts SET view_count = view_count + 1 WHERE id = ? AND changes() = 1")
        .bind(post.id),
      db.prepare("SELECT changes() AS counted"),
    ]);
    const counted = Number((results[2]?.results?.[0] as { counted?: number } | undefined)?.counted ?? 0);
    return counted === 1;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export async function cleanupExpiredPostViews(db: D1Database, retentionDays = POST_VIEWS_RETENTION_DAYS) {
  const result = await db.prepare(
    "DELETE FROM post_views WHERE viewed_on < date('now', '-' || ? || ' days')",
  ).bind(retentionDays).run();
  return result.meta.changes ?? 0;
}

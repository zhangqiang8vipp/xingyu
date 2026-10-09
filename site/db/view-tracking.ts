/** Pure view-tracking primitives: no direct Cloudflare env access, testable directly. */

/** Local fallback only; production must set the VIEWS_IDENTITY_SECRET secret. */
export const VIEWS_IDENTITY_SECRET_FALLBACK = "xingyu-local-views-identity-secret";
export const POST_VIEWS_RETENTION_DAYS = 90;

export type TrackResult = boolean | "unknown" | Error;
export type ViewRequestResult = TrackResult | "limited" | "unavailable";
export type ViewRateLimitResult = "allowed" | "limited" | "unavailable";
export type ViewRateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

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

export async function readerIdentityHashes(secret: string, request: Request) {
  const address = coarseReaderAddress(request);
  const [rateKey, viewerHash] = await Promise.all([
    rateIdentityHash(secret, address),
    viewerIdHash(secret, address),
  ]);
  return { rateKey, viewerHash };
}

/**
 * Production requires the native Cloudflare Rate Limiting binding. Local
 * development may run without it, but never falls back to a D1 write path.
 */
export async function checkViewRateLimit(
  limiter: ViewRateLimiter | undefined,
  rateKey: string,
  appEnvironment: string | undefined,
): Promise<ViewRateLimitResult> {
  if (!limiter) return appEnvironment === "production" ? "unavailable" : "allowed";
  try {
    const result = await limiter.limit({ key: rateKey });
    return result.success ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}

export async function trackPostViewRequest(
  db: D1Database,
  limiter: ViewRateLimiter | undefined,
  secret: string,
  request: Request,
  slug: string,
  appEnvironment: string | undefined,
  ensureReady?: () => Promise<void>,
): Promise<ViewRequestResult> {
  const { rateKey, viewerHash } = await readerIdentityHashes(secret, request);
  const rateLimit = await checkViewRateLimit(limiter, rateKey, appEnvironment);
  if (rateLimit !== "allowed") return rateLimit;
  await ensureReady?.();
  return trackPostView(db, viewerHash, slug);
}

export async function trackPostView(
  db: D1Database,
  viewerHash: string,
  slug: string,
): Promise<TrackResult> {
  if (typeof slug !== "string" || !slug || slug.length > 200) {
    return new Error("invalid slug");
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

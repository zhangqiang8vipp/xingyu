import { cookies } from "next/headers";
import { env } from "cloudflare:workers";
import { pbkdf2Sync, scryptSync } from "node:crypto";
import { ensureDatabase } from "@/db/bootstrap";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_SECONDS,
  adminRuntimeEnv,
  base64UrlToBytes,
  bytesToBase64Url,
  constantTimeBytesEqual,
  isDevelopment,
  isValidAdminSessionToken,
  sha256Bytes,
  signAdminPayload,
  validSessionSecret,
} from "@/db/admin-session";

const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_BLOCK_SECONDS = 30 * 60;
const MAX_LOGIN_ATTEMPTS = 5;

export type AdminIdentity = { displayName: string; email: string };

export function isPasswordLoginConfigured() {
  const runtime = adminRuntimeEnv();
  return Boolean(validSessionSecret() && (runtime.ADMIN_PASSWORD_HASH || (isDevelopment() && runtime.ADMIN_PASSWORD)));
}

export async function isLegacyAdminPasswordAllowed(): Promise<boolean> {
  await ensureDatabase();
  const credential = await env.DB.prepare("SELECT legacy_admin FROM user_credentials WHERE user_id=1").first<{legacy_admin:number}>();
  return credential?.legacy_admin === 1;
}

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  if (isPasswordLoginConfigured() && await hasValidAdminSession() && await isLegacyAdminPasswordAllowed()) {
    return { displayName: "星屿管理员", email: "password-admin" };
  }
  const { isOwnerIdentity } = await import("./identity");
  if (await isOwnerIdentity()) return { displayName: "星屿管理员", email: "zhangqiang8vip@gmail.com" };
  return null;
}

export async function isAdminRequest(request?: Request) {
  if (request && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return false;
  }
  return Boolean(await getAdminIdentity());
}

export async function verifyLocalAdminPassword(password: string) {
  if (!validSessionSecret() || password.length < 12 || password.length > 256) return false;
  const runtime = adminRuntimeEnv();
  const encoded = runtime.ADMIN_PASSWORD_HASH;
  if (encoded) return verifyPbkdf2Password(password, encoded);
  if (!isDevelopment() || !runtime.ADMIN_PASSWORD) return false;
  return constantTimeBytesEqual(await sha256Bytes(password), await sha256Bytes(runtime.ADMIN_PASSWORD));
}

export async function createLocalAdminSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  const payload = `v1.${expiresAt}.${nonce}`;
  const signature = await signAdminPayload(payload);
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: !isDevelopment(),
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });
}

export async function clearLocalAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: !isDevelopment(), path: "/", maxAge: 0 });
}

async function hasValidAdminSession() {
  return isValidAdminSessionToken((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
}

async function verifyPbkdf2Password(password: string, encoded: string) {
  if (encoded.startsWith("scrypt-v1-")) return verifyScryptPassword(password, encoded);
  const [algorithm, iterationsText, saltText, expectedText] = encoded.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 210_000 || iterations > 1_000_000) return false;
  try {
    const salt = base64UrlToBytes(saltText);
    const expected = base64UrlToBytes(expectedText);
    if (salt.length < 16 || expected.length !== 32) return false;
    const derived = new Uint8Array(pbkdf2Sync(password, salt, iterations, 32, "sha256"));
    return constantTimeBytesEqual(derived, expected);
  } catch {
    return false;
  }
}

function verifyScryptPassword(password: string, encoded: string) {
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded.slice("scrypt-v1-".length)))) as {
      n?: number;
      r?: number;
      p?: number;
      salt?: string;
      hash?: string;
    };
    if (payload.n !== 16_384 || payload.r !== 8 || payload.p !== 1 || !payload.salt || !payload.hash) return false;
    const salt = base64UrlToBytes(payload.salt);
    const expected = base64UrlToBytes(payload.hash);
    if (salt.length < 16 || expected.length !== 32) return false;
    const derived = new Uint8Array(scryptSync(password, salt, 32, { N:payload.n, r:payload.r, p:payload.p, maxmem:64 * 1024 * 1024 }));
    return constantTimeBytesEqual(derived, expected);
  } catch {
    return false;
  }
}

export async function getAdminLoginLimit(request: Request) {
  await ensureDatabase();
  const identifier = await loginIdentifier(request);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT attempts, window_started, blocked_until FROM admin_login_attempts WHERE identifier = ?")
    .bind(identifier).first<{ attempts:number; window_started:number; blocked_until:number }>();
  if (!row) return { allowed:true, retryAfter:0, identifier, row:null };
  const retryAfter = Math.max(0, row.blocked_until - now);
  return { allowed:retryAfter === 0, retryAfter, identifier, row };
}

export async function recordAdminLoginFailure(limit: Awaited<ReturnType<typeof getAdminLoginLimit>>) {
  const now = Math.floor(Date.now() / 1000);
  const withinWindow = limit.row && now - limit.row.window_started < LOGIN_WINDOW_SECONDS;
  const attempts = withinWindow ? limit.row!.attempts + 1 : 1;
  const windowStarted = withinWindow ? limit.row!.window_started : now;
  const blockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_BLOCK_SECONDS : 0;
  await env.DB.prepare(`INSERT INTO admin_login_attempts (identifier, attempts, window_started, blocked_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(identifier) DO UPDATE SET attempts=excluded.attempts, window_started=excluded.window_started,
      blocked_until=excluded.blocked_until, updated_at=excluded.updated_at`)
    .bind(limit.identifier, attempts, windowStarted, blockedUntil, now).run();
}

export async function clearAdminLoginFailures(identifier: string) {
  await env.DB.prepare("DELETE FROM admin_login_attempts WHERE identifier = ?").bind(identifier).run();
}

async function loginIdentifier(request: Request) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const secret = validSessionSecret() ?? "";
  return bytesToBase64Url(await sha256Bytes(`${secret}:${ip}`));
}

export function unauthorized() {
  return Response.json({ error: "无权访问写作后台" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

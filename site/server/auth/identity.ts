import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { bytesToBase64Url, sha256Bytes, adminRuntimeEnv, validSessionSecret } from "@/db/admin-session";
import { IDENTITY_COOKIE, identityBySession, sessionDigest } from "./identity-session";
import { verifyLocalAdminPassword } from "./admin-auth";
import { ensureDatabase } from "@/db/bootstrap";

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_EMAIL = "zhangqiang8vip@gmail.com";
const PBKDF2_ITERATIONS = 310000;
const encoder = new TextEncoder();

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bytes = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256,
  ));
  return ["pbkdf2-sha256", PBKDF2_ITERATIONS, bytesToBase64Url(salt), bytesToBase64Url(bytes)].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algo, iterationText, saltText, valueText] = encoded.split("$");
  if (algo !== "pbkdf2-sha256" || Number(iterationText) < PBKDF2_ITERATIONS || !/^\d+$/.test(iterationText)) return false;
  try {
    const salt = decodeBase64(saltText);
    const expected = decodeBase64(valueText);
    if (salt.length !== 16 || expected.length !== 32) return false;
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const found = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(iterationText) }, key, 256,
    ));
    let mismatch = 0;
    found.forEach((v, i) => { mismatch |= v ^ expected[i]; });
    return mismatch === 0;
  } catch { return false; }
}

function decodeBase64(input: string): Uint8Array {
  const base = input.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base + "=".repeat((4 - base.length % 4) % 4)), (c) => c.charCodeAt(0));
}

async function digest(value: string) {
  return Array.from(await sha256Bytes(value), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function identityRateLimit(request: Request, email: string) {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const identifier = await digest("identity-login:" + address + ":" + email);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT attempts, window_started, blocked_until FROM identity_login_limits WHERE identifier = ?")
    .bind(identifier).first<{ attempts: number; window_started: number; blocked_until: number }>();
  if (row && row.blocked_until > now) return { allowed: false, retryAfter: row.blocked_until - now, identifier };
  const attempts = row && now - row.window_started < 900 ? row.attempts + 1 : 1;
  const started = row && now - row.window_started < 900 ? row.window_started : now;
  await env.DB.prepare("INSERT INTO identity_login_limits(identifier,attempts,window_started,blocked_until,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(identifier) DO UPDATE SET attempts=excluded.attempts,window_started=excluded.window_started,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at")
    .bind(identifier, attempts, started, attempts >= 5 ? now + 1800 : 0, now).run();
  return { allowed: attempts < 5, retryAfter: attempts >= 5 ? 1800 : 0, identifier };
}

export async function signInWithEmail(email: string, password: string) {
  await ensureDatabase();
  if (!validSessionSecret() || password.length < 12 || password.length > 256) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.status, c.password_hash, c.legacy_admin FROM user_identities i JOIN users u ON u.id=i.user_id JOIN user_credentials c ON c.user_id=u.id WHERE i.provider='email' AND i.subject=?",
  ).bind(email).first<{ id: number; status: string; password_hash: string | null; legacy_admin: number }>();
  if (!row || row.status !== "active") return null;
  const verified = row.password_hash
    ? await verifyPassword(password, row.password_hash)
    : row.legacy_admin === 1 && row.id === 1 && email === ADMIN_EMAIL && await verifyLocalAdminPassword(password);
  if (!verified) return null;
  if (!row.password_hash) {
    const encoded = await hashPassword(password);
    await env.DB.prepare("UPDATE user_credentials SET password_hash=?, legacy_admin=0, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND password_hash IS NULL")
      .bind(encoded, row.id).run();
  }
  const raw = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sessionDigest(raw);
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await env.DB.prepare("INSERT INTO user_sessions(session_hash,user_id,expires_at) VALUES(?,?,?)").bind(hash, row.id, expires).run();
  (await cookies()).set(IDENTITY_COOKIE, raw, { httpOnly: true, secure: adminRuntimeEnv().APP_ENV !== "development", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
  return { userId: row.id };
}

export async function currentIdentity() {
  return identityBySession((await cookies()).get(IDENTITY_COOKIE)?.value);
}

export async function logoutIdentity() {
  const store = await cookies();
  const token = store.get(IDENTITY_COOKIE)?.value;
  if (token) await env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE session_hash=?").bind(Math.floor(Date.now() / 1000), await sessionDigest(token)).run();
  store.set(IDENTITY_COOKIE, "", { httpOnly: true, secure: adminRuntimeEnv().APP_ENV !== "development", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function isOwnerIdentity() {
  const user = await currentIdentity();
  if (!user) return false;
  const row = await env.DB.prepare("SELECT 1 AS yes FROM site_memberships WHERE user_id=? AND role='owner'").bind(user.userId).first();
  return !!row;
}

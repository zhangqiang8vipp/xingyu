import { env } from "cloudflare:workers";
import { parseCookieValue, sha256Bytes } from "@/db/admin-session";
import { ensureDatabase } from "@/db/bootstrap";

/** OAuth subject identifies a XingYu account, not a provider or email. */
export function userSubject(userId: number) { return "user:" + userId; }
export function subjectUserId(subject: string): number | null {
  if (!/^user:[1-9]\d{0,12}$/.test(subject)) return null;
  const n = Number(subject.slice(5));
  return Number.isSafeInteger(n) ? n : null;
}
export async function sessionDigest(raw: string) {
  return Array.from(await sha256Bytes(raw), b => b.toString(16).padStart(2, "0")).join("");
}
export const IDENTITY_COOKIE = "xingyu_identity_session";
export type XingyuIdentity = { userId: number; displayName: string };
export async function identityBySession(raw: string | undefined): Promise<XingyuIdentity | null> {
  if (!raw || !/^[A-Za-z0-9_-]{40,60}$/.test(raw)) return null;
  await ensureDatabase();
  const row = await env.DB.prepare("SELECT u.id,u.display_name,u.status FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.session_hash=? AND s.revoked_at IS NULL AND s.expires_at>?")
    .bind(await sessionDigest(raw),Math.floor(Date.now()/1000))
    .first<{id:number;display_name:string;status:string}>();
  return row?.status === "active" ? {userId:row.id,displayName:row.display_name} : null;
}
export async function identityFromRequest(request: Request) {
  let raw = "";
  try { raw = parseCookieValue(request.headers.get("cookie"),IDENTITY_COOKIE); } catch { return null; }
  return identityBySession(raw);
}
export async function activeSubject(subject: string) {
  const userId = subjectUserId(subject);
  if (!userId) return null;
  await ensureDatabase();
  const row = await env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(userId).first();
  return row ? userId : null;
}

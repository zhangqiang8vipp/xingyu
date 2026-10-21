import { env } from "cloudflare:workers";
import type { AskIdentity } from "@/server/qa-retrieval";

/**
 * Quotas use an isolated "qa:v1:" key namespace in the existing OAuth
 * rate-limit counter table. This preserves the production schema 25 contract,
 * avoiding an outage-prone D1 migration just to launch a small public beta.
 * No OAuth or login counter keys are read, mutated or pruned by Q&A code.
 */
// There is no site-wide daily model cap: OpenRouter owns the provider-side
// free-model limits. Per-person daily model usage is limited to 100 requests.
// Verified site administrators bypass app-specific Q&A quotas entirely.
export const ASK_DAILY_PERSON_LIMIT = 100;
const ANONYMOUS_SEARCH_LIMIT = 30;
const SIGNED_IN_SEARCH_LIMIT = 100;

export class AskQuotaError extends Error {
  constructor(readonly code: "throttled" | "daily" | "unavailable") {
    super(code);
  }
}

async function digestIdentity(value: string) {
  // HMAC prevents reverse-lookup of visitors' IPs from database row keys.
  const secret = env.VIEWS_IDENTITY_SECRET;
  if (!secret || secret.length < 20) throw new AskQuotaError("unavailable");
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signed=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signed),byte=>byte.toString(16).padStart(2,"0")).join("");
}

/**
 * Atomic UPSERT with the limit check in SQL for per-person quotas.
 * Callers include UTC date in the key; window_started is for safe retention.
 */
async function increment(identifier: string, limit: number) {
  const now=Math.floor(Date.now()/1000);
  const utcDay=Math.floor(now/86400)*86400;
  const row=await env.DB.prepare(
    "INSERT INTO oauth_rate_limits(identifier,attempts,window_started,updated_at) VALUES(?,1,?,?) " +
    "ON CONFLICT(identifier) DO UPDATE SET " +
    "attempts=oauth_rate_limits.attempts+1,updated_at=excluded.updated_at " +
    "WHERE oauth_rate_limits.attempts<? RETURNING attempts"
  ).bind(identifier,utcDay,now,limit).first<{attempts:number}>();
  return Boolean(row);
}

export async function takeAskVisitorQuota(
  request: Request,identity: AskIdentity,mode: "answer" | "sources",
  isAdmin = false,
) {
  // A verified site owner / legacy admin is exempt from Q&A usage limits.
  // Caller must derive this from authenticated credentials on the server.
  if (isAdmin) return;
  const day=new Date().toISOString().slice(0,10);
  const label=identity
    ? "user:" + identity.userId
    : "ip:" + (request.headers.get("CF-Connecting-IP") ?? "unknown");
  const hash=await digestIdentity("qa:v1:" + label + ":" + day);
  const edge=await env.VIEW_RATE_LIMITER.limit({key:"ask:"+hash});
  if(!edge.success)throw new AskQuotaError("throttled");
  const modelRequest=mode==="answer";
  const limit=modelRequest ? ASK_DAILY_PERSON_LIMIT
    : identity ? SIGNED_IN_SEARCH_LIMIT : ANONYMOUS_SEARCH_LIMIT;
  const name="qa:v1:"+(modelRequest?"model":"search")+":"+hash;
  if(!await increment(name,limit))throw new AskQuotaError("daily");
}


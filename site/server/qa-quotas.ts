import { env } from "cloudflare:workers";
import type { AskIdentity } from "@/server/qa-retrieval";

/**
 * Hosted free routes are shared by the whole XINGYU site.
 * Protect the upstream's published free allocation (typically 50/day)
 * with a strict 40/day shared ceiling and a smaller per-visitor budget.
 */
export const ASK_DAILY_GLOBAL_LIMIT = 40;
const INDIVIDUAL_ANONYMOUS_LIMIT = 3;
const INDIVIDUAL_SIGNED_IN_LIMIT = 8;

export class AskQuotaError extends Error {
  constructor(readonly code: "throttled" | "daily" | "unavailable") {
    super(code);
  }
}

async function digestIdentity(value: string) {
  // HMAC prevents reverse-lookup of IPs from stored anonymous quota digests.
  const secret = env.VIEWS_IDENTITY_SECRET;
  if (!secret || secret.length < 20) throw new AskQuotaError("unavailable");
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signed=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signed),byte=>byte.toString(16).padStart(2,"0")).join("");
}

async function increment(day: string,bucket: string,hash: string,limit: number) {
  const row=await env.DB.prepare(
    "INSERT INTO ai_question_quotas(day,bucket,identity_hash,used) VALUES(?,?,?,1) " +
    "ON CONFLICT(day,bucket,identity_hash) DO UPDATE SET used=used+1 " +
    "WHERE used<? RETURNING used",
  ).bind(day,bucket,hash,limit).first<{used:number}>();
  return Boolean(row);
}

export async function takeAskVisitorQuota(request: Request,identity: AskIdentity, mode: "answer" | "sources") {
  const date=new Date().toISOString().slice(0,10);
  const label=identity
    ? "user:" + identity.userId
    : "ip:" + (request.headers.get("CF-Connecting-IP") ?? "unknown");
  const hash=await digestIdentity("qa:v1:" + label + ":" + date);
  // The pre-existing edge limiter is a burst backstop; the D1 per-day limit
  // below is the authoritative protection for expensive upstream calls.
  const edge=await env.VIEW_RATE_LIMITER.limit({key:"ask:"+hash});
  if(!edge.success)throw new AskQuotaError("throttled");
  const modelRequest=mode==="answer";
  const limit=modelRequest
    ? identity ? INDIVIDUAL_SIGNED_IN_LIMIT : INDIVIDUAL_ANONYMOUS_LIMIT
    : identity ? 100 : 30;
  const bucket=modelRequest?"visitor:model":"visitor:search";
  if(!await increment(date,bucket,hash,limit))throw new AskQuotaError("daily");
}

export async function takeAskGlobalQuota() {
  const date=new Date().toISOString().slice(0,10);
  if(!await increment(date,"global","hosted-free",ASK_DAILY_GLOBAL_LIMIT))
    throw new AskQuotaError("daily");
}

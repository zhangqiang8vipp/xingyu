import { env } from "cloudflare:workers";
import { bytesToBase64Url } from "@/db/admin-session";
import { ensureDatabase } from "@/db/bootstrap";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { hashPassword, normalizeEmail } from "./identity";
import { sessionDigest } from "./identity-session";

type SignupEnv = Env & { RESEND_API_KEY?: string; EMAIL_FROM?: string; PUBLIC_SITE_URL?: string; REGISTRATION_ENABLED?: string };
function config() { return env as SignupEnv; }
export class IdentityEmailError extends Error {
  constructor(message: string, readonly status: 400 | 429 | 503) { super(message); }
}
function requireMailConfig() {
  const c = config();
  if (c.REGISTRATION_ENABLED !== "true" || !c.RESEND_API_KEY || !c.EMAIL_FROM || !c.PUBLIC_SITE_URL) {
    throw new IdentityEmailError("注册服务尚未启用", 503);
  }
  const base = new URL(c.PUBLIC_SITE_URL);
  if (base.protocol !== "https:" && base.hostname !== "localhost") throw new IdentityEmailError("邮件回调域名配置无效",503);
  return { base, key: c.RESEND_API_KEY, from: c.EMAIL_FROM };
}
export function validRegistrationPassword(password: string) {
  return password.length >= 12 && password.length <= 128 && !/[\u0000-\u001f]/.test(password);
}
async function limitBucket(bucket: string, max: number, window: number) {
  const id = await sessionDigest("registration:" + bucket);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "INSERT INTO identity_login_limits(identifier,attempts,window_started,blocked_until,updated_at) VALUES(?,1,?,0,?) ON CONFLICT(identifier) DO UPDATE SET attempts=CASE WHEN ?-window_started>=? THEN 1 ELSE attempts+1 END,window_started=CASE WHEN ?-window_started>=? THEN ? ELSE window_started END,updated_at=? RETURNING attempts,window_started"
  ).bind(id,now,now,now,window,now,window,now,now).first<{attempts:number;window_started:number}>();
  if (!row || row.attempts > max) throw new IdentityEmailError("操作过于频繁，请稍后重试", 429);
}
async function checkSignupLimit(request: Request, email: string) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  await limitBucket("ip:"+ip,30,3600);
  await limitBucket("email:"+email,5,3600);
}

async function sendVerification(userId: number, email: string) {
  const mail = requireMailConfig();
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sessionDigest(token);
  const destination = new URL("/verify-email",mail.base);
  destination.searchParams.set("token",token);
  const now = Math.floor(Date.now()/1000);
  await env.DB.prepare("DELETE FROM email_verifications WHERE user_id=? AND used_at IS NULL").bind(userId).run();
  await env.DB.prepare("INSERT INTO email_verifications(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(tokenHash,userId,now+1800).run();
  const response = await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{"Authorization":"Bearer "+mail.key,"Content-Type":"application/json"},
    body:JSON.stringify({from:mail.from,to:[email],subject:"验证你的星屿邮箱",text:"请打开链接验证邮箱（30 分钟有效）：\n"+destination.toString()+"\n若不是你本人操作，请忽略。"}),
  });
  if (!response.ok) {
    console.error("identity.verification.delivery_failed",response.status);
    throw new IdentityEmailError("验证邮件发送失败，请稍后重试",503);
  }
}

export async function requestRegistration(request: Request, emailInput: string, password: string, nameInput: string) {
  const mail = requireMailConfig();
  // No host-header-generated verification links.
  if (mail.base.origin !== new URL(request.url).origin) throw new IdentityEmailError("站点域名配置不匹配",503);
  const email = normalizeEmail(emailInput);
  const name = nameInput.trim();
  if (!email || !validRegistrationPassword(password) || name.length < 1 || name.length > 64) {
    throw new IdentityEmailError("请输入有效邮箱、12-128 位密码及昵称",400);
  }
  await ensureDatabase();
  await checkSignupLimit(request,email);
  const existing = await env.DB.prepare("SELECT user_id FROM user_identities WHERE provider='email' AND subject=?").bind(email).first();
  if (existing) return; // No account enumeration, no implicit account merging.
  const passwordHash = await hashPassword(password);
  const inserted = await env.DB.prepare("INSERT INTO users(display_name,status) VALUES(?,'pending') RETURNING id").bind(name).first<{id:number}>();
  if (!inserted?.id) throw new IdentityEmailError("注册失败",503);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO user_identities(user_id,provider,subject,email,name) VALUES(?,'email',?,?,?)").bind(inserted.id,email,email,name),
      env.DB.prepare("INSERT INTO user_credentials(user_id,password_hash,legacy_admin) VALUES(?,?,0)").bind(inserted.id,passwordHash),
    ]);
  } catch (error) {
    await env.DB.prepare("DELETE FROM users WHERE id=? AND status='pending'").bind(inserted.id).run();
    // May be a concurrent request for the same email.
    const winner = await env.DB.prepare("SELECT user_id FROM user_identities WHERE provider='email' AND subject=?").bind(email).first();
    if (winner) return;
    throw error;
  }
  await sendVerification(inserted.id,email);
}

export async function requestVerificationAgain(request: Request, emailInput: string) {
  const mail = requireMailConfig();
  if (mail.base.origin !== new URL(request.url).origin) throw new IdentityEmailError("站点域名配置不匹配",503);
  const email = normalizeEmail(emailInput);
  if (!email) throw new IdentityEmailError("邮箱格式无效",400);
  await ensureDatabase();
  await checkSignupLimit(request,email);
  const user = await env.DB.prepare(
    "SELECT u.id,u.status FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.provider='email' AND i.subject=?",
  ).bind(email).first<{id:number;status:string}>();
  if (user?.status !== "pending") return;
  const last = await env.DB.prepare("SELECT created_at FROM email_verifications WHERE user_id=? ORDER BY created_at DESC LIMIT 1").bind(user.id).first<{created_at:string}>();
  if (last?.created_at && Date.now() - Date.parse(last.created_at.replace(" ","T")+"Z") < 60_000) return;
  await sendVerification(user.id,email);
}

export async function confirmEmail(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return false;
  await ensureDatabase();
  const now = Math.floor(Date.now()/1000);
  const confirmed = await env.DB.prepare(
    "UPDATE email_verifications SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? RETURNING user_id",
  ).bind(now,await sessionDigest(token),now).first<{user_id:number}>();
  if (!confirmed) return false;
  await env.DB.prepare("UPDATE users SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(confirmed.user_id).run();
  await ensurePersonalWorkspace(confirmed.user_id);
  return true;
}

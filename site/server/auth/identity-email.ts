import { env } from "cloudflare:workers";
import { bytesToBase64Url } from "@/db/admin-session";
import { ensureDatabase } from "@/db/bootstrap";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { hashPassword, normalizeEmail } from "./identity";
import { sessionDigest, userSubject } from "./identity-session";

type SignupEnv = Env & { RESEND_API_KEY?: string; EMAIL_FROM?: string; PUBLIC_SITE_URL?: string; REGISTRATION_ENABLED?: string };
function config() { return env as SignupEnv; }
export class IdentityEmailError extends Error {
  constructor(message: string, readonly status: 400 | 429 | 503) { super(message); }
}
function requireMailConfig(registrationRequired = true) {
  const c = config();
  if ((registrationRequired && c.REGISTRATION_ENABLED !== "true") || !c.RESEND_API_KEY || !c.EMAIL_FROM || !c.PUBLIC_SITE_URL) {
    throw new IdentityEmailError("邮件验证服务尚未配置或注册尚未开放", 503);
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

async function sendMail(mail: ReturnType<typeof requireMailConfig>, to: string, subject: string, content: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer "+mail.key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: mail.from, to: [to], subject, text: content }),
  });
  if (!response.ok) {
    console.error("identity.email.delivery_failed", response.status);
    throw new IdentityEmailError("邮件发送暂时失败，请稍后再试",503);
  }
}

async function sendVerification(userId: number, email: string) {
  const mail = requireMailConfig();
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sessionDigest(token);
  const destination = new URL("/verify-email",mail.base);
  destination.searchParams.set("token",token);
  const now = Math.floor(Date.now()/1000);
  await env.DB.prepare("DELETE FROM email_verifications WHERE user_id=? AND purpose='verify_email' AND used_at IS NULL").bind(userId).run();
  await env.DB.prepare("INSERT INTO email_verifications(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(tokenHash,userId,now+1800).run();
  await sendMail(mail,email,"验证你的星屿邮箱","请打开链接验证邮箱（30 分钟有效）：\n"+destination.toString()+"\n若不是你本人操作，请忽略。");

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
  const last = await env.DB.prepare("SELECT created_at FROM email_verifications WHERE user_id=? AND purpose='verify_email' ORDER BY created_at DESC LIMIT 1").bind(user.id).first<{created_at:string}>();
  if (last?.created_at && Date.now() - Date.parse(last.created_at.replace(" ","T")+"Z") < 60_000) return;
  await sendVerification(user.id,email);
}

export async function confirmEmail(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return false;
  await ensureDatabase();
  const now = Math.floor(Date.now()/1000);
  const confirmed = await env.DB.prepare(
    "UPDATE email_verifications SET used_at=? WHERE token_hash=? AND purpose='verify_email' AND used_at IS NULL AND expires_at>? RETURNING user_id",
  ).bind(now,await sessionDigest(token),now).first<{user_id:number}>();
  if (!confirmed) return false;
  await env.DB.prepare("UPDATE users SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(confirmed.user_id).run();
  await ensurePersonalWorkspace(confirmed.user_id);
  return true;
}


/** Password recovery uses verified email ownership, independent from MCP authorization. */
export async function requestPasswordReset(request: Request, emailInput: string) {
  const mail=requireMailConfig(false);
  if(mail.base.origin!==new URL(request.url).origin)throw new IdentityEmailError("邮件回调域名配置无效",503);
  const email=normalizeEmail(emailInput);
  if(!email)throw new IdentityEmailError("邮箱格式无效",400);
  await ensureDatabase();
  const ip=request.headers.get("cf-connecting-ip") || "unknown";
  await limitBucket("reset-ip:"+ip,20,3600);
  await limitBucket("reset-email:"+email,4,3600);
  const row=await env.DB.prepare(
    "SELECT u.id FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.provider='email' AND i.subject=? AND u.status='active'"
  ).bind(email).first<{id:number}>();
  if(!row)return; // Never expose whether an email exists.
  const raw=bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const hash=await sessionDigest(raw);
  const link=new URL("/reset-password",mail.base);
  link.searchParams.set("token",raw);
  await env.DB.prepare("DELETE FROM email_verifications WHERE user_id=? AND purpose='reset_password' AND used_at IS NULL").bind(row.id).run();
  await env.DB.prepare("INSERT INTO email_verifications(token_hash,purpose,user_id,expires_at) VALUES(?,'reset_password',?,?)")
    .bind(hash,row.id,Math.floor(Date.now()/1000)+1800).run();
  try{
    await sendMail(mail,email,"重置你的星屿密码",
      "使用此链接重置星屿密码（30 分钟有效）：\n"+link.toString()+"\n如果不是你本人操作，请忽略。");
  }catch(error){
    // Keep response indistinguishable from an unregistered email.
    console.error("identity.password_reset.delivery_failed",error instanceof Error?error.name:"unknown");
  }
}

export async function confirmPasswordReset(token:string,newPassword:string) {
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token)||!validRegistrationPassword(newPassword))return false;
  await ensureDatabase();
  const passwordHash=await hashPassword(newPassword);
  const now=Math.floor(Date.now()/1000);
  const row=await env.DB.prepare(
    "UPDATE email_verifications SET used_at=? WHERE token_hash=? AND purpose='reset_password' AND used_at IS NULL AND expires_at>? "+
    "AND EXISTS(SELECT 1 FROM users WHERE id=email_verifications.user_id AND status='active') RETURNING user_id"
  ).bind(now,await sessionDigest(token),now).first<{user_id:number}>();
  if(!row)return false;
  const subject=userSubject(row.user_id);
  const updates=await env.DB.batch([
    env.DB.prepare("UPDATE user_credentials SET password_hash=?,legacy_admin=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
      .bind(passwordHash,row.user_id),
    env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL")
      .bind(now,row.user_id),
    env.DB.prepare("UPDATE oauth_access_tokens SET revoked_at=? WHERE subject=? AND revoked_at IS NULL")
      .bind(now,subject),
    env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at=? WHERE subject=? AND revoked_at IS NULL")
      .bind(now,subject),
    env.DB.prepare("UPDATE oauth_consents SET revoked_at=? WHERE subject=? AND revoked_at IS NULL")
      .bind(now,subject),
  ]);
  if(!updates[0]?.meta?.changes)throw new IdentityEmailError("账号凭据无法更新，请联系管理员",503);
  return true;
}

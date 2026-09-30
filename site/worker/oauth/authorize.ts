import {
  base64UrlToBytes,
  bytesToBase64Url,
  requestHasAdminSession,
  signAdminPayload,
  validSessionSecret,
} from "@/db/admin-session";
import { ensureDatabase } from "@/db/bootstrap";
import {
  ALL_SCOPES,
  consumeRateLimit,
  getOAuthClient,
  insertAuthorizationCode,
  mcpResourceFor,
  parseRedirectUris,
  parseScopeList,
  saveClientRedirectUri,
  scopeListText,
  upsertConsent,
  hashSecret,
} from "@/db/oauth";
import { isAuthorizationCodeResponse, readAuthorizeParams } from "./authorize-params";
import { shouldAcceptRedirect } from "./redirect-policy";
import { OAuthError, oauthLog } from "./errors";
import { newAuthorizationCode } from "./tokens";
import { newAccountSubject } from "./account-subject";

const SCOPE_LABELS: Record<string, string> = {
  "xingyu.read": "阅读博客内容、分类、空间与附件",
  "xingyu.draft": "创建与修改草稿",
  "xingyu.publish": "修改线上内容、发布或撤回文章",
  offline_access: "保持连接，无需反复授权",
};

export async function handleAuthorize(request: Request) {
  const url = new URL(request.url);
  const params = await readAuthorizeParams(request, url);
  await ensureDatabase();
  const limit = await consumeRateLimit(await rateLimitId(request, "authorize"), 30, 60);
  if (!limit.allowed) {
    throw new OAuthError("access_denied", 429, "请求过于频繁", { "Retry-After": String(limit.retryAfter) });
  }

  oauthLog("oauth.authorization.started", {
    method: request.method,
    response_type: params.get("response_type") || null,
    client_id: params.get("client_id") || null,
    has_consent_token: Boolean(params.get("consent_token")),
    has_redirect_uri: Boolean(params.get("redirect_uri")),
    has_code_challenge: Boolean(params.get("code_challenge")),
  });

  const checked = await validateAuthorizeParams(url.origin, params);
  if (!(await requestHasAdminSession(request))) {
    const returnTo = `/oauth/authorize?${toSearch(checked.publicParams)}`;
    return Response.redirect(new URL(`/admin/login?return_to=${encodeURIComponent(returnTo)}`, url.origin), 302);
  }

  if (request.method === "GET") {
    return consentPage(checked);
  }

  if (request.method !== "POST") {
    throw new OAuthError("invalid_request", 405, "只支持 GET 和 POST");
  }

  const decision = params.get("decision");
  if (!(await verifyConsentToken(params.get("consent_token") ?? "", checked))) {
    throw new OAuthError("invalid_request", 400, "授权请求已过期，请重试");
  }
  if (decision !== "allow") {
    oauthLog("oauth.consent.denied", { client_id: checked.clientId });
    return Response.redirect(appendQuery(checked.redirectUri, { error: "access_denied", state: checked.state }), 302);
  }

  if (checked.registerRedirect) {
    await saveClientRedirectUri(checked.clientId, checked.redirectUri);
    oauthLog("oauth.redirect_uri.registered", { client_id: checked.clientId, redirect_host: hostOf(checked.redirectUri) });
  }

  const subject = newAccountSubject(params.get("connection_label"), params.get("login_hint"));
  const code = newAuthorizationCode();
  await insertAuthorizationCode({
    codeHash: await hashSecret(code),
    clientId: checked.clientId,
    subject,
    redirectUri: checked.redirectUri,
    resource: checked.resource,
    scope: scopeListText(checked.scopes),
    codeChallenge: checked.codeChallenge,
  });
  await upsertConsent({
    subject,
    clientId: checked.clientId,
    resource: checked.resource,
    grantedScopes: scopeListText(checked.scopes),
  });
  oauthLog("oauth.consent.granted", {
    client_id: checked.clientId,
    subject,
    scopes: checked.scopes,
    register_redirect: checked.registerRedirect,
  });
  return Response.redirect(appendQuery(checked.redirectUri, { code, state: checked.state }), 302);
}

async function validateAuthorizeParams(origin: string, params: URLSearchParams) {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = (params.get("response_type") ?? "code").trim();
  const resource = params.get("resource") || mcpResourceFor(origin);
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const method = (params.get("code_challenge_method") ?? "S256").trim();
  const requested = parseScopeList(params.get("scope") ?? "xingyu.read xingyu.draft offline_access");
  const expectedResource = mcpResourceFor(origin);

  if (!isAuthorizationCodeResponse(responseType)) {
    throw new OAuthError("unsupported_response_type", 400, "只支持 response_type=code");
  }
  if (!clientId) throw new OAuthError("invalid_client", 400, "缺少 client_id");
  if (!redirectUri) throw new OAuthError("invalid_request", 400, "缺少 redirect_uri");
  if (!isAbsoluteRedirect(redirectUri)) throw new OAuthError("invalid_request", 400, "redirect_uri 必须是绝对地址");
  if (resource !== expectedResource) throw new OAuthError("invalid_target", 400, "resource 必须绑定 MCP 端点");
  if (!codeChallenge) throw new OAuthError("invalid_request", 400, "缺少 PKCE code_challenge");
  if (method !== "S256") throw new OAuthError("invalid_request", 400, "PKCE 只接受 S256");

  const client = await getOAuthClient(clientId);
  if (!client || !client.enabled) throw new OAuthError("invalid_client", 400, "未知或已停用的客户端");
  const allowed = parseScopeList(client.allowedScopes);
  if (requested.some((scope) => !allowed.includes(scope) || !ALL_SCOPES.includes(scope))) {
    throw new OAuthError("invalid_scope", 400, "请求了未允许的权限");
  }

  const registered = parseRedirectUris(client.redirectUris);
  const redirectDecision = shouldAcceptRedirect(client.clientId, registered, redirectUri);
  if (!redirectDecision.ok) {
    oauthLog("oauth.code.rejected", { client_id: clientId, reason: "redirect_uri_mismatch", redirect_host: hostOf(redirectUri) });
    throw new OAuthError("invalid_request", 400, "redirect_uri 未登记");
  }
  const registerRedirect = redirectDecision.register;

  return {
    clientId,
    clientName: client.clientName,
    redirectUri,
    resource,
    state,
    codeChallenge,
    scopes: requested,
    registerRedirect,
    publicParams: {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      resource,
      scope: scopeListText(requested),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    },
  };
}

async function consentPage(checked: Awaited<ReturnType<typeof validateAuthorizeParams>>) {
  const token = await signConsentToken(checked);
  const publish = checked.scopes.includes("xingyu.publish");
  const items = checked.scopes.map((scope) => `<li>${escapeHtml(SCOPE_LABELS[scope] ?? scope)}</li>`).join("");
  const firstRun = checked.registerRedirect
    ? `<p class="note">首次连接：将登记回调 <code>${escapeHtml(checked.redirectUri)}</code>，之后必须完全匹配。</p>`
    : "";
  const warning = publish
    ? `<p class="warn">此客户端还将获得修改线上内容、发布文章和撤回文章的能力。具体发布操作仍需要星屿客户端的显式确认。</p>`
    : "";
  return new Response(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>授权访问星屿</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f5f5f7; color:#1d1d1f; font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif; }
  main { width:min(520px,calc(100vw - 32px)); padding:36px 32px 28px; border-radius:28px; background:#fff; box-shadow:0 18px 50px rgba(22,28,38,.08); }
  small { color:#6e6e73; letter-spacing:.12em; font-weight:700; }
  h1 { margin:10px 0 8px; font-size:28px; letter-spacing:-.04em; }
  p,li,label { color:#424245; line-height:1.6; }
  ul { padding-left:18px; }
  .note,.warn { padding:12px 14px; border-radius:14px; }
  .note { background:#f5f5f7; }
  .warn { background:#fff4e5; }
  code { font-size:12px; word-break:break-all; }
  form { margin-top:22px; display:grid; gap:16px; }
  .field { display:grid; gap:6px; }
  .field span { font-size:13px; font-weight:600; color:#1d1d1f; }
  .field input { min-height:42px; padding:0 14px; border:1px solid #d2d2d7; border-radius:14px; font:inherit; }
  .actions { display:flex; justify-content:flex-end; gap:10px; }
  button { min-height:42px; padding:0 16px; border-radius:999px; border:0; font-weight:600; }
  .deny { background:#f2f2f7; }
  .allow { color:#fff; background:#0071e3; }
</style></head>
<body><main>
  <small>XINGYU</small>
  <h1>${escapeHtml(checked.clientName)} 请求访问你的星屿博客</h1>
  <p>客户端 ${escapeHtml(checked.clientName)} 将使用这些权限：</p>
  <ul>${items}</ul>
  ${firstRun}${warning}
  <form method="post" action="/oauth/authorize">
    ${hiddenInputs(checked.publicParams)}
    <input type="hidden" name="consent_token" value="${escapeHtml(token)}"/>
    <label class="field">
      <span>给这次连接起个名字</span>
      <input name="connection_label" maxlength="40" autocomplete="off" placeholder="例如：ChatGPT 工作号"/>
    </label>
    <div class="actions">
      <button class="deny" name="decision" value="deny" type="submit">取消</button>
      <button class="allow" name="decision" value="allow" type="submit">允许访问</button>
    </div>
  </form>
</main></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

async function signConsentToken(checked: Awaited<ReturnType<typeof validateAuthorizeParams>>) {
  if (!validSessionSecret()) throw new OAuthError("server_error", 503, "后台会话密钥尚未配置");
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    client_id: checked.clientId,
    redirect_uri: checked.redirectUri,
    resource: checked.resource,
    scope: scopeListText(checked.scopes),
    state: checked.state,
    code_challenge: checked.codeChallenge,
    register_redirect: checked.registerRedirect,
    exp: Math.floor(Date.now() / 1000) + 600,
  })));
  return `${payload}.${await signAdminPayload(payload)}`;
}

async function verifyConsentToken(token: string, checked: Awaited<ReturnType<typeof validateAuthorizeParams>>) {
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (signature !== await signAdminPayload(payload)) return false;
  try {
    const json = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
      client_id?: string; redirect_uri?: string; resource?: string; scope?: string; state?: string;
      code_challenge?: string; register_redirect?: boolean; exp?: number;
    };
    return json.client_id === checked.clientId
      && json.redirect_uri === checked.redirectUri
      && json.resource === checked.resource
      && json.scope === scopeListText(checked.scopes)
      && json.state === checked.state
      && json.code_challenge === checked.codeChallenge
      && Boolean(json.register_redirect) === checked.registerRedirect
      && Number(json.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function hiddenInputs(params: Record<string, string>) {
  return Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}"/>`)
    .join("");
}

function toSearch(params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

function appendQuery(target: string, values: Record<string, string>) {
  const url = new URL(target);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function isAbsoluteRedirect(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.protocol === "http:");
  } catch {
    return false;
  }
}

function hostOf(value: string) {
  try { return new URL(value).host; } catch { return "invalid"; }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

async function rateLimitId(request: Request, bucket: string) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return hashSecret(`${bucket}:${ip}`);
}

export function safeOAuthReturnTo(value?: string | null) {
  if (!value || !value.startsWith("/oauth/authorize") || value.startsWith("//")) return "";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}` : "";
  } catch {
    return "";
  }
}

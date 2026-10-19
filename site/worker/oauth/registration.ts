import { getDb } from "@/db";
import { ensureDatabase } from "@/db/bootstrap";
import { consumeRateLimit, hashSecret, scopeListText } from "@/db/oauth";
import { oauthClients } from "@/db/schema";
import { ClientRegistrationError, parseClientRegistration } from "./registration-params";

const MAX_BODY_BYTES = 16 * 1024;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders },
  });
}

export async function handleClientRegistration(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") {
    return json({ error: "invalid_request", error_description: "只支持 POST" }, 405, { Allow: "POST, OPTIONS" });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: "invalid_client_metadata", error_description: "注册请求体过大" }, 413);
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: "invalid_request", error_description: "无法读取注册请求体" }, 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: "invalid_client_metadata", error_description: "注册请求体过大" }, 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_request", error_description: "请求体必须是有效 JSON" }, 400);
  }

  try {
    await ensureDatabase();
    const ip = request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "unknown";
    const limit = await consumeRateLimit(await hashSecret("oauth-register:" + ip), 20, 3600);
    if (!limit.allowed) {
      return json({ error: "temporarily_unavailable", error_description: "注册请求过于频繁" }, 429, {
        "Retry-After": String(limit.retryAfter),
      });
    }

    const client = parseClientRegistration(payload);
    const clientId = "xy_dcr_" + crypto.randomUUID().replace(/-/g, "");
    await getDb().insert(oauthClients).values({
      clientId,
      clientName: client.clientName,
      clientType: "public",
      clientSecretHash: null,
      redirectUris: JSON.stringify(client.redirectUris),
      allowedScopes: scopeListText(client.allowedScopes),
      tokenEndpointAuthMethod: "none",
      enabled: true,
    });

    return json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      token_endpoint_auth_method: "none",
      scope: client.scopes.join(" "),
    }, 201);
  } catch (error) {
    if (error instanceof ClientRegistrationError) {
      return json({ error: "invalid_client_metadata", error_description: error.message }, 400);
    }
    console.error(JSON.stringify({
      event: "oauth.client_registration.failed",
      errorType: error instanceof Error ? error.name : typeof error,
    }));
    return json({ error: "server_error", error_description: "客户端注册暂时不可用" }, 500);
  }
}

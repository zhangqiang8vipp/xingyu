import { handleAuthorize } from "./authorize";
import { OAuthError, oauthJson } from "./errors";
import { handleMetadata } from "./metadata";
import { handleRevoke } from "./revoke";
import { handleToken } from "./token";
import { handleClientRegistration } from "./registration";

export function isOAuthPath(pathname: string) {
  return pathname === "/.well-known/oauth-authorization-server"
    || pathname === "/.well-known/oauth-protected-resource"
    || pathname === "/.well-known/oauth-protected-resource/mcp"
    || pathname === "/oauth/authorize"
    || pathname === "/oauth/token"
    || pathname === "/oauth/revoke"
    || pathname === "/oauth/register";
}

export async function handleOAuthRequest(request: Request) {
  const url = new URL(request.url);
  const metadata = handleMetadata(url);
  if (metadata) return metadata;
  try {
    if (url.pathname === "/oauth/authorize") return await handleAuthorize(request);
    if (url.pathname === "/oauth/token") return await handleToken(request);
    if (url.pathname === "/oauth/revoke") return await handleRevoke(request);
    if (url.pathname === "/oauth/register") return await handleClientRegistration(request);
    return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OAuthError) return oauthJson(error);
    console.error(JSON.stringify({
      event: "oauth.unhandled_error",
      path: url.pathname,
      error: error instanceof Error ? error.message : "unknown",
    }));
    return oauthJson(new OAuthError("server_error", 500, "授权服务暂时不可用"));
  }
}

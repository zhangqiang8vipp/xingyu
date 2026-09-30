import { ALL_SCOPES, mcpResourceFor } from "@/db/oauth";

function corsJson(body: unknown) {
  return Response.json(body, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceFor(origin),
    authorization_servers: [origin],
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/connect`,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...ALL_SCOPES],
  };
}

export function handleMetadata(url: URL) {
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    return corsJson(authorizationServerMetadata(url.origin));
  }
  if (
    url.pathname === "/.well-known/oauth-protected-resource"
    || url.pathname === "/.well-known/oauth-protected-resource/mcp"
  ) {
    return corsJson(protectedResourceMetadata(url.origin));
  }
  return null;
}

export function unauthorizedChallenge(origin: string, description = "unauthorized") {
  const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  return Response.json(
    { error: description },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer realm="Xingyu Blog MCP", resource_metadata="${metadata}", scope="xingyu.read"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

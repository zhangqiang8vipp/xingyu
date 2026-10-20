const DEFAULT_SCOPES = ["xingyu.read", "xingyu.draft", "xingyu.publish", "offline_access"] as const;
const SUPPORTED_SCOPES = ["xingyu.read", "xingyu.draft", "xingyu.publish", "offline_access"] as const;
const SUPPORTED_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

export type ClientRegistration = {
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scopes: string[];
  allowedScopes: string[];
};

export class ClientRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientRegistrationError";
  }
}

export function parseClientRegistration(value: unknown): ClientRegistration {
  if (!isRecord(value)) throw new ClientRegistrationError("请求体必须是 JSON 对象");

  const rawRedirectUris = value.redirect_uris;
  if (!Array.isArray(rawRedirectUris) || rawRedirectUris.length < 1 || rawRedirectUris.length > 20) {
    throw new ClientRegistrationError("redirect_uris 必须包含 1 到 20 个回调地址");
  }
  const redirectUris = rawRedirectUris.map(validateRedirectUri);
  if (new Set(redirectUris).size !== redirectUris.length) {
    throw new ClientRegistrationError("redirect_uris 不能包含重复地址");
  }

  const rawName = value.client_name;
  const clientName = typeof rawName === "string" ? rawName.trim() : "MCP client";
  if (!clientName || clientName.length > 120 || /[\u0000-\u001f\u007f]/.test(clientName)) {
    throw new ClientRegistrationError("client_name 必须为 1 到 120 个可见字符");
  }

  const authMethod = value.token_endpoint_auth_method === undefined
    ? "none"
    : value.token_endpoint_auth_method;
  if (authMethod !== "none") {
    throw new ClientRegistrationError("仅支持无需客户端密钥的公开客户端（token_endpoint_auth_method=none）");
  }

  const grantTypes = parseStringList(value.grant_types, ["authorization_code", "refresh_token"], "grant_types");
  if (!grantTypes.includes("authorization_code")
    || grantTypes.some((grant) => !(SUPPORTED_GRANT_TYPES as readonly string[]).includes(grant))) {
    throw new ClientRegistrationError("grant_types 仅支持 authorization_code 和 refresh_token");
  }

  const responseTypes = parseStringList(value.response_types, ["code"], "response_types");
  if (responseTypes.length !== 1 || responseTypes[0] !== "code") {
    throw new ClientRegistrationError("response_types 仅支持 code");
  }

  const defaultScopes = grantTypes.includes("refresh_token")
    ? [...DEFAULT_SCOPES]
    : DEFAULT_SCOPES.filter((scope) => scope !== "offline_access");
  let scopes: string[] = defaultScopes;
  if (value.scope !== undefined) {
    if (typeof value.scope !== "string" || value.scope.length > 512) {
      throw new ClientRegistrationError("scope 必须是有效的空格分隔权限字符串");
    }
    const requestedScopes = value.scope.split(/\s+/).filter(Boolean);
    if (requestedScopes.length > 0) {
      if (requestedScopes.some((scope) => !(SUPPORTED_SCOPES as readonly string[]).includes(scope))) {
        throw new ClientRegistrationError("scope 包含星屿不支持的权限");
      }
      scopes = [...new Set(requestedScopes)];
    }
  }
  if (!grantTypes.includes("refresh_token") && scopes.includes("offline_access")) {
    throw new ClientRegistrationError("使用 offline_access 必须声明 refresh_token");
  }

  // Registration does not grant consent. The user still approves each requested
  // scope on the authorization screen; publish remains a separate explicit grant.
  // Restrict the persisted grants to what the client requested at registration.
  // The user must still grant these scopes on the consent screen.
  return { clientName, redirectUris, grantTypes, responseTypes, scopes, allowedScopes: scopes };
}

function parseStringList(value: unknown, fallback: string[], field: string) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length < 1 || value.length > 10
    || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ClientRegistrationError(field + " 必须是非空字符串数组");
  }
  return [...new Set(value as string[])];
}

function validateRedirectUri(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value || value.trim() !== value
    || /\s|\*/.test(value)) {
    throw new ClientRegistrationError("redirect_uris 中包含无效的回调地址");
  }
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new ClientRegistrationError("redirect_uris 必须使用绝对 URL");
  }
  if (!uri.hostname || uri.username || uri.password || uri.hash) {
    throw new ClientRegistrationError("回调地址不能包含凭据或片段");
  }
  const secureWeb = uri.protocol === "https:";
  const loopbackHttp = uri.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname.toLowerCase());
  if (!secureWeb && !loopbackHttp) {
    throw new ClientRegistrationError("回调地址必须使用 HTTPS；本地回环地址可使用 HTTP");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

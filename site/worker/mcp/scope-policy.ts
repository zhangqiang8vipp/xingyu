export type McpAuth = {
  authType: "legacy" | "oauth" | "pat";
  clientId: string;
  subject: string;
  userId?: number;
  scopes: string[];
  tokenId?: number;
  patId?: number;
};

export class ScopeError extends Error {
  requiredScope: string;
  constructor(requiredScope: string) {
    super(`insufficient_scope:${requiredScope}`);
    this.requiredScope = requiredScope;
  }
}

export function requireScope(auth: McpAuth, scope: string) {
  if (!auth.scopes.includes(scope)) throw new ScopeError(scope);
}

export function scopeFailure(error: unknown) {
  if (!(error instanceof ScopeError)) return null;
  return {
    content: [{ type: "text" as const, text: JSON.stringify({
      ok: false,
      error: "insufficient_scope",
      required_scope: error.requiredScope,
    }, null, 2) }],
    structuredContent: { ok: false, error: "insufficient_scope", required_scope: error.requiredScope },
    isError: true,
  };
}

export function scopeForPostWrite(status: string) {
  return status === "published" ? "xingyu.publish" : "xingyu.draft";
}

export function scopeForAttachment(post: { status: string; spaceId: number | null } | null) {
  return post && post.status === "published" && post.spaceId === null ? "xingyu.publish" : "xingyu.draft";
}

export function refreshTokenDecision(
  row: {
    clientId: string;
    revokedAt: number | null;
    usedAt: number | null;
    expiresAt: number;
    absoluteExpiresAt: number;
  } | null,
  clientId: string,
  now: number,
) {
  if (!row || row.clientId !== clientId) return "invalid" as const;
  if (row.revokedAt || row.expiresAt <= now || row.absoluteExpiresAt <= now) return "expired" as const;
  if (row.usedAt) return "reuse" as const;
  return "ok" as const;
}

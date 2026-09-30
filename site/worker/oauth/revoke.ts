import { ensureDatabase } from "@/db/bootstrap";
import { findAccessToken, findRefreshToken, getOAuthClient, hashSecret, revokeRefreshFamily } from "@/db/oauth";
import { getDb } from "@/db";
import { oauthAccessTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { OAuthError, oauthLog } from "./errors";

export async function handleRevoke(request: Request) {
  if (request.method !== "POST") throw new OAuthError("invalid_request", 405, "只支持 POST");
  await ensureDatabase();
  const params = new URLSearchParams(await request.text());
  const token = params.get("token") ?? "";
  const clientId = params.get("client_id") ?? "";
  const client = clientId ? await getOAuthClient(clientId) : null;
  if (clientId && (!client || !client.enabled)) throw new OAuthError("invalid_client", 401, "客户端无效");

  if (token.startsWith("xy_rt_")) {
    const row = await findRefreshToken(await hashSecret(token));
    if (row && (!clientId || row.clientId === clientId)) {
      await revokeRefreshFamily(row.familyId);
      oauthLog("oauth.token.revoked", { client_id: row.clientId, kind: "refresh_family" });
    }
  } else if (token.startsWith("xy_at_")) {
    const row = await findAccessToken(await hashSecret(token));
    if (row && (!clientId || row.clientId === clientId) && !row.revokedAt) {
      await getDb().update(oauthAccessTokens).set({ revokedAt: Math.floor(Date.now() / 1000) })
        .where(eq(oauthAccessTokens.id, row.id));
      oauthLog("oauth.token.revoked", { client_id: row.clientId, kind: "access" });
    }
  }

  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

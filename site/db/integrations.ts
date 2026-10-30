import { and, desc, eq, like, not, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "./index";
import { ensureDatabase } from "./bootstrap";
import { mcpActivity, oauthAccessTokens, oauthClients, oauthConsents, oauthConnectionLabels, userIdentities, users } from "./schema";
import { parseRedirectUris, parseScopeList, revokeConsent } from "./oauth";
import { setConnectionNickname } from "./oauth-connection-registry";
import { sessionLabel } from "@/worker/oauth/account-subject";

export type McpSession = {
  subject: string;
  label: string;
  status: "connected" | "revoked";
  scopes: string[];
  grantedAt: string | null;
  lastUsedAt: string | null;
  tokenCount: number;
  xingyuAccount: string | null;
};

export type McpConnection = {
  id: string;
  name: string;
  kind: "legacy" | "oauth";
  status: "configured" | "connected" | "revoked";
  scopes: string[];
  lastUsedAt: string | null;
  lastUsedLabel: string | null;
  revocable: boolean;
  sessions: McpSession[];
  registeredName?: string;
  redirectHosts?: string[];
};

export { sessionLabel };

export async function listMcpConnections(): Promise<McpConnection[]> {
  await ensureDatabase();
  const now = Math.floor(Date.now() / 1000);
  const [legacyActivity] = await getDb().select({
    createdAt: mcpActivity.createdAt,
    clientLabel: mcpActivity.clientLabel,
  }).from(mcpActivity)
    .where(and(not(like(mcpActivity.clientLabel, "oauth:%")), not(like(mcpActivity.clientLabel, "pat:%"))))
    .orderBy(desc(mcpActivity.createdAt), desc(mcpActivity.id))
    .limit(1);

  const clients = await getDb().select().from(oauthClients).orderBy(oauthClients.id);
  const consents = await getDb().select().from(oauthConsents).orderBy(desc(oauthConsents.grantedAt), desc(oauthConsents.id));
  const usageRows = await getDb().select({
    clientId: oauthAccessTokens.clientId,
    subject: oauthAccessTokens.subject,
    lastUsedAt: sql<number | null>`max(${oauthAccessTokens.lastUsedAt})`.as("last_used_at"),
    tokenCount: sql<number>`sum(case when ${oauthAccessTokens.revokedAt} is null and ${oauthAccessTokens.expiresAt} > ${now} then 1 else 0 end)`.as("token_count"),
  }).from(oauthAccessTokens).groupBy(oauthAccessTokens.clientId, oauthAccessTokens.subject);
  const [nicknames, loginRows] = await Promise.all([
    getDb().select().from(oauthConnectionLabels),
    getDb().select({userId:users.id,name:users.displayName,email:userIdentities.email})
      .from(users).leftJoin(userIdentities,and(eq(userIdentities.userId,users.id),eq(userIdentities.provider,"email"))),
  ]);
  const aliases = new Map(nicknames.map(row=>[row.clientId+"\0"+row.subject,row.label]));
  const accounts = new Map(loginRows.map(row=>["user:"+row.userId,row.email?row.name+" · "+row.email:row.name]));
  const usage = new Map(usageRows.map((row) => [`${row.clientId}\0${row.subject}`, row]));

  // Pre-seeded integrations are available in the connection guide, not as fake "pending connections".
  const oauthConnections = clients.filter(client=>
    !["chatgpt-xingyu","grok-xingyu"].includes(client.clientId)
    || consents.some(item=>item.clientId===client.clientId)
  ).map((client) => {
    const clientConsents = consents.filter((item) => item.clientId === client.clientId);
    const sessions: McpSession[] = clientConsents.map((consent) => {
      const grantedAt = consent.grantedAt ? new Date(consent.grantedAt * 1000).toISOString() : null;
      const used = usage.get(`${client.clientId}\0${consent.subject}`);
      const lastUsedAt = used?.lastUsedAt ? new Date(used.lastUsedAt * 1000).toISOString() : null;
      return {
        subject: consent.subject,
        label: aliases.get(client.clientId+"\0"+consent.subject) ?? sessionLabel(consent.subject, grantedAt),
        status: consent.revokedAt ? "revoked" : "connected",
        scopes: parseScopeList(consent.grantedScopes),
        grantedAt,
        lastUsedAt,
        tokenCount: Number(used?.tokenCount ?? 0),
        xingyuAccount: accounts.get(consent.subject) ?? null,
      };
    });
    const live = sessions.filter((session) => session.status === "connected");
    const latest = live[0] ?? sessions[0];
    const status: McpConnection["status"] = live.length ? "connected" : sessions.length ? "revoked" : "configured";
    return {
      id: client.clientId,
      name: aliases.get(client.clientId+"\0") ?? client.clientName,
      registeredName: client.clientName,
      redirectHosts: [...new Set(parseRedirectUris(client.redirectUris).flatMap(uri=>{
        try{return [new URL(uri).hostname];}catch{return [];}
      }))].slice(0,5),
      kind: "oauth" as const,
      status,
      scopes: latest?.scopes ?? parseScopeList(client.allowedScopes).filter((scope) => scope !== "xingyu.publish"),
      lastUsedAt: live.map((session) => session.lastUsedAt).filter((time):time is string=>Boolean(time)).sort().at(-1) ?? latest?.lastUsedAt ?? null,
      lastUsedLabel: live[0]?.label ?? client.clientId,
      revocable: live.length > 0,
      sessions,
    };
  });

  return [
    {
      id: "legacy-chatgpt",
      name: "ChatGPT · Legacy",
      kind: "legacy",
      // Historical use does not prove whether a legacy environment token is still live.
      status: "configured",
      scopes: ["xingyu.read", "xingyu.draft", "xingyu.publish"],
      lastUsedAt: legacyActivity?.createdAt ?? null,
      lastUsedLabel: legacyActivity?.clientLabel ?? null,
      revocable: false,
      sessions: legacyActivity ? [{
        subject: "legacy",
        label: legacyActivity.clientLabel || "Legacy Token",
        status: "connected",
        scopes: ["xingyu.read", "xingyu.draft", "xingyu.publish"],
        grantedAt: legacyActivity.createdAt,
        lastUsedAt: legacyActivity.createdAt,
        tokenCount: 1,
        xingyuAccount: null,
      }] : [],
    },
    ...oauthConnections,
  ];
}

export async function revokeMcpConnection(clientId: string, subject?: string) {
  if (clientId === "legacy-chatgpt") {
    throw new Error("Legacy Token 不能从这里撤销，请轮换 MCP_WRITE_TOKEN");
  }
  const [client] = await getDb().select({ clientId: oauthClients.clientId }).from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!client) throw new Error("未知的 MCP 客户端");
  const consents = await getDb().select().from(oauthConsents).where(and(eq(oauthConsents.clientId, clientId)));
  const targets = consents.filter((consent) => !consent.revokedAt && (!subject || consent.subject === subject));
  if (!targets.length) throw new Error("该客户端当前没有有效授权");
  for (const consent of targets) await revokeConsent(clientId, consent.subject);
}

/** Renames local display labels. Does NOT modify OAuth client registration
 * metadata and never claims to know the AI provider account. */
export async function renameMcpConnection(clientId:string,subject:string|undefined,label:string){
  if(clientId==="legacy-chatgpt")throw new Error("旧版服务端密钥无法在这里重命名");
  await setConnectionNickname(clientId,subject??"",label);
}

/** Explicit administrator cleanup, never automatic or destructive to active grants.
 * Revoked tokens remain in the token audit tables with their revoked status. */
export async function cleanupInactiveMcpConnections(clientId?:string,subject?:string){
  if(clientId==="legacy-chatgpt")throw new Error("旧版环境密钥不能在这里删除");
  const db=env.DB;
  if(!db)throw new Error("数据库连接不可用");
  if(clientId&&subject){
    const row=await db.prepare("SELECT revoked_at AS revokedAt FROM oauth_consents WHERE client_id=? AND subject=? LIMIT 1")
      .bind(clientId,subject).first<{revokedAt:number|null}>();
    if(!row)throw new Error("授权历史不存在");
    if(row.revokedAt===null)throw new Error("连接仍已授权，请先撤销后再清理");
  }else if(clientId){
    const live=await db.prepare("SELECT 1 FROM oauth_consents WHERE client_id=? AND revoked_at IS NULL LIMIT 1")
      .bind(clientId).first();
    if(live)throw new Error("该客户端仍有有效授权，请先撤销后清理");
  }
  const removed=await db.prepare(
    "DELETE FROM oauth_consents WHERE revoked_at IS NOT NULL "+
    "AND (? IS NULL OR client_id=?) AND (? IS NULL OR subject=?)"
  ).bind(clientId??null,clientId??null,subject??null,subject??null).run();
  // A nickname is only kept while its original consent still exists.
  await db.prepare("DELETE FROM oauth_connection_labels WHERE subject<>'' "+
    "AND NOT EXISTS (SELECT 1 FROM oauth_consents c WHERE c.client_id=oauth_connection_labels.client_id AND c.subject=oauth_connection_labels.subject)"
  ).run();
  const now=Math.floor(Date.now()/1000);
  // First-party registered ChatGPT/Grok callbacks must remain configured.
  // Only self-registered DCR clients with no active sessions or authorization
  // codes can be removed.
  const deleted=await db.prepare(
    "DELETE FROM oauth_clients WHERE client_id LIKE 'xy_dcr_%' AND (? IS NULL OR client_id=?) "+
    "AND NOT EXISTS (SELECT 1 FROM oauth_consents c WHERE c.client_id=oauth_clients.client_id) "+
    "AND NOT EXISTS (SELECT 1 FROM oauth_access_tokens a WHERE a.client_id=oauth_clients.client_id AND a.revoked_at IS NULL AND a.expires_at>?) "+
    "AND NOT EXISTS (SELECT 1 FROM oauth_refresh_tokens r WHERE r.client_id=oauth_clients.client_id AND r.revoked_at IS NULL AND r.used_at IS NULL AND r.expires_at>? AND r.absolute_expires_at>?) "+
    "AND NOT EXISTS (SELECT 1 FROM oauth_authorization_codes a WHERE a.client_id=oauth_clients.client_id AND a.used_at IS NULL AND a.expires_at>?)"
  ).bind(clientId??null,clientId??null,now,now,now,now).run();
  await db.prepare("DELETE FROM oauth_connection_labels WHERE subject='' "+
    "AND NOT EXISTS (SELECT 1 FROM oauth_clients c WHERE c.client_id=oauth_connection_labels.client_id)"
  ).run();
  return {revokedGrants:Number(removed.meta.changes??0),unusedClients:Number(deleted.meta.changes??0)};
}

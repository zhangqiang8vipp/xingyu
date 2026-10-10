import { and, desc, eq, like, not, sql } from "drizzle-orm";
import { getDb } from "./index";
import { ensureDatabase } from "./bootstrap";
import { mcpActivity, oauthAccessTokens, oauthClients, oauthConsents } from "./schema";
import { parseScopeList, revokeConsent } from "./oauth";
import { sessionLabel } from "@/worker/oauth/account-subject";

export type McpSession = {
  subject: string;
  label: string;
  status: "connected" | "revoked";
  scopes: string[];
  grantedAt: string | null;
  lastUsedAt: string | null;
  tokenCount: number;
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
  const usage = new Map(usageRows.map((row) => [`${row.clientId}\0${row.subject}`, row]));

  const oauthConnections = clients.map((client) => {
    const clientConsents = consents.filter((item) => item.clientId === client.clientId);
    const sessions: McpSession[] = clientConsents.map((consent) => {
      const grantedAt = consent.grantedAt ? new Date(consent.grantedAt * 1000).toISOString() : null;
      const used = usage.get(`${client.clientId}\0${consent.subject}`);
      const lastUsedAt = used?.lastUsedAt ? new Date(used.lastUsedAt * 1000).toISOString() : grantedAt;
      return {
        subject: consent.subject,
        label: sessionLabel(consent.subject, grantedAt),
        status: consent.revokedAt ? "revoked" : "connected",
        scopes: parseScopeList(consent.grantedScopes),
        grantedAt,
        lastUsedAt,
        tokenCount: Number(used?.tokenCount ?? 0),
      };
    });
    const live = sessions.filter((session) => session.status === "connected");
    const latest = live[0] ?? sessions[0];
    const status: McpConnection["status"] = live.length ? "connected" : sessions.length ? "revoked" : "configured";
    return {
      id: client.clientId,
      name: client.clientName,
      kind: "oauth" as const,
      status,
      scopes: latest?.scopes ?? parseScopeList(client.allowedScopes).filter((scope) => scope !== "xingyu.publish"),
      lastUsedAt: live.map((session) => session.lastUsedAt).filter(Boolean).sort().at(-1) ?? latest?.lastUsedAt ?? null,
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
      status: legacyActivity ? "connected" : "configured",
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

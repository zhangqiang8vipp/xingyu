import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from ".";
import { ensureDatabase } from "./bootstrap";
import type { McpConnection } from "./integrations";
import { mcpActivity, posts } from "./schema";
import {
  betaActivationStage,
  isPrivateActivationWrite,
  type BetaActivationSignal,
  type BetaActivationWriteAction,
} from "@/domain/admin/activation";

function displayConnectionName(connection: McpConnection) {
  if (connection.kind === "legacy") {
    const cleaned = connection.name.replace(/\s*·\s*Legacy$/iu, "").trim();
    return cleaned || "旧版 AI 连接";
  }
  return connection.name.trim() || "AI 连接";
}

function actorForActivity(clientLabel: string, connections: McpConnection[]) {
  if (clientLabel.startsWith("oauth:")) {
    const connection = connections.find((item) => item.kind === "oauth" && clientLabel === "oauth:" + item.id);
    return connection ? displayConnectionName(connection) : "已连接的 AI";
  }
  if (/chatgpt/i.test(clientLabel)) return "ChatGPT";
  if (/\bgrok\b/i.test(clientLabel)) return "Grok";
  if (/\bclaude\b/i.test(clientLabel)) return "Claude";
  const legacy = connections.find((item) => item.kind === "legacy");
  return legacy ? displayConnectionName(legacy) : "已连接的 AI";
}

function parseChangedFields(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export async function getBetaActivationSignal(connections: McpConnection[]): Promise<BetaActivationSignal> {
  await ensureDatabase();
  const db = getDb();
  const [knowledgeRows, activityRows] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(posts),
    db.select({
      id: mcpActivity.id,
      action: mcpActivity.action,
      postId: mcpActivity.postId,
      publicId: mcpActivity.publicId,
      title: mcpActivity.title,
      afterStatus: mcpActivity.afterStatus,
      changedFields: mcpActivity.changedFields,
      summary: mcpActivity.summary,
      clientLabel: mcpActivity.clientLabel,
      createdAt: mcpActivity.createdAt,
      spaceId: posts.spaceId,
    }).from(mcpActivity)
      .leftJoin(posts, eq(posts.id, mcpActivity.postId))
      .where(inArray(mcpActivity.action, ["create_draft", "update_post"]))
      .orderBy(desc(mcpActivity.createdAt), desc(mcpActivity.id))
      .limit(100),
  ]);

  const privateRow = activityRows.find((row) => isPrivateActivationWrite({
    action: row.action,
    afterStatus: row.afterStatus,
    spaceId: row.spaceId,
  }));
  const connectionNames = [...new Set(
    connections
      .filter((connection) => connection.status === "connected")
      .map(displayConnectionName),
  )];
  const knowledgeCount = Number(knowledgeRows[0]?.value ?? 0);
  const privateWrite = privateRow ? {
    activityId: privateRow.id,
    action: privateRow.action as BetaActivationWriteAction,
    postId: privateRow.postId,
    publicId: privateRow.publicId,
    title: privateRow.title,
    actor: actorForActivity(privateRow.clientLabel, connections),
    summary: privateRow.summary,
    changedFields: parseChangedFields(privateRow.changedFields),
    createdAt: privateRow.createdAt,
  } : null;
  const stage = betaActivationStage({
    knowledgeCount,
    connected: connectionNames.length > 0,
    hasPrivateWrite: Boolean(privateWrite),
  });

  return {
    stage,
    activated: stage === "activated",
    knowledgeCount,
    connected: connectionNames.length > 0,
    connectionNames,
    privateWrite,
  };
}

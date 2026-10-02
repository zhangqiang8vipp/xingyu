import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from ".";
import { ensureDatabase } from "./bootstrap";
import type { McpConnection } from "./integrations";
import { mcpActivity, posts } from "./schema";
import {
  activityActorLabel,
  betaActivationStage,
  displayActivationConnectionName,
  isPrivateActivationWrite,
  type BetaActivationSignal,
  type BetaActivationWriteAction,
} from "@/domain/admin/activation";

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
    db.select({ value: sql<number>`count(*)` }).from(posts)
      .where(isNotNull(posts.spaceId)),
    db.select({
      id: mcpActivity.id,
      action: mcpActivity.action,
      postId: mcpActivity.postId,
      publicId: mcpActivity.publicId,
      title: mcpActivity.title,
      changedFields: mcpActivity.changedFields,
      summary: mcpActivity.summary,
      clientLabel: mcpActivity.clientLabel,
      createdAt: mcpActivity.createdAt,
      spaceId: posts.spaceId,
    }).from(mcpActivity)
      .innerJoin(posts, eq(posts.id, mcpActivity.postId))
      .where(and(
        inArray(mcpActivity.action, ["create_draft", "update_post"]),
        isNotNull(posts.spaceId),
      ))
      .orderBy(desc(mcpActivity.createdAt), desc(mcpActivity.id))
      .limit(100),
  ]);

  const privateRow = activityRows.find((row) => isPrivateActivationWrite({
    action: row.action,
    spaceId: row.spaceId,
  }));
  const connectionNames = [...new Set(
    connections
      .filter((connection) => connection.status === "connected")
      .map(displayActivationConnectionName),
  )];
  const knowledgeCount = Number(knowledgeRows[0]?.value ?? 0);
  const privateWrite = privateRow ? {
    activityId: privateRow.id,
    action: privateRow.action as BetaActivationWriteAction,
    postId: privateRow.postId,
    publicId: privateRow.publicId,
    title: privateRow.title,
    actor: activityActorLabel(privateRow.clientLabel, connections),
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

import { desc } from "drizzle-orm";
import { getDb } from ".";
import { ensureDatabase } from "./bootstrap";
import { mcpActivity } from "./schema";

export type McpActivityAction =
  | "create_draft"
  | "upload_attachment"
  | "update_post"
  | "update_page"
  | "publish_post"
  | "unpublish_post"
  | "create_space"
  | "update_space"
  | "move_space"
  | "delete_space";

type ActivityInput = {
  action: McpActivityAction;
  beforeStatus?: string | null;
  changedFields: string[];
  summary: string;
  clientLabel: string;
};

export type PostWriteAudit = Pick<ActivityInput,
  "action" | "beforeStatus" | "changedFields" | "summary" | "clientLabel">;

export function preparePostWriteActivity(
  d1: D1Database,
  post: { publicId: string; version?: number },
  audit: PostWriteAudit,
  requirePreviousWrite = false,
) {
  return d1.prepare(`INSERT INTO mcp_activity
    (action, post_id, public_id, title, before_status, after_status, changed_fields, summary, client_label)
    SELECT ?, id, public_id, title, ?, status, ?, ?, ? FROM posts
    WHERE public_id = ? ${post.version === undefined ? "" : "AND version = ?"}
    ${requirePreviousWrite ? "AND changes() = 1" : ""}
    RETURNING id, created_at`).bind(
    audit.action, audit.beforeStatus ?? null, JSON.stringify(audit.changedFields),
    audit.summary, audit.clientLabel, post.publicId,
    ...(post.version === undefined ? [] : [post.version]),
  );
}

export type SpaceWriteAudit = {
  action: Extract<McpActivityAction, "create_space" | "update_space" | "move_space" | "delete_space">;
  changedFields: string[];
  summary: string;
  clientLabel: string;
  beforeParentId?: number | null;
  afterParentId?: number | null;
};

export function prepareSpaceWriteActivity(
  d1: D1Database,
  space: { id?: number; name: string },
  audit: SpaceWriteAudit,
) {
  // A failed/conditional space write must abort the batch, including earlier
  // child/article moves. post_id is NOT NULL, so a zero-row write fails here.
  const idExpression = space.id === undefined ? "last_insert_rowid()" : "?";
  return d1.prepare(`INSERT INTO mcp_activity
    (action, post_id, public_id, title, before_status, after_status, changed_fields, summary, client_label)
    SELECT ?, guarded.id, 'space:' || CAST(guarded.id AS INTEGER), ?, ?, ?, ?, ?, ?
    FROM (SELECT CASE WHEN changes() >= 1 THEN ${idExpression} ELSE NULL END AS id) guarded
    RETURNING id, created_at`).bind(
    audit.action, space.name,
    audit.beforeParentId === undefined ? null : `parent:${audit.beforeParentId ?? "root"}`,
    audit.afterParentId === undefined ? null : `parent:${audit.afterParentId ?? "root"}`,
    JSON.stringify(audit.changedFields), audit.summary, audit.clientLabel,
    ...(space.id === undefined ? [] : [space.id]),
  );
}

export async function listMcpActivity(limit: number) {
  await ensureDatabase();
  const rows = await getDb().select().from(mcpActivity)
    .orderBy(desc(mcpActivity.createdAt), desc(mcpActivity.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    resource_type: row.publicId.startsWith("page:")
      ? "page"
      : row.publicId.startsWith("space:")
        ? "space"
        : row.publicId.startsWith("attachment:")
          ? "attachment"
        : "post",
    public_id: row.publicId,
    title: row.title,
    before_status: row.beforeStatus,
    after_status: row.afterStatus,
    changed_fields: parseChangedFields(row.changedFields),
    summary: row.summary,
    client: row.clientLabel,
    created_at: row.createdAt,
  }));
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

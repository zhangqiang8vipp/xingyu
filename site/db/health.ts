/**
 * 站点健康探测（纯模块）：只读、单语句查询，便于经 harness 的 bridge D1 测试。
 * 16 项核心关系审计与 drizzle/verify-core-relations.sql 的列名保持一致，
 * 供管理员诊断端点与 Cron 健康门禁共用。
 */

export interface SiteHealth {
  schema: {
    /** 代码期望的 schema 版本。 */
    code: string;
    /** app_meta 中实际存储的 schema_version。 */
    database: string | null;
    /** app_meta 中实际存储的 app_environment。 */
    environment: string | null;
  };
  /** d1_migrations 表中已应用的迁移数；表不存在时为 null（legacy 引导模式）。 */
  migrations: number | null;
  /** 16 项核心关系审计计数，键名与 verify-core-relations.sql 列名一致。 */
  audit: Record<string, number>;
  queue: { pendingCleanup: number };
  ownerPresent: boolean;
  counts: { posts: number; published: number; drafts: number; attachments: number; ftsRows: number };
  generatedAt: string;
}

/** [审计键, 单语句 SQL]，顺序与 verify-core-relations.sql 完全一致。 */
const AUDIT_CHECKS: ReadonlyArray<readonly [string, string]> = [
  ["posts_missing_category", `SELECT COUNT(*) AS n FROM posts p LEFT JOIN categories c ON c.id = p.category_id
   WHERE c.id IS NULL`],
  ["posts_missing_space", `SELECT COUNT(*) AS n FROM posts p LEFT JOIN spaces s ON s.id = p.space_id
   WHERE p.space_id IS NOT NULL AND s.id IS NULL`],
  ["spaces_missing_parent", `SELECT COUNT(*) AS n FROM spaces s LEFT JOIN spaces parent ON parent.id = s.parent_id
   WHERE s.parent_id IS NOT NULL AND parent.id IS NULL`],
  ["spaces_unreachable_from_root", `WITH RECURSIVE rooted_spaces(id) AS (
  SELECT id FROM spaces WHERE parent_id IS NULL
  UNION
  SELECT child.id FROM spaces child JOIN rooted_spaces parent ON child.parent_id = parent.id
)
SELECT COUNT(*) AS n FROM spaces s LEFT JOIN rooted_spaces rooted ON rooted.id = s.id
 WHERE rooted.id IS NULL`],
  ["history_missing_post", `SELECT COUNT(*) AS n FROM post_slug_history h LEFT JOIN posts p ON p.id = h.post_id
   WHERE p.id IS NULL`],
  ["history_conflicts_current_slug", `SELECT COUNT(*) AS n FROM post_slug_history h JOIN posts p ON p.slug = h.slug
   WHERE p.id <> h.post_id`],
  ["attachments_missing_post", `SELECT COUNT(*) AS n FROM attachments a LEFT JOIN posts p ON p.id = a.post_id
   WHERE a.post_id IS NOT NULL AND p.id IS NULL`],
  ["preview_tokens_missing_post", `SELECT COUNT(*) AS n FROM post_preview_tokens t LEFT JOIN posts p ON p.id = t.post_id
   WHERE p.id IS NULL`],
  ["views_missing_post", `SELECT COUNT(*) AS n FROM post_views v LEFT JOIN posts p ON p.id = v.post_id
   WHERE p.id IS NULL`],
  ["codes_missing_oauth_client", `SELECT COUNT(*) AS n FROM oauth_authorization_codes code LEFT JOIN oauth_clients client
   ON client.client_id = code.client_id WHERE client.client_id IS NULL`],
  ["access_tokens_missing_oauth_client", `SELECT COUNT(*) AS n FROM oauth_access_tokens token LEFT JOIN oauth_clients client
   ON client.client_id = token.client_id WHERE client.client_id IS NULL`],
  ["refresh_tokens_missing_oauth_client", `SELECT COUNT(*) AS n FROM oauth_refresh_tokens token LEFT JOIN oauth_clients client
   ON client.client_id = token.client_id WHERE client.client_id IS NULL`],
  ["consents_missing_oauth_client", `SELECT COUNT(*) AS n FROM oauth_consents consent LEFT JOIN oauth_clients client
   ON client.client_id = consent.client_id WHERE client.client_id IS NULL`],
  ["posts_missing_author", `SELECT COUNT(*) AS n FROM posts WHERE author_id IS NULL`],
  ["identities_missing_user", `SELECT COUNT(*) AS n FROM user_identities identity LEFT JOIN users u ON u.id = identity.user_id
   WHERE u.id IS NULL`],
  ["memberships_missing_user", `SELECT COUNT(*) AS n FROM site_memberships m LEFT JOIN users u ON u.id = m.user_id
   WHERE u.id IS NULL`],
];

async function describeMigrations(db: D1Database): Promise<number | null> {
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations' LIMIT 1")
    .first<{ name: string }>();
  if (!table) return null;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function collectSiteHealth(db: D1Database, expectedSchemaVersion: string): Promise<SiteHealth> {
  const [meta, migrations, queue, owner, counts, ...auditRows] = await Promise.all([
    db.prepare("SELECT key, value FROM app_meta WHERE key IN ('schema_version', 'app_environment')")
      .all<{ key: string; value: string }>(),
    describeMigrations(db),
    db.prepare("SELECT COUNT(*) AS n FROM attachment_cleanup_queue WHERE status = 'pending'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM site_memberships WHERE role = 'owner'").first<{ n: number }>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM posts) AS posts,
      (SELECT COUNT(*) FROM posts WHERE status = 'published') AS published,
      (SELECT COUNT(*) FROM posts WHERE status = 'draft') AS drafts,
      (SELECT COUNT(*) FROM attachments) AS attachments,
      (SELECT COUNT(*) FROM posts_fts) AS ftsRows`).first<{ posts: number; published: number; drafts: number; attachments: number; ftsRows: number }>(),
    ...AUDIT_CHECKS.map(([name, sql]) =>
      db.prepare(sql).first<{ n: number }>().then((row) => [name, Number(row?.n ?? 0)] as const)),
  ]);
  const metaMap = new Map((meta.results ?? []).map((row) => [row.key, row.value]));
  const audit: Record<string, number> = Object.fromEntries(auditRows);
  return {
    schema: {
      code: expectedSchemaVersion,
      database: metaMap.get("schema_version") ?? null,
      environment: metaMap.get("app_environment") ?? null,
    },
    migrations,
    audit,
    queue: { pendingCleanup: Number(queue?.n ?? 0) },
    ownerPresent: Number(owner?.n ?? 0) > 0,
    counts: {
      posts: Number(counts?.posts ?? 0),
      published: Number(counts?.published ?? 0),
      drafts: Number(counts?.drafts ?? 0),
      attachments: Number(counts?.attachments ?? 0),
      ftsRows: Number(counts?.ftsRows ?? 0),
    },
    generatedAt: new Date().toISOString(),
  };
}
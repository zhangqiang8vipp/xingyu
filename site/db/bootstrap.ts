import { env } from "cloudflare:workers";
import { DEFAULT_ABOUT_PAGE, DEFAULT_CONNECT_PAGE, DEFAULT_SITE_SETTINGS } from "@/domain/site/config";
import { createPostPublicId } from "./public-id";
import { PUBLIC_CACHE_SCHEMA_STATEMENTS } from "./public-cache-schema";
import { WORKSPACE_GUARD_TRIGGERS } from "./workspace-guards";
import { WORKSPACE_INVITATION_DDL, COLLABORATION_GUARDS } from "./workspace-collaboration-schema";
import { ORGANIZATION_DDL, ORGANIZATION_GUARDS } from "./organization-schema";
import { assertStoredInstanceIdentity, requireRuntimeInstanceIdentity } from "./instance-identity";

let ready: Promise<void> | null = null;

/** 当前 worker 期望的 D1 schema 版本，供健康检查与迁移门禁共用。 */
export const schemaVersion = "23";

const requiredUniqueIndexes = {
  attachments_object_key_uidx: { table: "attachments", columns: ["object_key"] },
  attachments_public_id_uidx: { table: "attachments", columns: ["public_id"] },
  attachment_cleanup_queue_object_key_uidx: { table: "attachment_cleanup_queue", columns: ["object_key"] },
  categories_slug_uidx: { table: "categories", columns: ["slug"] },
  content_pages_slug_uidx: { table: "content_pages", columns: ["slug"] },
  oauth_access_tokens_hash_uidx: { table: "oauth_access_tokens", columns: ["token_hash"] },
  oauth_authorization_codes_hash_uidx: { table: "oauth_authorization_codes", columns: ["code_hash"] },
  oauth_clients_client_id_uidx: { table: "oauth_clients", columns: ["client_id"] },
  oauth_consents_subject_client_resource_uidx: { table: "oauth_consents", columns: ["subject", "client_id", "resource"] },
  oauth_refresh_tokens_hash_uidx: { table: "oauth_refresh_tokens", columns: ["token_hash"] },
  post_preview_tokens_hash_uidx: { table: "post_preview_tokens", columns: ["token_hash"] },
  post_slug_history_slug_uidx: { table: "post_slug_history", columns: ["slug"] },
  posts_public_id_uidx: { table: "posts", columns: ["public_id"] },
  posts_slug_uidx: { table: "posts", columns: ["slug"] },
  site_memberships_user_id_uidx: { table: "site_memberships", columns: ["user_id"] },
  spaces_parent_slug_uidx: { table: "spaces", columns: ["parent_id", "slug"] },
  spaces_root_slug_uidx: { table: "spaces", columns: ["slug"] },
  user_identities_provider_subject_uidx: { table: "user_identities", columns: ["provider", "subject"] },
  workspaces_slug_uidx: { table: "workspaces", columns: ["slug"] },
  organizations_slug_uidx: { table: "organizations", columns: ["slug"] },
  organization_invitations_token_uidx: { table: "organization_invitations", columns: ["token_hash"] },
  organization_invitations_pending_uidx: { table: "organization_invitations", columns: ["organization_id", "email"] },
  organization_units_sibling_uidx: { table: "organization_units", columns: ["organization_id", "parent_id", "name"] },
  organization_units_root_uidx: { table: "organization_units", columns: ["organization_id", "name"] },
  workspace_invitations_token_uidx: { table: "workspace_invitations", columns: ["token_hash"] },
  workspace_invitations_pending_uidx: { table: "workspace_invitations", columns: ["workspace_id", "email"] },
} as const;

const requiredMigrationObjects = {
  table: [
    "admin_login_attempts", "app_meta", "attachment_cleanup_queue", "attachments", "categories",
    "content_pages", "email_verifications", "identity_login_limits", "mcp_activity", "oauth_access_tokens", "oauth_authorization_codes", "oauth_clients",
    "oauth_consents", "oauth_rate_limits", "oauth_refresh_tokens", "post_preview_tokens",
    "post_slug_history", "post_views", "posts", "posts_fts", "public_cache_state", "site_memberships", "site_settings", "spaces", "user_credentials", "user_identities", "user_sessions", "users", "view_request_limits", "workspaces", "workspace_memberships", "workspace_invitations", "organizations", "organization_memberships", "organization_invitations", "organization_units", "organization_unit_memberships",
  ],
  index: [...Object.keys(requiredUniqueIndexes), "workspace_memberships_user_idx", "workspace_invitations_workspace_idx", "organization_memberships_user_idx", "organization_invitations_org_idx", "organization_units_tree_idx", "organization_unit_memberships_user_idx", "email_verifications_user_idx", "posts_workspace_updated_idx", "spaces_workspace_parent_idx", "attachments_workspace_idx", "categories_workspace_idx", "mcp_workspace_activity_idx"],
  trigger: [
    "posts_public_id_required_insert", "posts_public_id_required_update",
    "workspace_member_role_guard_insert", "workspace_member_role_guard_update", "workspace_owner_delete_guard",
    "org_membership_insert_guard", "org_membership_update_guard", "org_owner_membership_delete_guard", "org_member_units_cleanup",
    "org_unit_insert_guard", "org_unit_update_guard", "org_unit_delete_guard", "org_unit_member_insert_guard", "org_unit_member_update_guard",
    "posts_workspace_insert_guard", "posts_workspace_update_guard", "spaces_workspace_insert_guard", "spaces_workspace_update_guard", "attachments_workspace_insert_guard", "attachments_workspace_update_guard",
    "posts_history_slug_guard_insert", "posts_history_slug_guard_update",
    "history_current_slug_guard_insert", "history_current_slug_guard_update",
    "posts_fts_insert", "posts_fts_delete", "posts_fts_update",
    "public_cache_posts_insert", "public_cache_posts_delete", "public_cache_posts_update",
    "public_cache_categories_insert", "public_cache_categories_update", "public_cache_categories_delete",
    "public_cache_settings_update", "public_cache_pages_insert", "public_cache_pages_update",
    "public_cache_pages_delete",
  ],
} as const;

export function ensureDatabase() {
  // Reuse schema initialization inside a worker, but allow recovery after a transient D1 failure.
  ready ??= initialize().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

async function initialize() {
  const d1 = env.DB;
  if (!d1) throw new Error("D1 binding DB is unavailable");
  const runtimeIdentity = requireRuntimeInstanceIdentity(
    env.APP_ENV,
    (env as Env & { INSTANCE_ID?: string }).INSTANCE_ID,
  );
  const runtimeEnvironment = runtimeIdentity.environment;
  const schemaMode = env.DB_SCHEMA_MODE ?? "legacy-bootstrap";
  const localPreviewBootstrap = schemaMode === "local-preview-bootstrap" && runtimeEnvironment === "production";
  if (schemaMode === "migration-only") {
    const markers = await d1.prepare("SELECT key, value FROM app_meta WHERE key IN ('schema_version', 'app_environment', 'instance_id')")
      .all<{ key: string; value: string }>();
    const values = new Map((markers.results ?? []).map((row) => [row.key, row.value]));
    if (values.get("schema_version") !== schemaVersion) {
      throw new Error(`D1 schema version mismatch: expected ${schemaVersion}, found ${values.get("schema_version") ?? "missing"}`);
    }
    assertStoredInstanceIdentity(runtimeIdentity, values);
    const objects = await d1.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view')")
      .all<{ type: string; name: string; tbl_name: string; sql: string | null }>();
    const actual = new Set((objects.results ?? []).map(({ type, name }) => `${type}:${name}`));
    const missing = Object.entries(requiredMigrationObjects).flatMap(([type, names]) =>
      names.filter((name) => !actual.has(`${type}:${name}`)).map((name) => `${type}:${name}`));
    if (missing.length > 0) {
      throw new Error(`D1 schema is incomplete for version ${schemaVersion}: ${missing.join(", ")}`);
    }
    const ftsDefinition = (objects.results ?? []).find(({ type, name }) => type === "table" && name === "posts_fts")?.sql
      ?.replace(/[`"\[\]]/g, "").replace(/\s+/g, " ").trim() ?? "";
    if (!/^CREATE VIRTUAL TABLE (?:IF NOT EXISTS )?posts_fts USING fts5\s*\(/i.test(ftsDefinition)
      || !/\bcontent\s*=\s*'posts'/i.test(ftsDefinition)
      || !/\bcontent_rowid\s*=\s*'id'/i.test(ftsDefinition)
      || !/\btokenize\s*=\s*'trigram'/i.test(ftsDefinition)) {
      throw new Error("D1 posts_fts is not the required content-linked FTS5 index");
    }
    const postColumns = await d1.prepare("PRAGMA table_info(posts)")
      .all<{ name: string; type: string; notnull: number; dflt_value: string | null }>();
    const versionColumn = (postColumns.results ?? []).find(({ name }) => name === "version");
    if (!versionColumn || versionColumn.type.toUpperCase() !== "INTEGER"
      || versionColumn.notnull !== 1 || Number(versionColumn.dflt_value) !== 1) {
      throw new Error("D1 posts.version is missing or incompatible with optimistic writes");
    }
    const orderColumn = (postColumns.results ?? []).find(({ name }) => name === "sort_order");
    if (!orderColumn || orderColumn.type.toUpperCase() !== "INTEGER"
      || orderColumn.notnull !== 1 || Number(orderColumn.dflt_value) !== 0) {
      throw new Error("D1 posts.sort_order is missing or incompatible with browsing order");
    }
    const nonUnique = (objects.results ?? []).filter(({ type, name, sql: definition }) =>
      type === "index" && Object.hasOwn(requiredUniqueIndexes,name)
      && !/^CREATE\s+UNIQUE\s+INDEX\b/i.test(definition ?? ""));
    if (nonUnique.length > 0) {
      throw new Error(`D1 schema has non-unique required indexes: ${nonUnique.map(({ name }) => name).join(", ")}`);
    }
    const indexTables = new Map((objects.results ?? [])
      .filter(({ type }) => type === "index")
      .map(({ name, tbl_name }) => [name, tbl_name]));
    const wrongTables = Object.entries(requiredUniqueIndexes).filter(([name, { table }]) =>
      indexTables.get(name) !== table);
    if (wrongTables.length > 0) {
      throw new Error(`D1 schema has required indexes on the wrong tables: ${wrongTables.map(([name]) => name).join(", ")}`);
    }
    const requiredIndexNames = requiredMigrationObjects.index;
    const indexColumns = await d1.prepare(`SELECT schema_index.name AS index_name,
      info.seqno AS position, info.name AS column_name
      FROM sqlite_master schema_index JOIN pragma_index_info(schema_index.name) info
      WHERE schema_index.type = 'index'
        AND schema_index.name IN (${requiredIndexNames.map(() => "?").join(", ")})
      ORDER BY schema_index.name, info.seqno`).bind(...requiredIndexNames)
      .all<{ index_name: string; position: number; column_name: string | null }>();
    const actualIndexColumns = new Map<string, (string | null)[]>();
    for (const row of indexColumns.results ?? []) {
      const columns = actualIndexColumns.get(row.index_name) ?? [];
      columns.push(row.column_name);
      actualIndexColumns.set(row.index_name, columns);
    }
    const wrongColumns = Object.entries(requiredUniqueIndexes).filter(([name, { columns }]) =>
      JSON.stringify(actualIndexColumns.get(name)) !== JSON.stringify(columns));
    if (wrongColumns.length > 0) {
      throw new Error(`D1 schema has required indexes on the wrong columns: ${wrongColumns.map(([name]) => name).join(", ")}`);
    }
    const misplacedPredicates = (objects.results ?? []).filter(({ type, name, sql: definition }) => {
      if (type !== "index" || !requiredIndexNames.includes(name)) return false;
      const normalized = (definition ?? "").replace(/["`\[\]]/g, "").replace(/\s+/g, " ").trim();
      if (name === "spaces_root_slug_uidx") return !/\bWHERE\s+spaces\.parent_id\s+IS\s+NULL\s*;?$/i.test(normalized);
      if (name === "workspace_invitations_pending_uidx") return !/\bWHERE\s+(?:workspace_invitations\.)?accepted_at\s+IS\s+NULL\s+AND\s+(?:workspace_invitations\.)?revoked_at\s+IS\s+NULL\s*;?$/i.test(normalized);
      if (name === "organization_invitations_pending_uidx") return !/\bWHERE\s+(?:organization_invitations\.)?accepted_at\s+IS\s+NULL\s+AND\s+(?:organization_invitations\.)?revoked_at\s+IS\s+NULL\s*;?$/i.test(normalized);
      if (name === "organization_units_root_uidx") return !/\bWHERE\s+(?:organization_units\.)?parent_id\s+IS\s+NULL\s*;?$/i.test(normalized);
      return /\bWHERE\b/i.test(normalized);
    });
    if (misplacedPredicates.length > 0) {
      throw new Error(`D1 schema has required indexes with wrong predicates: ${misplacedPredicates.map(({ name }) => name).join(", ")}`);
    }
    const requiredData = await d1.prepare(`SELECT
      (SELECT COUNT(*) FROM site_settings WHERE id = 1) AS settings_count,
      (SELECT COUNT(*) FROM categories) AS category_count,
      (SELECT COUNT(*) FROM content_pages WHERE slug IN ('about', 'connect')) AS page_count,
      (SELECT COUNT(*) FROM public_cache_state WHERE id = 1) AS cache_count,
      (SELECT COUNT(*) FROM site_memberships WHERE role = 'owner') AS owner_count,
      (SELECT COUNT(*) FROM user_identities WHERE provider = 'email' AND subject = 'zhangqiang8vip@gmail.com' AND user_id = 1) AS owner_email_count,
      (SELECT COUNT(*) FROM workspace_memberships WHERE workspace_id = 1 AND user_id = 1 AND role = 'owner') AS owner_workspace_count`).first<{
        settings_count: number; category_count: number; page_count: number; cache_count: number; owner_count: number; owner_email_count: number; owner_workspace_count: number;
      }>();
    if (!requiredData || requiredData.settings_count !== 1 || requiredData.category_count < 1
      || requiredData.page_count !== 2 || requiredData.cache_count !== 1 || requiredData.owner_count < 1 || requiredData.owner_email_count !== 1 || requiredData.owner_workspace_count !== 1) {
      throw new Error(`D1 required data is incomplete for version ${schemaVersion}`);
    }
    return;
  }
  if (schemaMode !== "legacy-bootstrap" && !localPreviewBootstrap) {
    throw new Error(`Unsupported D1 schema mode: ${schemaMode}`);
  }

  const metadataTable = await d1.prepare("SELECT name FROM sqlite_master WHERE name = 'app_meta' LIMIT 1")
    .first<{ name: string }>();
  if (!metadataTable) {
    const existingApplicationTable = await d1.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
        AND name <> 'd1_migrations'
      LIMIT 1`).first<{ name: string }>();
    if (existingApplicationTable) {
      throw new Error(`D1 instance identity is missing; refusing to claim non-empty database containing ${existingApplicationTable.name}`);
    }
  }
  if (runtimeEnvironment === "production" && !localPreviewBootstrap && !metadataTable) {
    throw new Error("Production D1 has no schema marker; run and verify migrations before deploying this worker");
  }
  if (metadataTable) {
    const markers = await d1.prepare("SELECT key, value FROM app_meta WHERE key IN ('schema_version', 'app_environment', 'instance_id')")
      .all<{ key:string; value:string }>();
    const values = new Map((markers.results ?? []).map((row) => [row.key, row.value]));
    assertStoredInstanceIdentity(runtimeIdentity, values);
    const storedVersion = values.get("schema_version");
    if (runtimeEnvironment === "production" && !localPreviewBootstrap && storedVersion !== schemaVersion) {
      throw new Error(`Production D1 schema version mismatch: expected ${schemaVersion}, found ${storedVersion ?? "missing"}; explicit migration is required`);
    }
    if (storedVersion && (!/^\d+$/.test(storedVersion)
      || !Number.isSafeInteger(Number(storedVersion))
      || Number(storedVersion) > Number(schemaVersion))) {
      throw new Error(`D1 schema version ${storedVersion} is newer than or incompatible with worker version ${schemaVersion}`);
    }
    if (storedVersion && Number(storedVersion) < 18) {
      const legacyObjects = await d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('posts', 'post_slug_history')")
        .all<{ name: string }>();
      if ((legacyObjects.results ?? []).length === 2) {
        const conflict = await d1.prepare(`SELECT 1 FROM post_slug_history history
          JOIN posts current ON current.slug = history.slug AND current.id <> history.post_id
          LIMIT 1`).first();
        if (conflict) throw new Error("D1 historical Slug conflicts with another current article; audit data before upgrading schema");
      }
    }
    if (storedVersion === schemaVersion) return;
  }

  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#0071e3',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      category_id INTEGER NOT NULL,
      space_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      featured INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY,
      brand_name TEXT NOT NULL DEFAULT '星屿',
      brand_latin TEXT NOT NULL DEFAULT 'XINGYU',
      author_name TEXT NOT NULL DEFAULT '星屿',
      avatar_url TEXT NOT NULL DEFAULT '/images/xingyu-avatar.jpg',
      tagline TEXT NOT NULL DEFAULT '设计 · 技术 · 生活',
      description TEXT NOT NULL DEFAULT '记录那些值得慢下来思考的设计、技术与生活片段。',
      hero_lead TEXT NOT NULL DEFAULT '在喧嚣之外，',
      hero_tail TEXT NOT NULL DEFAULT '留一座思考的岛。',
      home_section_title TEXT NOT NULL DEFAULT '最近在写',
      home_about_title TEXT NOT NULL DEFAULT '你好，这里是星屿。',
      home_about_copy TEXT NOT NULL DEFAULT '一座关于设计、技术与生活的数字岛屿。希望每篇文章，都能给你留下一点值得带走的东西。',
      footer_text TEXT NOT NULL DEFAULT '保持好奇，持续创造。',
      seo_title TEXT NOT NULL DEFAULT '星屿 · 思考与创造',
      seo_description TEXT NOT NULL DEFAULT '星屿个人博客，记录设计、技术与生活。',
      home_post_limit INTEGER NOT NULL DEFAULT 9,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS content_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      eyebrow TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS post_views (
      post_id INTEGER NOT NULL,
      visitor_hash TEXT NOT NULL,
      viewed_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, visitor_hash, viewed_on)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS post_slug_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS mcp_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      post_id INTEGER NOT NULL,
      public_id TEXT NOT NULL,
      title TEXT NOT NULL,
      before_status TEXT,
      after_status TEXT,
      changed_fields TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      client_label TEXT NOT NULL DEFAULT 'remote-mcp',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      post_id INTEGER,
      object_key TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unbound_at TEXT
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS attachment_cleanup_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT,
      object_key TEXT NOT NULL UNIQUE,
      operation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS post_preview_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      last_viewed_at TEXT,
      view_count INTEGER NOT NULL DEFAULT 0
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_uidx ON categories(slug)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS spaces_parent_slug_uidx ON spaces(parent_id, slug)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS spaces_root_slug_uidx ON spaces(slug) WHERE parent_id IS NULL"),
    d1.prepare("CREATE INDEX IF NOT EXISTS spaces_parent_sort_idx ON spaces(parent_id, sort_order, id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS spaces_updated_idx ON spaces(updated_at DESC, id DESC)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS posts_slug_uidx ON posts(slug)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS content_pages_slug_uidx ON content_pages(slug)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS posts_status_published_idx ON posts(status, published_at DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS posts_archive_cursor_idx ON posts(status, published_at DESC, id DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS posts_category_status_idx ON posts(category_id, status)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS posts_category_archive_cursor_idx ON posts(category_id, status, published_at DESC, id DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS posts_updated_idx ON posts(updated_at DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS posts_admin_cursor_idx ON posts(updated_at DESC, id DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS post_views_date_idx ON post_views(viewed_on)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS post_slug_history_post_idx ON post_slug_history(post_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS mcp_activity_created_idx ON mcp_activity(created_at DESC, id DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS mcp_activity_post_idx ON mcp_activity(post_id, id DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS attachments_post_created_idx ON attachments(post_id, created_at DESC, id DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS attachment_cleanup_queue_status_idx ON attachment_cleanup_queue(status, created_at, id)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS post_preview_tokens_hash_uidx ON post_preview_tokens(token_hash)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS post_preview_tokens_post_idx ON post_preview_tokens(post_id, expires_at DESC, id DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS post_preview_tokens_expiry_idx ON post_preview_tokens(expires_at)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS admin_login_attempts (
      identifier TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      window_started INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL DEFAULT '星屿管理员',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS user_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT,
      name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS site_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS user_identities_provider_subject_uidx ON user_identities(provider, subject)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities(user_id)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS site_memberships_user_id_uidx ON site_memberships(user_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS site_memberships_role_idx ON site_memberships(role)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS user_credentials (user_id INTEGER PRIMARY KEY NOT NULL, password_hash TEXT, legacy_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS user_sessions (session_hash TEXT PRIMARY KEY NOT NULL, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS user_sessions_user_expiry_idx ON user_sessions(user_id, expires_at)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS identity_login_limits (identifier TEXT PRIMARY KEY NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, window_started INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,kind TEXT NOT NULL DEFAULT 'personal',owner_user_id INTEGER NOT NULL,slug TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_uidx ON workspaces(slug)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS workspace_memberships (workspace_id INTEGER NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL DEFAULT 'owner',status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(workspace_id,user_id))"),
    d1.prepare("CREATE INDEX IF NOT EXISTS workspace_memberships_user_idx ON workspace_memberships(user_id,workspace_id)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS email_verifications (token_hash TEXT PRIMARY KEY NOT NULL,purpose TEXT NOT NULL DEFAULT 'verify_email',user_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications(user_id,expires_at)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS view_request_limits (
      identity_hash TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      window_started INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS oauth_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL UNIQUE,
      client_name TEXT NOT NULL,
      client_type TEXT NOT NULL DEFAULT 'public',
      client_secret_hash TEXT,
      redirect_uris TEXT NOT NULL DEFAULT '[]',
      allowed_scopes TEXT NOT NULL,
      token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      resource TEXT NOT NULL,
      scope TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256',
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      resource TEXT NOT NULL,
      scope TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_used_at INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      family_id TEXT NOT NULL,
      parent_token_id INTEGER,
      client_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      resource TEXT NOT NULL,
      scope TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      absolute_expires_at INTEGER NOT NULL,
      used_at INTEGER,
      revoked_at INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS oauth_consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      client_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      granted_scopes TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      revoked_at INTEGER
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS oauth_rate_limits (
      identifier TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      window_started INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expiry_idx ON oauth_authorization_codes(expires_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS oauth_access_tokens_client_idx ON oauth_access_tokens(client_id, subject, expires_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_family_idx ON oauth_refresh_tokens(family_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_client_idx ON oauth_refresh_tokens(client_id, subject)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS oauth_consents_subject_client_resource_uidx ON oauth_consents(subject, client_id, resource)"),
    ...WORKSPACE_INVITATION_DDL.map((statement) => d1.prepare(statement)),
    ...ORGANIZATION_DDL.map((statement) => d1.prepare(statement)),
    d1.prepare("CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(title, excerpt, content, content='posts', content_rowid='id', tokenize='trigram')"),
    d1.prepare(`CREATE TRIGGER IF NOT EXISTS posts_fts_insert AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, title, excerpt, content) VALUES (new.id, new.title, new.excerpt, new.content);
    END`),
    d1.prepare(`CREATE TRIGGER IF NOT EXISTS posts_fts_delete AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content) VALUES ('delete', old.id, old.title, old.excerpt, old.content);
    END`),
    d1.prepare(`CREATE TRIGGER IF NOT EXISTS posts_fts_update AFTER UPDATE OF title, excerpt, content ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content) VALUES ('delete', old.id, old.title, old.excerpt, old.content);
      INSERT INTO posts_fts(rowid, title, excerpt, content) VALUES (new.id, new.title, new.excerpt, new.content);
    END`),
    d1.prepare(`CREATE TRIGGER IF NOT EXISTS posts_history_slug_guard_insert AFTER INSERT ON posts
      WHEN EXISTS (SELECT 1 FROM post_slug_history WHERE slug = NEW.slug AND post_id <> NEW.id)
      BEGIN SELECT RAISE(ABORT, 'slug reserved by another post history'); END`),
    d1.prepare(`CREATE TRIGGER IF NOT EXISTS posts_history_slug_guard_update AFTER UPDATE OF slug ON posts
      WHEN EXISTS (SELECT 1 FROM post_slug_history WHERE slug = NEW.slug AND post_id <> NEW.id)
      BEGIN SELECT RAISE(ABORT, 'slug reserved by another post history'); END`),
    d1.prepare(`CREATE TRIGGER IF NOT EXISTS history_current_slug_guard_insert AFTER INSERT ON post_slug_history
      WHEN EXISTS (SELECT 1 FROM posts WHERE slug = NEW.slug AND id <> NEW.post_id)
      BEGIN SELECT RAISE(ABORT, 'historical slug conflicts with another current post'); END`),
    d1.prepare(`CREATE TRIGGER IF NOT EXISTS history_current_slug_guard_update AFTER UPDATE OF slug, post_id ON post_slug_history
      WHEN EXISTS (SELECT 1 FROM posts WHERE slug = NEW.slug AND id <> NEW.post_id)
      BEGIN SELECT RAISE(ABORT, 'historical slug conflicts with another current post'); END`),
    ...PUBLIC_CACHE_SCHEMA_STATEMENTS.map((statement)=>d1.prepare(statement)),
  ]);

  const postColumns = await d1.prepare("PRAGMA table_info(posts)").all<{ name: string }>();
  if (!(postColumns.results ?? []).some((column) => column.name === "public_id")) {
    await d1.prepare("ALTER TABLE posts ADD COLUMN public_id TEXT").run();
  }
  if (!(postColumns.results ?? []).some((column) => column.name === "space_id")) {
    await d1.prepare("ALTER TABLE posts ADD COLUMN space_id INTEGER").run();
  }
  if (!(postColumns.results ?? []).some((column) => column.name === "version")) {
    await d1.prepare("ALTER TABLE posts ADD COLUMN version INTEGER NOT NULL DEFAULT 1").run();
  }
  if (!(postColumns.results ?? []).some((column) => column.name === "sort_order")) {
    await d1.prepare("ALTER TABLE posts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0").run();
  }
  for (const table of ["categories", "spaces", "posts", "attachments", "mcp_activity"] as const) {
    const columns = await d1.prepare("PRAGMA table_info(" + table + ")").all<{ name: string }>();
    if (!(columns.results ?? []).some((column) => column.name === "workspace_id")) {
      await d1.prepare("ALTER TABLE " + table + " ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1").run();
    }
  }
  for (const statement of [
    "CREATE INDEX IF NOT EXISTS posts_workspace_updated_idx ON posts(workspace_id,updated_at,id)",
    "CREATE INDEX IF NOT EXISTS spaces_workspace_parent_idx ON spaces(workspace_id,parent_id,id)",
    "CREATE INDEX IF NOT EXISTS attachments_workspace_idx ON attachments(workspace_id,post_id)",
    "CREATE INDEX IF NOT EXISTS categories_workspace_idx ON categories(workspace_id,id)",
    "CREATE INDEX IF NOT EXISTS mcp_workspace_activity_idx ON mcp_activity(workspace_id,created_at,id)",
  ]) await d1.prepare(statement).run();
  const attachmentColumns = await d1.prepare("PRAGMA table_info(attachments)").all<{ name: string }>();
  if (!(attachmentColumns.results ?? []).some((column) => column.name === "unbound_at")) {
    await d1.prepare("ALTER TABLE attachments ADD COLUMN unbound_at TEXT").run();
  }
  await d1.prepare("UPDATE attachments SET unbound_at = created_at WHERE post_id IS NULL AND unbound_at IS NULL").run();
  if (!(postColumns.results ?? []).some((column) => column.name === "author_id")) {
    await d1.prepare("ALTER TABLE posts ADD COLUMN author_id INTEGER").run();
  }
  if (!(postColumns.results ?? []).some((column) => column.name === "created_by")) {
    await d1.prepare("ALTER TABLE posts ADD COLUMN created_by INTEGER").run();
  }
  if (!(postColumns.results ?? []).some((column) => column.name === "updated_by")) {
    await d1.prepare("ALTER TABLE posts ADD COLUMN updated_by INTEGER").run();
  }
  const postsWithoutPublicId = await d1.prepare("SELECT id FROM posts WHERE public_id IS NULL OR public_id = ''").all<{ id: number }>();
  if (postsWithoutPublicId.results?.length) {
    await d1.batch(postsWithoutPublicId.results.map((post) => d1.prepare("UPDATE posts SET public_id = ? WHERE id = ?").bind(createPostPublicId(), post.id)));
  }
  await d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS posts_public_id_uidx ON posts(public_id)").run();
  await d1.prepare("CREATE INDEX IF NOT EXISTS posts_space_updated_idx ON posts(space_id, updated_at DESC, id DESC)").run();
  await d1.prepare("CREATE INDEX IF NOT EXISTS posts_space_sort_idx ON posts(space_id, sort_order ASC, id ASC)").run();
  await d1.prepare("CREATE INDEX IF NOT EXISTS posts_space_status_updated_idx ON posts(space_id, status, updated_at DESC, id DESC)").run();
  await d1.prepare("CREATE INDEX IF NOT EXISTS posts_space_published_idx ON posts(space_id, published_at DESC, id DESC)").run();
  await d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS post_slug_history_slug_uidx ON post_slug_history(slug)").run();

  await d1.batch([
    d1.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('app_environment', ?)")
      .bind(runtimeEnvironment),
    d1.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('instance_id', ?)")
      .bind(runtimeIdentity.instanceId),
  ]);

  const s = DEFAULT_SITE_SETTINGS;
  const p = DEFAULT_ABOUT_PAGE;
  const connect = DEFAULT_CONNECT_PAGE;
  await d1.batch([
    d1.prepare("INSERT OR IGNORE INTO categories (id, name, slug, color) VALUES (1, '随笔', 'notes', '#8E8E93')"),
    d1.prepare("INSERT OR IGNORE INTO users (id, display_name, status) VALUES (1, '星屿管理员', 'active')"),
    d1.prepare("INSERT OR IGNORE INTO user_identities (user_id, provider, subject, name) VALUES (1, 'local', 'owner', '星屿管理员')"),
    d1.prepare("INSERT OR IGNORE INTO site_memberships (user_id, role) VALUES (1, 'owner')"),
    d1.prepare("INSERT OR IGNORE INTO workspaces(id,kind,owner_user_id,slug,name,status) VALUES(1,'personal',1,'personal-u1','星屿管理员的工作区','active')"),
    d1.prepare("INSERT OR IGNORE INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(1,1,'owner','active')"),
    d1.prepare("INSERT OR IGNORE INTO user_identities (user_id, provider, subject, email, name) VALUES (1, 'email', ?, ?, '星屿管理员')").bind("zhangqiang8vip@gmail.com", "zhangqiang8vip@gmail.com"),
    d1.prepare("INSERT OR IGNORE INTO user_credentials (user_id, legacy_admin) VALUES (1, 1)"),
    d1.prepare(`UPDATE categories
      SET name = '随笔', slug = 'notes', color = '#8E8E93'
      WHERE slug = 'uncategorized'
        AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'notes')`),
    d1.prepare(`UPDATE posts
      SET category_id = (SELECT id FROM categories WHERE slug = 'notes')
      WHERE category_id IN (SELECT id FROM categories WHERE slug = 'uncategorized')
        AND EXISTS (SELECT 1 FROM categories WHERE slug = 'notes')`),
    d1.prepare(`DELETE FROM categories
      WHERE slug = 'uncategorized'
        AND EXISTS (SELECT 1 FROM categories WHERE slug = 'notes')`),
    d1.prepare(`INSERT OR IGNORE INTO site_settings
      (id, brand_name, brand_latin, author_name, avatar_url, tagline, description, hero_lead, hero_tail,
       home_section_title, home_about_title, home_about_copy, footer_text, seo_title, seo_description, home_post_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        s.id, s.brandName, s.brandLatin, s.authorName, s.avatarUrl, s.tagline, s.description,
        s.heroLead, s.heroTail, s.homeSectionTitle, s.homeAboutTitle, s.homeAboutCopy,
        s.footerText, s.seoTitle, s.seoDescription, s.homePostLimit,
      ),
    d1.prepare("INSERT OR IGNORE INTO content_pages (slug, eyebrow, title, excerpt, content) VALUES (?, ?, ?, ?, ?)")
      .bind(p.slug, p.eyebrow, p.title, p.excerpt, p.content),
    d1.prepare("INSERT OR IGNORE INTO content_pages (slug, eyebrow, title, excerpt, content) VALUES (?, ?, ?, ?, ?)")
      .bind(connect.slug, connect.eyebrow, connect.title, connect.excerpt, connect.content),
    d1.prepare(`INSERT OR IGNORE INTO oauth_clients
      (client_id, client_name, client_type, client_secret_hash, redirect_uris, allowed_scopes, token_endpoint_auth_method, enabled)
      VALUES ('grok-xingyu', 'Grok · XINGYU', 'public', NULL, '[]', 'xingyu.read xingyu.draft xingyu.publish offline_access', 'none', 1)`),
    d1.prepare(`INSERT OR IGNORE INTO oauth_clients
      (client_id, client_name, client_type, client_secret_hash, redirect_uris, allowed_scopes, token_endpoint_auth_method, enabled)
      VALUES ('chatgpt-xingyu', 'ChatGPT · XINGYU', 'public', NULL, ?, 'xingyu.read xingyu.draft xingyu.publish offline_access', 'none', 1)`)
      .bind(JSON.stringify([
        "https://chatgpt.com/connector_platform_oauth_redirect",
        "https://chatgpt.com/oauth/callback",
        "https://chat.openai.com/oauth/callback",
      ])),
  ]);

  const ownerEmailIdentity = await d1.prepare("SELECT user_id FROM user_identities WHERE provider = 'email' AND subject = ?").bind("zhangqiang8vip@gmail.com").first<{user_id:number}>();
  if (ownerEmailIdentity?.user_id !== 1) throw new Error("Owner email identity does not belong to the existing site owner");
  for (const statement of [...WORKSPACE_GUARD_TRIGGERS, ...COLLABORATION_GUARDS, ...ORGANIZATION_GUARDS]) await d1.prepare(statement).run();
  const searchVersion = await d1.prepare("SELECT value FROM app_meta WHERE key = 'posts_fts_version'").first<{ value: string }>();
  if (searchVersion?.value !== "2") {
    await d1.prepare("INSERT INTO posts_fts(posts_fts) VALUES ('rebuild')").run();
    await d1.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('posts_fts_version', '2')").run();
  }
  // Historical merge: every pre-identity article belongs to the site owner.
  await d1.prepare("UPDATE posts SET author_id = 1, created_by = 1, updated_by = 1 WHERE author_id IS NULL").run();
  await d1.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)").bind(schemaVersion).run();
}

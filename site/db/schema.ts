import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  workspaceId: integer("workspace_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  color: text("color").notNull().default("#0071e3"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("categories_slug_uidx").on(table.slug)]);

export const spaces = sqliteTable("spaces", {
  workspaceId: integer("workspace_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("spaces_parent_slug_uidx").on(table.parentId, table.slug),
  uniqueIndex("spaces_root_slug_uidx").on(table.slug).where(sql`${table.parentId} IS NULL`),
  index("spaces_parent_sort_idx").on(table.parentId, table.sortOrder, table.id),
  index("spaces_updated_idx").on(table.updatedAt, table.id),
]);

export const posts = sqliteTable("posts", {
  workspaceId: integer("workspace_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  content: text("content").notNull().default(""),
  categoryId: integer("category_id").notNull(),
  spaceId: integer("space_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  viewCount: integer("view_count").notNull().default(0),
  version: integer("version").notNull().default(1),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  authorId: integer("author_id"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
}, (table) => [
  uniqueIndex("posts_public_id_uidx").on(table.publicId),
  uniqueIndex("posts_slug_uidx").on(table.slug),
  index("posts_status_published_idx").on(table.status, table.publishedAt),
  index("posts_archive_cursor_idx").on(table.status, table.publishedAt, table.id),
  index("posts_category_status_idx").on(table.categoryId, table.status),
  index("posts_category_archive_cursor_idx").on(table.categoryId, table.status, table.publishedAt, table.id),
  index("posts_space_updated_idx").on(table.spaceId, table.updatedAt, table.id),
  index("posts_space_sort_idx").on(table.spaceId, table.sortOrder, table.id),
  index("posts_space_status_updated_idx").on(table.spaceId, table.status, table.updatedAt, table.id),
  index("posts_space_published_idx").on(table.spaceId, table.publishedAt, table.id),
  index("posts_updated_idx").on(table.updatedAt),
  index("posts_admin_cursor_idx").on(table.updatedAt, table.id),
]);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull().default("星屿管理员"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userIdentities = sqliteTable("user_identities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  provider: text("provider").notNull(),
  subject: text("subject").notNull(),
  email: text("email"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: text("last_login_at"),
}, (table) => [
  uniqueIndex("user_identities_provider_subject_uidx").on(table.provider, table.subject),
  index("user_identities_user_idx").on(table.userId),
]);

export const siteMemberships = sqliteTable("site_memberships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  role: text("role").notNull().default("owner"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("site_memberships_user_id_uidx").on(table.userId),
  index("site_memberships_role_idx").on(table.role),
]);

export const postSlugHistory = sqliteTable("post_slug_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").notNull(),
  slug: text("slug").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("post_slug_history_slug_uidx").on(table.slug),
  index("post_slug_history_post_idx").on(table.postId),
]);

export const attachments = sqliteTable("attachments", {
  workspaceId: integer("workspace_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull(),
  postId: integer("post_id"),
  objectKey: text("object_key").notNull(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  unboundAt: text("unbound_at"),
}, (table) => [
  uniqueIndex("attachments_public_id_uidx").on(table.publicId),
  uniqueIndex("attachments_object_key_uidx").on(table.objectKey),
  index("attachments_post_created_idx").on(table.postId, table.createdAt, table.id),
]);

export const attachmentCleanupQueue = sqliteTable("attachment_cleanup_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id"),
  objectKey: text("object_key").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("attachment_cleanup_queue_object_key_uidx").on(table.objectKey),
  index("attachment_cleanup_queue_status_idx").on(table.status, table.createdAt, table.id),
]);

export const postPreviewTokens = sqliteTable("post_preview_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
  lastViewedAt: text("last_viewed_at"),
  viewCount: integer("view_count").notNull().default(0),
}, (table) => [
  uniqueIndex("post_preview_tokens_hash_uidx").on(table.tokenHash),
  index("post_preview_tokens_post_idx").on(table.postId, table.expiresAt, table.id),
  index("post_preview_tokens_expiry_idx").on(table.expiresAt),
]);

export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  brandName: text("brand_name").notNull().default("星屿"),
  brandLatin: text("brand_latin").notNull().default("XINGYU"),
  authorName: text("author_name").notNull().default("星屿"),
  avatarUrl: text("avatar_url").notNull().default("/images/xingyu-avatar.jpg"),
  tagline: text("tagline").notNull().default("设计 · 技术 · 生活"),
  description: text("description").notNull().default("记录那些值得慢下来思考的设计、技术与生活片段。"),
  heroLead: text("hero_lead").notNull().default("在喧嚣之外，"),
  heroTail: text("hero_tail").notNull().default("留一座思考的岛。"),
  homeSectionTitle: text("home_section_title").notNull().default("最近在写"),
  homeAboutTitle: text("home_about_title").notNull().default("你好，这里是星屿。"),
  homeAboutCopy: text("home_about_copy").notNull().default("一座关于设计、技术与生活的数字岛屿。希望每篇文章，都能给你留下一点值得带走的东西。"),
  footerText: text("footer_text").notNull().default("保持好奇，持续创造。"),
  seoTitle: text("seo_title").notNull().default("星屿 · 思考与创造"),
  seoDescription: text("seo_description").notNull().default("星屿个人博客，记录设计、技术与生活。"),
  homePostLimit: integer("home_post_limit").notNull().default(9),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contentPages = sqliteTable("content_pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  eyebrow: text("eyebrow").notNull().default(""),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  content: text("content").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("content_pages_slug_uidx").on(table.slug)]);

export const publicCacheState=sqliteTable("public_cache_state",{
  id:integer("id").primaryKey(),
  revision:integer("revision").notNull().default(1),
  updatedAt:text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const postViews = sqliteTable("post_views", {
  postId: integer("post_id").notNull(),
  visitorHash: text("visitor_hash").notNull(),
  viewedOn: text("viewed_on").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.postId, table.visitorHash, table.viewedOn] }),
  index("post_views_date_idx").on(table.viewedOn),
]);

export const viewRequestLimits = sqliteTable("view_request_limits", {
  identityHash: text("identity_hash").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStarted: integer("window_started").notNull(),
  blockedUntil: integer("blocked_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const mcpActivity = sqliteTable("mcp_activity", {
  workspaceId: integer("workspace_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  postId: integer("post_id").notNull(),
  publicId: text("public_id").notNull(),
  title: text("title").notNull(),
  beforeStatus: text("before_status"),
  afterStatus: text("after_status"),
  changedFields: text("changed_fields").notNull().default("[]"),
  summary: text("summary").notNull().default(""),
  clientLabel: text("client_label").notNull().default("remote-mcp"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("mcp_activity_created_idx").on(table.createdAt, table.id),
  index("mcp_activity_post_idx").on(table.postId, table.id),
]);

export const oauthClients = sqliteTable("oauth_clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  clientType: text("client_type", { enum: ["public", "confidential"] }).notNull().default("public"),
  clientSecretHash: text("client_secret_hash"),
  redirectUris: text("redirect_uris").notNull().default("[]"),
  allowedScopes: text("allowed_scopes").notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("oauth_clients_client_id_uidx").on(table.clientId)]);

export const oauthAuthorizationCodes = sqliteTable("oauth_authorization_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codeHash: text("code_hash").notNull(),
  clientId: text("client_id").notNull(),
  subject: text("subject").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("oauth_authorization_codes_hash_uidx").on(table.codeHash),
  index("oauth_authorization_codes_expiry_idx").on(table.expiresAt),
]);

export const oauthAccessTokens = sqliteTable("oauth_access_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull(),
  clientId: text("client_id").notNull(),
  subject: text("subject").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  lastUsedAt: integer("last_used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("oauth_access_tokens_hash_uidx").on(table.tokenHash),
  index("oauth_access_tokens_client_idx").on(table.clientId, table.subject, table.expiresAt),
]);

export const oauthRefreshTokens = sqliteTable("oauth_refresh_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull(),
  familyId: text("family_id").notNull(),
  parentTokenId: integer("parent_token_id"),
  clientId: text("client_id").notNull(),
  subject: text("subject").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  expiresAt: integer("expires_at").notNull(),
  absoluteExpiresAt: integer("absolute_expires_at").notNull(),
  usedAt: integer("used_at"),
  revokedAt: integer("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("oauth_refresh_tokens_hash_uidx").on(table.tokenHash),
  index("oauth_refresh_tokens_family_idx").on(table.familyId),
  index("oauth_refresh_tokens_client_idx").on(table.clientId, table.subject),
]);

export const oauthConsents = sqliteTable("oauth_consents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subject: text("subject").notNull(),
  clientId: text("client_id").notNull(),
  resource: text("resource").notNull(),
  grantedScopes: text("granted_scopes").notNull(),
  grantedAt: integer("granted_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (table) => [
  uniqueIndex("oauth_consents_subject_client_resource_uidx").on(table.subject, table.clientId, table.resource),
]);

export const oauthRateLimits = sqliteTable("oauth_rate_limits", {
  identifier: text("identifier").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStarted: integer("window_started").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const adminLoginAttempts = sqliteTable("admin_login_attempts", {
  identifier: text("identifier").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStarted: integer("window_started").notNull(),
  blockedUntil: integer("blocked_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});


export const userCredentials = sqliteTable("user_credentials", {
  userId: integer("user_id").primaryKey(),
  passwordHash: text("password_hash"),
  legacyAdmin: integer("legacy_admin").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userSessions = sqliteTable("user_sessions", {
  sessionHash: text("session_hash").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("user_sessions_user_expiry_idx").on(table.userId, table.expiresAt)]);

export const identityLoginLimits = sqliteTable("identity_login_limits", {
  identifier: text("identifier").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStarted: integer("window_started").notNull(),
  blockedUntil: integer("blocked_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const workspaces = sqliteTable("workspaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["personal", "shared", "organization"] }).notNull().default("personal"),
  ownerUserId: integer("owner_user_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("workspaces_slug_uidx").on(table.slug)]);

export const workspaceMemberships = sqliteTable("workspace_memberships", {
  workspaceId: integer("workspace_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role", { enum: ["owner", "admin", "editor", "viewer"] }).notNull().default("owner"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
  index("workspace_memberships_user_idx").on(table.userId, table.workspaceId),
]);

export const emailVerifications = sqliteTable("email_verifications", {
  tokenHash: text("token_hash").primaryKey(),
  purpose: text("purpose", { enum: ["verify_email", "reset_password"] }).notNull().default("verify_email"),
  userId: integer("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("email_verifications_user_idx").on(table.userId, table.expiresAt)]);


export const workspaceInvitations = sqliteTable("workspace_invitations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: integer("workspace_id").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: integer("invited_by").notNull(),
  expiresAt: integer("expires_at").notNull(),
  acceptedBy: integer("accepted_by"),
  acceptedAt: integer("accepted_at"),
  revokedAt: integer("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("workspace_invitations_token_uidx").on(table.tokenHash),
  uniqueIndex("workspace_invitations_pending_uidx").on(table.workspaceId, table.email)
    .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
  index("workspace_invitations_workspace_idx").on(table.workspaceId,table.createdAt),
]);


/** Organization membership never implicitly grants content access to a workspace. */
export const organizations = sqliteTable("organizations", {
  id: integer("id").primaryKey({autoIncrement:true}),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  ownerUserId: integer("owner_user_id").notNull(),
  status: text("status",{enum:["active","archived"]}).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
},t=>[uniqueIndex("organizations_slug_uidx").on(t.slug)]);
export const organizationMemberships = sqliteTable("organization_memberships", {
  organizationId: integer("organization_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role",{enum:["owner","admin","member"]}).notNull(),
  status: text("status",{enum:["active","suspended"]}).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
},t=>[primaryKey({columns:[t.organizationId,t.userId]}),
  index("organization_memberships_user_idx").on(t.userId,t.organizationId)]);
export const organizationInvitations = sqliteTable("organization_invitations", {
  id: integer("id").primaryKey({autoIncrement:true}),
  organizationId: integer("organization_id").notNull(),
  email: text("email").notNull(),
  role: text("role",{enum:["admin","member"]}).notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: integer("invited_by").notNull(),
  expiresAt: integer("expires_at").notNull(),
  acceptedBy: integer("accepted_by"),
  acceptedAt: integer("accepted_at"),
  revokedAt: integer("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
},t=>[
  uniqueIndex("organization_invitations_token_uidx").on(t.tokenHash),
  uniqueIndex("organization_invitations_pending_uidx").on(t.organizationId,t.email)
    .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
  index("organization_invitations_org_idx").on(t.organizationId,t.createdAt),
]);
export const organizationUnits = sqliteTable("organization_units", {
  id: integer("id").primaryKey({autoIncrement:true}),
  organizationId: integer("organization_id").notNull(),
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
},t=>[
  uniqueIndex("organization_units_sibling_uidx").on(t.organizationId,t.parentId,t.name),
  uniqueIndex("organization_units_root_uidx").on(t.organizationId,t.name).where(sql`${t.parentId} IS NULL`),
  index("organization_units_tree_idx").on(t.organizationId,t.parentId,t.sortOrder,t.id),
]);
export const organizationUnitMemberships = sqliteTable("organization_unit_memberships", {
  organizationId: integer("organization_id").notNull(),
  unitId: integer("unit_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
},t=>[primaryKey({columns:[t.organizationId,t.unitId,t.userId]}),
  index("organization_unit_memberships_user_idx").on(t.userId,t.organizationId)]);

-- Read-only pre-cutover audit. Every count must be zero, or the discrepancy
-- must be investigated before a Green database is accepted.
-- This file is intentionally excluded from Wrangler's numbered migrations.
WITH RECURSIVE rooted_spaces(id) AS (
  SELECT id FROM spaces WHERE parent_id IS NULL
  UNION
  SELECT child.id FROM spaces child JOIN rooted_spaces parent ON child.parent_id = parent.id
)
SELECT
  (SELECT COUNT(*) FROM posts p LEFT JOIN categories c ON c.id = p.category_id
   WHERE c.id IS NULL) AS posts_missing_category,
  (SELECT COUNT(*) FROM posts p LEFT JOIN spaces s ON s.id = p.space_id
   WHERE p.space_id IS NOT NULL AND s.id IS NULL) AS posts_missing_space,
  (SELECT COUNT(*) FROM spaces s LEFT JOIN spaces parent ON parent.id = s.parent_id
   WHERE s.parent_id IS NOT NULL AND parent.id IS NULL) AS spaces_missing_parent,
  (SELECT COUNT(*) FROM spaces s LEFT JOIN rooted_spaces rooted ON rooted.id = s.id
   WHERE rooted.id IS NULL) AS spaces_unreachable_from_root,
  (SELECT COUNT(*) FROM post_slug_history h LEFT JOIN posts p ON p.id = h.post_id
   WHERE p.id IS NULL) AS history_missing_post,
  (SELECT COUNT(*) FROM post_slug_history h JOIN posts p ON p.slug = h.slug
   WHERE p.id <> h.post_id) AS history_conflicts_current_slug,
  (SELECT COUNT(*) FROM attachments a LEFT JOIN posts p ON p.id = a.post_id
   WHERE a.post_id IS NOT NULL AND p.id IS NULL) AS attachments_missing_post,
  (SELECT COUNT(*) FROM post_preview_tokens t LEFT JOIN posts p ON p.id = t.post_id
   WHERE p.id IS NULL) AS preview_tokens_missing_post,
  (SELECT COUNT(*) FROM post_views v LEFT JOIN posts p ON p.id = v.post_id
   WHERE p.id IS NULL) AS views_missing_post,
  (SELECT COUNT(*) FROM oauth_authorization_codes code LEFT JOIN oauth_clients client
   ON client.client_id = code.client_id WHERE client.client_id IS NULL) AS codes_missing_oauth_client,
  (SELECT COUNT(*) FROM oauth_access_tokens token LEFT JOIN oauth_clients client
   ON client.client_id = token.client_id WHERE client.client_id IS NULL) AS access_tokens_missing_oauth_client,
  (SELECT COUNT(*) FROM oauth_refresh_tokens token LEFT JOIN oauth_clients client
   ON client.client_id = token.client_id WHERE client.client_id IS NULL) AS refresh_tokens_missing_oauth_client,
  (SELECT COUNT(*) FROM oauth_consents consent LEFT JOIN oauth_clients client
   ON client.client_id = consent.client_id WHERE client.client_id IS NULL) AS consents_missing_oauth_client,
  (SELECT COUNT(*) FROM posts WHERE author_id IS NULL) AS posts_missing_author,
  (SELECT COUNT(*) FROM user_identities identity LEFT JOIN users u ON u.id = identity.user_id
   WHERE u.id IS NULL) AS identities_missing_user,
  (SELECT COUNT(*) FROM site_memberships m LEFT JOIN users u ON u.id = m.user_id
   WHERE u.id IS NULL) AS memberships_missing_user;

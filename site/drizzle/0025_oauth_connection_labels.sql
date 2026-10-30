-- Preserves all existing OAuth authorization and token rows.
-- These are local user-assigned labels, not remote platform account identities.
CREATE TABLE oauth_connection_labels (
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  label TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, subject)
);

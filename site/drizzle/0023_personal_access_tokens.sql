-- Schema 25. NULL expires_at means permanent until revoked or account disabled.
CREATE TABLE personal_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_suffix TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX personal_access_tokens_hash_uidx ON personal_access_tokens(token_hash);
--> statement-breakpoint
CREATE INDEX personal_access_tokens_user_idx ON personal_access_tokens(user_id,created_at,id);

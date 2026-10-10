CREATE TABLE user_credentials (
  user_id integer PRIMARY KEY NOT NULL,
  password_hash text,
  legacy_admin integer DEFAULT 0 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE user_sessions (
  session_hash text PRIMARY KEY NOT NULL,
  user_id integer NOT NULL,
  expires_at integer NOT NULL,
  revoked_at integer,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX user_sessions_user_expiry_idx ON user_sessions (user_id,expires_at);
--> statement-breakpoint
CREATE TABLE identity_login_limits (
  identifier text PRIMARY KEY NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  window_started integer NOT NULL,
  blocked_until integer DEFAULT 0 NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
-- Keep owner id=1; preserve current posts, memberships, and legacy admin password.
-- The first email/password login uses ADMIN_PASSWORD_HASH and then stores a new hash.
INSERT INTO user_identities (user_id, provider, subject, email, name)
VALUES (1, 'email', 'zhangqiang8vip@gmail.com', 'zhangqiang8vip@gmail.com', '星屿管理员');
--> statement-breakpoint
INSERT INTO user_credentials (user_id, legacy_admin) VALUES (1, 1);

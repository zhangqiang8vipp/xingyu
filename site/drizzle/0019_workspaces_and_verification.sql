CREATE TABLE workspaces (
 id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 kind text DEFAULT 'personal' NOT NULL,
 owner_user_id integer NOT NULL,
 slug text NOT NULL,
 name text NOT NULL,
 status text DEFAULT 'active' NOT NULL,
 created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspaces_slug_uidx ON workspaces(slug);
--> statement-breakpoint
CREATE TABLE workspace_memberships (
 workspace_id integer NOT NULL,
 user_id integer NOT NULL,
 role text DEFAULT 'owner' NOT NULL,
 status text DEFAULT 'active' NOT NULL,
 created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 PRIMARY KEY(workspace_id,user_id)
);
--> statement-breakpoint
CREATE INDEX workspace_memberships_user_idx ON workspace_memberships(user_id,workspace_id);
--> statement-breakpoint
CREATE TABLE email_verifications (
 token_hash text PRIMARY KEY NOT NULL,
 purpose text DEFAULT 'verify_email' NOT NULL,
 user_id integer NOT NULL,
 expires_at integer NOT NULL,
 used_at integer,
 created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX email_verifications_user_idx ON email_verifications(user_id,expires_at);
--> statement-breakpoint
INSERT INTO workspaces(id,kind,owner_user_id,slug,name,status) VALUES(1,'personal',1,'personal-u1','星屿管理员的工作区','active');
--> statement-breakpoint
INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(1,1,'owner','active');
--> statement-breakpoint
ALTER TABLE categories ADD COLUMN workspace_id integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE spaces ADD COLUMN workspace_id integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE posts ADD COLUMN workspace_id integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE attachments ADD COLUMN workspace_id integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE mcp_activity ADD COLUMN workspace_id integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX posts_workspace_updated_idx ON posts(workspace_id,updated_at,id);
--> statement-breakpoint
CREATE INDEX spaces_workspace_parent_idx ON spaces(workspace_id,parent_id,id);
--> statement-breakpoint
CREATE INDEX attachments_workspace_idx ON attachments(workspace_id,post_id);
--> statement-breakpoint
CREATE INDEX categories_workspace_idx ON categories(workspace_id,id);
--> statement-breakpoint
CREATE INDEX mcp_workspace_activity_idx ON mcp_activity(workspace_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER posts_workspace_insert_guard BEFORE INSERT ON posts
WHEN (NEW.workspace_id <> 1 AND (
  NEW.space_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM categories c WHERE c.id=NEW.category_id AND c.workspace_id=NEW.workspace_id)
  OR NOT EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.space_id AND s.workspace_id=NEW.workspace_id)
))
OR EXISTS(SELECT 1 FROM categories c WHERE c.id=NEW.category_id AND c.workspace_id<>NEW.workspace_id)
OR (NEW.space_id IS NOT NULL AND EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.space_id AND s.workspace_id<>NEW.workspace_id))
BEGIN SELECT RAISE(ABORT,'posts workspace boundary'); END;
--> statement-breakpoint
CREATE TRIGGER posts_workspace_update_guard BEFORE UPDATE OF workspace_id,space_id,category_id ON posts
WHEN (NEW.workspace_id <> 1 AND (
  NEW.space_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM categories c WHERE c.id=NEW.category_id AND c.workspace_id=NEW.workspace_id)
  OR NOT EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.space_id AND s.workspace_id=NEW.workspace_id)
))
OR EXISTS(SELECT 1 FROM categories c WHERE c.id=NEW.category_id AND c.workspace_id<>NEW.workspace_id)
OR (NEW.space_id IS NOT NULL AND EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.space_id AND s.workspace_id<>NEW.workspace_id))
BEGIN SELECT RAISE(ABORT,'posts workspace boundary'); END;
--> statement-breakpoint
CREATE TRIGGER spaces_workspace_insert_guard BEFORE INSERT ON spaces
WHEN (NEW.workspace_id <> 1 AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id))
 OR (NEW.workspace_id <> 1 AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.parent_id AND s.workspace_id=NEW.workspace_id))
 OR (NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.parent_id AND s.workspace_id<>NEW.workspace_id))
BEGIN SELECT RAISE(ABORT,'spaces workspace boundary'); END;
--> statement-breakpoint
CREATE TRIGGER spaces_workspace_update_guard BEFORE UPDATE OF workspace_id,parent_id ON spaces
WHEN (NEW.workspace_id <> 1 AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id))
 OR (NEW.workspace_id <> 1 AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.parent_id AND s.workspace_id=NEW.workspace_id))
 OR (NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.parent_id AND s.workspace_id<>NEW.workspace_id))
BEGIN SELECT RAISE(ABORT,'spaces workspace boundary'); END;
--> statement-breakpoint
CREATE TRIGGER attachments_workspace_insert_guard BEFORE INSERT ON attachments
WHEN (NEW.workspace_id <> 1 AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id))
 OR (NEW.workspace_id <> 1 AND NEW.post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM posts p WHERE p.id=NEW.post_id AND p.workspace_id=NEW.workspace_id))
 OR (NEW.post_id IS NOT NULL AND EXISTS(SELECT 1 FROM posts p WHERE p.id=NEW.post_id AND p.workspace_id<>NEW.workspace_id))
BEGIN SELECT RAISE(ABORT,'attachments workspace boundary'); END;
--> statement-breakpoint
CREATE TRIGGER attachments_workspace_update_guard BEFORE UPDATE OF workspace_id,post_id ON attachments
WHEN (NEW.workspace_id <> 1 AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id))
 OR (NEW.workspace_id <> 1 AND NEW.post_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM posts p WHERE p.id=NEW.post_id AND p.workspace_id=NEW.workspace_id))
 OR (NEW.post_id IS NOT NULL AND EXISTS(SELECT 1 FROM posts p WHERE p.id=NEW.post_id AND p.workspace_id<>NEW.workspace_id))
BEGIN SELECT RAISE(ABORT,'attachments workspace boundary'); END;

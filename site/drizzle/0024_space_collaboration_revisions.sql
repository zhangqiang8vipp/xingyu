CREATE TABLE space_collaboration_settings (space_id INTEGER PRIMARY KEY NOT NULL, workspace_id INTEGER NOT NULL, inherit_permissions INTEGER NOT NULL DEFAULT 1 CHECK(inherit_permissions IN (0,1)));
--> statement-breakpoint
CREATE TABLE space_collaboration_members (space_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')), invited_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(space_id,user_id));
--> statement-breakpoint
CREATE INDEX space_collaboration_members_user_idx ON space_collaboration_members(user_id,space_id);
--> statement-breakpoint
CREATE TABLE space_collaboration_invites (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, space_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')), token_hash TEXT NOT NULL, invited_by INTEGER NOT NULL, expires_at INTEGER NOT NULL, accepted_by INTEGER, accepted_at INTEGER, revoked_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE UNIQUE INDEX space_collaboration_invites_token_uidx ON space_collaboration_invites(token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX space_collaboration_invites_pending_uidx ON space_collaboration_invites(space_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX space_collaboration_invites_space_idx ON space_collaboration_invites(space_id,created_at);
--> statement-breakpoint
CREATE TABLE document_revisions (post_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, space_id INTEGER, version INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, actor_user_id INTEGER, client_label TEXT NOT NULL DEFAULT 'legacy', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(post_id,version));
--> statement-breakpoint
CREATE INDEX document_revisions_space_idx ON document_revisions(workspace_id,space_id,post_id,version);
--> statement-breakpoint
CREATE TABLE document_merge_proposals (id TEXT PRIMARY KEY NOT NULL, post_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, space_id INTEGER NOT NULL, base_version INTEGER NOT NULL, head_version INTEGER NOT NULL, proposed_content TEXT NOT NULL, actor_user_id INTEGER NOT NULL, client_label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','cancelled')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT);
--> statement-breakpoint
CREATE INDEX document_merge_proposals_post_idx ON document_merge_proposals(post_id,status,created_at);
--> statement-breakpoint
CREATE TRIGGER space_collaboration_settings_guard BEFORE INSERT ON space_collaboration_settings WHEN NOT EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.space_id AND s.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'space collaboration settings boundary'); END;
--> statement-breakpoint
CREATE TRIGGER space_collaboration_members_guard BEFORE INSERT ON space_collaboration_members WHEN NOT EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.space_id AND s.workspace_id=NEW.workspace_id) OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.status='active') BEGIN SELECT RAISE(ABORT,'space collaboration member boundary'); END;
--> statement-breakpoint
CREATE TRIGGER space_collaboration_invites_guard BEFORE INSERT ON space_collaboration_invites WHEN NOT EXISTS(SELECT 1 FROM spaces s WHERE s.id=NEW.space_id AND s.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'space collaboration invitation boundary'); END;
--> statement-breakpoint
CREATE TRIGGER document_revision_post_insert AFTER INSERT ON posts BEGIN INSERT OR IGNORE INTO document_revisions(post_id,workspace_id,space_id,version,title,content,actor_user_id) VALUES(NEW.id,NEW.workspace_id,NEW.space_id,NEW.version,NEW.title,NEW.content,NEW.updated_by); END;
--> statement-breakpoint
CREATE TRIGGER document_revision_post_update AFTER UPDATE OF version ON posts WHEN NEW.version<>OLD.version BEGIN INSERT OR IGNORE INTO document_revisions(post_id,workspace_id,space_id,version,title,content,actor_user_id) VALUES(OLD.id,OLD.workspace_id,OLD.space_id,OLD.version,OLD.title,OLD.content,OLD.updated_by); INSERT OR IGNORE INTO document_revisions(post_id,workspace_id,space_id,version,title,content,actor_user_id) VALUES(NEW.id,NEW.workspace_id,NEW.space_id,NEW.version,NEW.title,NEW.content,NEW.updated_by); END;
--> statement-breakpoint
CREATE TRIGGER document_revision_post_delete AFTER DELETE ON posts BEGIN DELETE FROM document_revisions WHERE post_id=OLD.id; DELETE FROM document_merge_proposals WHERE post_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER space_collaboration_space_delete AFTER DELETE ON spaces BEGIN DELETE FROM space_collaboration_settings WHERE space_id=OLD.id; DELETE FROM space_collaboration_members WHERE space_id=OLD.id; DELETE FROM space_collaboration_invites WHERE space_id=OLD.id; END;
--> statement-breakpoint
INSERT OR IGNORE INTO document_revisions(post_id,workspace_id,space_id,version,title,content,actor_user_id) SELECT id,workspace_id,space_id,version,title,content,updated_by FROM posts;

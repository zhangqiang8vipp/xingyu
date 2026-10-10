CREATE TABLE workspace_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  workspace_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
  token_hash TEXT NOT NULL,
  invited_by INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_by INTEGER,
  accepted_at INTEGER,
  revoked_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_invitations_token_uidx ON workspace_invitations(token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_invitations_pending_uidx ON workspace_invitations(workspace_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX workspace_invitations_workspace_idx ON workspace_invitations(workspace_id,created_at);
--> statement-breakpoint
CREATE TRIGGER workspace_member_role_guard_insert BEFORE INSERT ON workspace_memberships
WHEN NOT EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND status='active')
OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id AND (
 (w.kind='personal' AND (NEW.user_id<>w.owner_user_id OR NEW.role<>'owner'))
 OR (w.kind<>'personal' AND ((NEW.user_id=w.owner_user_id AND NEW.role<>'owner') OR (NEW.user_id<>w.owner_user_id AND NEW.role='owner')))
))
BEGIN SELECT RAISE(ABORT,'workspace member role boundary'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_member_role_guard_update BEFORE UPDATE ON workspace_memberships
WHEN NOT EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND status='active')
OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id AND (
 (w.kind='personal' AND (NEW.user_id<>w.owner_user_id OR NEW.role<>'owner'))
 OR (w.kind<>'personal' AND ((NEW.user_id=w.owner_user_id AND NEW.role<>'owner') OR (NEW.user_id<>w.owner_user_id AND NEW.role='owner')))
))
OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id=OLD.workspace_id AND w.owner_user_id=OLD.user_id AND (NEW.workspace_id<>OLD.workspace_id OR NEW.user_id<>OLD.user_id))
BEGIN SELECT RAISE(ABORT,'workspace member role boundary'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_owner_delete_guard BEFORE DELETE ON workspace_memberships
WHEN EXISTS(SELECT 1 FROM workspaces w WHERE w.id=OLD.workspace_id AND w.owner_user_id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'cannot remove workspace owner'); END;

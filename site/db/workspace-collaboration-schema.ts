/** Preview-only bootstrap DDL; production runs SQL migration 0020. */
export const WORKSPACE_INVITATION_DDL = [
  "CREATE TABLE IF NOT EXISTS workspace_invitations (\n  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,\n  workspace_id INTEGER NOT NULL,\n  email TEXT NOT NULL,\n  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),\n  token_hash TEXT NOT NULL,\n  invited_by INTEGER NOT NULL,\n  expires_at INTEGER NOT NULL,\n  accepted_by INTEGER,\n  accepted_at INTEGER,\n  revoked_at INTEGER,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n);",
  "CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_token_uidx ON workspace_invitations(token_hash);",
  "CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_pending_uidx ON workspace_invitations(workspace_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;",
  "CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx ON workspace_invitations(workspace_id,created_at);",
];

/** Personal membership is private. Workspace owner cannot be removed or demoted. */
export const COLLABORATION_GUARDS = [
  "CREATE TRIGGER IF NOT EXISTS workspace_member_role_guard_insert BEFORE INSERT ON workspace_memberships\nWHEN NOT EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND status='active')\nOR EXISTS (SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id AND (\n (w.kind='personal' AND (NEW.user_id<>w.owner_user_id OR NEW.role<>'owner'))\n OR (w.kind<>'personal' AND ((NEW.user_id=w.owner_user_id AND NEW.role<>'owner') OR (NEW.user_id<>w.owner_user_id AND NEW.role='owner')))\n))\nBEGIN SELECT RAISE(ABORT,'workspace member role boundary'); END;",
  "CREATE TRIGGER IF NOT EXISTS workspace_member_role_guard_update BEFORE UPDATE ON workspace_memberships\nWHEN NOT EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND status='active')\nOR EXISTS (SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id AND (\n (w.kind='personal' AND (NEW.user_id<>w.owner_user_id OR NEW.role<>'owner'))\n OR (w.kind<>'personal' AND ((NEW.user_id=w.owner_user_id AND NEW.role<>'owner') OR (NEW.user_id<>w.owner_user_id AND NEW.role='owner')))\n))\nOR EXISTS (SELECT 1 FROM workspaces w WHERE w.id=OLD.workspace_id AND w.owner_user_id=OLD.user_id AND (NEW.workspace_id<>OLD.workspace_id OR NEW.user_id<>OLD.user_id))\nBEGIN SELECT RAISE(ABORT,'workspace member role boundary'); END;",
  "CREATE TRIGGER IF NOT EXISTS workspace_owner_delete_guard BEFORE DELETE ON workspace_memberships\nWHEN EXISTS(SELECT 1 FROM workspaces w WHERE w.id=OLD.workspace_id AND w.owner_user_id=OLD.user_id)\nBEGIN SELECT RAISE(ABORT,'cannot remove workspace owner'); END;",
];

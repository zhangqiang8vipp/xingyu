CREATE TABLE teams (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id INTEGER NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE team_memberships (organization_id INTEGER NOT NULL, team_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (team_id,user_id));
--> statement-breakpoint
CREATE TABLE organization_workspaces (organization_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE workspace_team_grants (organization_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, team_id INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('editor','viewer')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (workspace_id,team_id));
--> statement-breakpoint
CREATE TABLE space_access_policies (workspace_id INTEGER NOT NULL, space_id INTEGER NOT NULL PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'restricted' CHECK(mode='restricted'), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE space_principal_grants (workspace_id INTEGER NOT NULL, space_id INTEGER NOT NULL, principal_type TEXT NOT NULL CHECK(principal_type IN ('user','team')), principal_id INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('editor','viewer')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (space_id,principal_type,principal_id));
--> statement-breakpoint
CREATE UNIQUE INDEX teams_org_slug_uidx ON teams(organization_id,slug);
--> statement-breakpoint
CREATE INDEX teams_org_idx ON teams(organization_id,id);
--> statement-breakpoint
CREATE INDEX team_memberships_user_idx ON team_memberships(user_id,organization_id,team_id);
--> statement-breakpoint
CREATE INDEX organization_workspaces_org_idx ON organization_workspaces(organization_id,workspace_id);
--> statement-breakpoint
CREATE INDEX workspace_team_grants_team_idx ON workspace_team_grants(team_id,workspace_id);
--> statement-breakpoint
CREATE INDEX space_access_policies_workspace_idx ON space_access_policies(workspace_id,space_id);
--> statement-breakpoint
CREATE INDEX space_principal_grants_principal_idx ON space_principal_grants(principal_type,principal_id,workspace_id);
--> statement-breakpoint
CREATE TRIGGER team_member_insert_guard BEFORE INSERT ON team_memberships
WHEN NOT EXISTS(SELECT 1 FROM teams t WHERE t.id=NEW.team_id AND t.organization_id=NEW.organization_id)
OR NOT EXISTS(SELECT 1 FROM organization_memberships om JOIN users u ON u.id=om.user_id JOIN organizations o ON o.id=om.organization_id
 WHERE om.organization_id=NEW.organization_id AND om.user_id=NEW.user_id AND om.status='active' AND o.status='active' AND u.status='active')
BEGIN SELECT RAISE(ABORT,'team membership must belong to active organization'); END;
--> statement-breakpoint
CREATE TRIGGER team_member_update_guard BEFORE UPDATE ON team_memberships
WHEN NEW.organization_id<>OLD.organization_id OR NEW.team_id<>OLD.team_id OR NEW.user_id<>OLD.user_id
BEGIN SELECT RAISE(ABORT,'team membership immutable'); END;
--> statement-breakpoint
CREATE TRIGGER org_team_member_cleanup AFTER DELETE ON organization_memberships
BEGIN DELETE FROM team_memberships WHERE organization_id=OLD.organization_id AND user_id=OLD.user_id; END;
--> statement-breakpoint
CREATE TRIGGER org_team_member_suspend_cleanup AFTER UPDATE OF status ON organization_memberships
WHEN NEW.status<>'active' BEGIN DELETE FROM team_memberships WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id; END;
--> statement-breakpoint
CREATE TRIGGER org_workspace_link_insert_guard BEFORE INSERT ON organization_workspaces
WHEN NOT EXISTS(SELECT 1 FROM organizations o JOIN workspaces w ON w.id=NEW.workspace_id
 WHERE o.id=NEW.organization_id AND o.status='active' AND w.status='active'
 AND w.kind='organization' AND w.owner_user_id=o.owner_user_id)
BEGIN SELECT RAISE(ABORT,'organization workspace owner mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER org_workspace_link_update_guard BEFORE UPDATE ON organization_workspaces
WHEN NEW.organization_id<>OLD.organization_id OR NEW.workspace_id<>OLD.workspace_id
BEGIN SELECT RAISE(ABORT,'organization workspace link immutable'); END;
--> statement-breakpoint
CREATE TRIGGER team_grant_insert_guard BEFORE INSERT ON workspace_team_grants
WHEN NOT EXISTS(SELECT 1 FROM organization_workspaces ow JOIN organizations o ON o.id=ow.organization_id
 JOIN workspaces w ON w.id=ow.workspace_id JOIN teams t ON t.organization_id=ow.organization_id
 WHERE ow.organization_id=NEW.organization_id AND ow.workspace_id=NEW.workspace_id AND t.id=NEW.team_id
 AND w.kind='organization' AND w.status='active' AND o.status='active')
BEGIN SELECT RAISE(ABORT,'team grant organization boundary'); END;
--> statement-breakpoint
CREATE TRIGGER team_grant_update_guard BEFORE UPDATE ON workspace_team_grants
WHEN NEW.organization_id<>OLD.organization_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.team_id<>OLD.team_id
BEGIN SELECT RAISE(ABORT,'team grant identity immutable'); END;
--> statement-breakpoint
CREATE TRIGGER space_policy_insert_guard BEFORE INSERT ON space_access_policies
WHEN NOT EXISTS(SELECT 1 FROM organization_workspaces ow JOIN workspaces w ON w.id=ow.workspace_id
 JOIN spaces s ON s.id=NEW.space_id AND s.workspace_id=ow.workspace_id
 WHERE ow.workspace_id=NEW.workspace_id AND w.kind='organization' AND w.status='active')
BEGIN SELECT RAISE(ABORT,'space policy workspace boundary'); END;
--> statement-breakpoint
CREATE TRIGGER space_policy_update_guard BEFORE UPDATE ON space_access_policies
WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.space_id<>OLD.space_id
BEGIN SELECT RAISE(ABORT,'space policy identity immutable'); END;
--> statement-breakpoint
CREATE TRIGGER space_policy_delete_cleanup AFTER DELETE ON space_access_policies
BEGIN DELETE FROM space_principal_grants WHERE workspace_id=OLD.workspace_id AND space_id=OLD.space_id; END;
--> statement-breakpoint
CREATE TRIGGER space_grant_insert_guard BEFORE INSERT ON space_principal_grants
WHEN NOT EXISTS(SELECT 1 FROM space_access_policies p JOIN organization_workspaces ow ON ow.workspace_id=p.workspace_id
 WHERE p.space_id=NEW.space_id AND p.workspace_id=NEW.workspace_id)
OR (NEW.principal_type='user' AND NOT EXISTS(
 SELECT 1 FROM organization_workspaces ow JOIN organization_memberships om ON om.organization_id=ow.organization_id
 JOIN users u ON u.id=om.user_id WHERE ow.workspace_id=NEW.workspace_id AND om.user_id=NEW.principal_id
 AND om.status='active' AND u.status='active'))
OR (NEW.principal_type='team' AND NOT EXISTS(
 SELECT 1 FROM organization_workspaces ow JOIN teams t ON t.organization_id=ow.organization_id
 WHERE ow.workspace_id=NEW.workspace_id AND t.id=NEW.principal_id))
BEGIN SELECT RAISE(ABORT,'space principal organization boundary'); END;
--> statement-breakpoint
CREATE TRIGGER space_grant_update_guard BEFORE UPDATE ON space_principal_grants
WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.space_id<>OLD.space_id
 OR NEW.principal_type<>OLD.principal_type OR NEW.principal_id<>OLD.principal_id
BEGIN SELECT RAISE(ABORT,'space principal immutable'); END;
--> statement-breakpoint
CREATE VIEW workspace_effective_grants AS
SELECT w.id AS workspace_id,m.user_id,m.role FROM workspace_memberships m
JOIN workspaces w ON w.id=m.workspace_id JOIN users u ON u.id=m.user_id
WHERE m.status='active' AND w.status='active' AND u.status='active'
AND (w.kind<>'personal' OR w.owner_user_id=m.user_id)
AND (w.kind<>'organization' OR (
 EXISTS(SELECT 1 FROM organization_workspaces ow JOIN organization_memberships om ON om.organization_id=ow.organization_id
 WHERE ow.workspace_id=w.id AND om.user_id=m.user_id AND om.status='active')))
UNION ALL
SELECT ow.workspace_id,tm.user_id,tg.role FROM workspace_team_grants tg
JOIN organization_workspaces ow ON ow.workspace_id=tg.workspace_id AND ow.organization_id=tg.organization_id
JOIN workspaces w ON w.id=ow.workspace_id AND w.kind='organization' AND w.status='active'
JOIN organizations o ON o.id=ow.organization_id AND o.status='active'
JOIN teams t ON t.id=tg.team_id AND t.organization_id=ow.organization_id
JOIN team_memberships tm ON tm.team_id=t.id AND tm.organization_id=t.organization_id
JOIN organization_memberships om ON om.organization_id=ow.organization_id AND om.user_id=tm.user_id AND om.status='active'
JOIN users u ON u.id=tm.user_id AND u.status='active';

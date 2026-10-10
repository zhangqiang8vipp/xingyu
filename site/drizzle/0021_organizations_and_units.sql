CREATE TABLE organizations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, owner_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE organization_memberships (organization_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','member')), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (organization_id,user_id));
--> statement-breakpoint
CREATE TABLE organization_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id INTEGER NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), token_hash TEXT NOT NULL, invited_by INTEGER NOT NULL, expires_at INTEGER NOT NULL, accepted_by INTEGER, accepted_at INTEGER, revoked_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE organization_units (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id INTEGER NOT NULL, parent_id INTEGER, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
--> statement-breakpoint
CREATE TABLE organization_unit_memberships (organization_id INTEGER NOT NULL, unit_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(organization_id,unit_id,user_id));
--> statement-breakpoint
CREATE UNIQUE INDEX organizations_slug_uidx ON organizations(slug);
--> statement-breakpoint
CREATE INDEX organization_memberships_user_idx ON organization_memberships(user_id,organization_id);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_invitations_token_uidx ON organization_invitations(token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_invitations_pending_uidx ON organization_invitations(organization_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX organization_invitations_org_idx ON organization_invitations(organization_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_units_sibling_uidx ON organization_units(organization_id,parent_id,name);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_units_root_uidx ON organization_units(organization_id,name) WHERE parent_id IS NULL;
--> statement-breakpoint
CREATE INDEX organization_units_tree_idx ON organization_units(organization_id,parent_id,sort_order,id);
--> statement-breakpoint
CREATE INDEX organization_unit_memberships_user_idx ON organization_unit_memberships(user_id,organization_id);
--> statement-breakpoint
CREATE TRIGGER org_membership_insert_guard BEFORE INSERT ON organization_memberships
WHEN NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id=NEW.organization_id AND o.status='active')
OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.status='active')
OR EXISTS(SELECT 1 FROM organizations o WHERE o.id=NEW.organization_id AND
 ((o.owner_user_id=NEW.user_id AND (NEW.role<>'owner' OR NEW.status<>'active'))
 OR (o.owner_user_id<>NEW.user_id AND NEW.role='owner')))
BEGIN SELECT RAISE(ABORT,'organization member boundary'); END;
--> statement-breakpoint
CREATE TRIGGER org_membership_update_guard BEFORE UPDATE ON organization_memberships
WHEN NEW.organization_id<>OLD.organization_id OR NEW.user_id<>OLD.user_id
OR NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id=NEW.organization_id AND o.status='active')
OR EXISTS(SELECT 1 FROM organizations o WHERE o.id=NEW.organization_id AND
 ((o.owner_user_id=NEW.user_id AND (NEW.role<>'owner' OR NEW.status<>'active'))
 OR (o.owner_user_id<>NEW.user_id AND NEW.role='owner')))
BEGIN SELECT RAISE(ABORT,'organization member boundary'); END;
--> statement-breakpoint
CREATE TRIGGER org_owner_membership_delete_guard BEFORE DELETE ON organization_memberships
WHEN EXISTS(SELECT 1 FROM organizations o WHERE o.id=OLD.organization_id AND o.owner_user_id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'cannot remove organization owner'); END;
--> statement-breakpoint
CREATE TRIGGER org_member_units_cleanup AFTER DELETE ON organization_memberships
BEGIN DELETE FROM organization_unit_memberships WHERE organization_id=OLD.organization_id AND user_id=OLD.user_id; END;
--> statement-breakpoint
CREATE TRIGGER org_unit_insert_guard BEFORE INSERT ON organization_units
WHEN NOT EXISTS(SELECT 1 FROM organizations o WHERE o.id=NEW.organization_id AND o.status='active')
OR (NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_units p
 WHERE p.id=NEW.parent_id AND p.organization_id=NEW.organization_id))
BEGIN SELECT RAISE(ABORT,'organization unit parent boundary'); END;
--> statement-breakpoint
CREATE TRIGGER org_unit_update_guard BEFORE UPDATE ON organization_units
WHEN NEW.organization_id<>OLD.organization_id
OR (NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_units p
 WHERE p.id=NEW.parent_id AND p.organization_id=NEW.organization_id))
OR (NEW.parent_id IS NOT NULL AND EXISTS(
 WITH RECURSIVE ancestors(id,parent_id) AS (
  SELECT id,parent_id FROM organization_units WHERE id=NEW.parent_id AND organization_id=NEW.organization_id
  UNION ALL
  SELECT p.id,p.parent_id FROM organization_units p JOIN ancestors a ON p.id=a.parent_id WHERE p.organization_id=NEW.organization_id
 ) SELECT 1 FROM ancestors WHERE id=OLD.id
))
BEGIN SELECT RAISE(ABORT,'organization unit cycle or cross-organization parent'); END;
--> statement-breakpoint
CREATE TRIGGER org_unit_delete_guard BEFORE DELETE ON organization_units
WHEN EXISTS(SELECT 1 FROM organization_units c WHERE c.parent_id=OLD.id)
OR EXISTS(SELECT 1 FROM organization_unit_memberships m WHERE m.organization_id=OLD.organization_id AND m.unit_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'organization unit is not empty'); END;
--> statement-breakpoint
CREATE TRIGGER org_unit_member_insert_guard BEFORE INSERT ON organization_unit_memberships
WHEN NOT EXISTS(SELECT 1 FROM organization_units d WHERE d.id=NEW.unit_id AND d.organization_id=NEW.organization_id)
OR NOT EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id JOIN users u ON u.id=m.user_id
 WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.user_id AND m.status='active' AND o.status='active' AND u.status='active')
BEGIN SELECT RAISE(ABORT,'department membership boundary'); END;
--> statement-breakpoint
CREATE TRIGGER org_unit_member_update_guard BEFORE UPDATE ON organization_unit_memberships
WHEN NEW.organization_id<>OLD.organization_id OR NEW.unit_id<>OLD.unit_id OR NEW.user_id<>OLD.user_id
BEGIN SELECT RAISE(ABORT,'department membership immutable'); END;

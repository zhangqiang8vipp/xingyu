/**
 * Read-only validation for the one-time, manually approved collaboration release.
 * All D1 writes stay in the separately protected GitHub Actions workflow.
 */
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractD1Rows } from "./beta-provision-core.mjs";
import { validateProductionConfig, validateD1Metadata } from "./verify-production-deploy.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NEW_MIGRATION = "0024_space_collaboration_revisions.sql";
const REQUIRED_TABLES = [
  "space_collaboration_settings",
  "space_collaboration_members",
  "space_collaboration_invites",
  "document_revisions",
  "document_merge_proposals",
];
const REQUIRED_TRIGGERS = [
  "document_revision_post_insert",
  "document_revision_post_update",
  "space_collaboration_members_guard",
  "space_collaboration_invites_guard",
];
function requireCondition(condition, message) {
  if (!condition) throw new Error("Collaboration release blocked: " + message);
}
function rows(file) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const entries = Array.isArray(payload) ? payload : [payload];
  requireCondition(entries.every(entry => entry && entry.success !== false), "D1 query failure");
  return extractD1Rows(payload);
}
function expectedMigrations() {
  const files = readdirSync(path.join(ROOT, "drizzle"))
    .filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  requireCondition(files.length === 25 && files[24] === NEW_MIGRATION,
    "unexpected local migration inventory; only 0024 is approved");
  return files;
}
function compareMigrations(actualRows, expected) {
  const actual = actualRows.map(row => String(row.name)).sort();
  requireCondition(actual.length === expected.length,
    "remote migration count differs from expected " + expected.length + "; got " + actual.length);
  for (let i = 0; i < expected.length; i++) {
    requireCondition(actual[i] === expected[i],
      "remote migration list mismatch at index " + i + "; expected " + expected[i] + ", got " + actual[i]);
  }
}
function checkObjects(shapeRows) {
  const tableSet = new Set(shapeRows.filter(row => row.type === "table").map(row => String(row.name)));
  const triggerSet = new Set(shapeRows.filter(row => row.type === "trigger").map(row => String(row.name)));
  for (const item of REQUIRED_TABLES) requireCondition(tableSet.has(item), "required table missing: " + item);
  for (const item of REQUIRED_TRIGGERS) requireCondition(triggerSet.has(item), "required trigger missing: " + item);
}
function validate(mode, metaFile, migrationFile, shapeFile) {
  requireCondition(["preflight", "postapply", "postdeploy"].includes(mode), "invalid verification mode");
  requireCondition(metaFile && migrationFile, "metadata and migration JSON are required");
  const config = JSON.parse(readFileSync(path.join(ROOT, "wrangler.production.jsonc"), "utf8"));
  const bootstrap = readFileSync(path.join(ROOT, "db", "bootstrap.ts"), "utf8");
  const expected = validateProductionConfig(config, bootstrap);
  requireCondition(expected.schemaVersion === "26", "release must target schema 26");
  const metaRows = rows(metaFile);
  requireCondition(metaRows.length === 3, "expected exactly three identity markers");
  const meta = new Map(metaRows.map(row => [String(row.key), String(row.value)]));
  requireCondition(meta.get("app_environment") === "production", "D1 APP_ENV must be production");
  requireCondition(meta.get("instance_id") === "production:xingyu-blog", "D1 instance marker mismatch");
  const version = meta.get("schema_version");
  const migrations = expectedMigrations();
  if (mode === "preflight") {
    requireCondition(version === "25" || version === "26", "remote schema must be 25 or 26");
    compareMigrations(rows(migrationFile), version === "25" ? migrations.slice(0, -1) : migrations);
    if (version === "26") {
      requireCondition(shapeFile, "existing schema 26 requires full shape audit");
      checkObjects(rows(shapeFile));
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, "needs_migration=" + (version === "25" ? "true" : "false") + "\n");
    }
    console.log("Production identity and migrations verified; schema=" + version +
      "; requires migration=" + (version === "25"));
    return;
  }
  compareMigrations(rows(migrationFile), migrations);
  requireCondition(shapeFile, "schema object JSON required");
  checkObjects(rows(shapeFile));
  if (mode === "postapply") {
    requireCondition(version === "25", "schema marker must remain 25 until post-migration verification");
    console.log("All schema 26 objects and migration 0024 are present; marker promotion is now allowed");
  } else {
    validateD1Metadata(JSON.parse(readFileSync(metaFile, "utf8")), expected);
    console.log("Production D1 schema 26 and resource identity verified");
  }
}
try {
  validate(process.argv[2], process.argv[3], process.argv[4], process.argv[5]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release preflight failed");
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const site = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(site, "scripts", "collaboration-production-release.mjs");
const migrations = readdirSync(path.join(site, "drizzle")).filter(x => /^\d{4}_.+\.sql$/.test(x)).sort();
const tables = [
  "space_collaboration_settings", "space_collaboration_members", "space_collaboration_invites",
  "document_revisions", "document_merge_proposals",
];
const triggers = [
  "document_revision_post_insert", "document_revision_post_update",
  "space_collaboration_members_guard", "space_collaboration_invites_guard",
];
function payload(rows) { return JSON.stringify([{ success: true, results: rows }]); }
function fixture(mode, version, migrationNames, shape = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "xingyu-release-test-"));
  const meta = path.join(dir, "meta.json");
  const mig = path.join(dir, "migrations.json");
  const objects = path.join(dir, "objects.json");
  const output = path.join(dir, "output.txt");
  writeFileSync(meta, payload([
    {key: "schema_version", value: version},
    {key: "app_environment", value: "production"},
    {key: "instance_id", value: "production:xingyu-blog"},
  ]));
  writeFileSync(mig, payload(migrationNames.map(name => ({name}))));
  writeFileSync(objects, payload(shape));
  try {
    const result = spawnSync(process.execPath, [script, mode, meta, mig, objects], {
      cwd: site, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output },
    });
    return { result, output: result.status === 0 && mode === "preflight" ? readFileSync(output, "utf8") : "" };
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}
const fullShape = [
  ...tables.map(name => ({type: "table", name})),
  ...triggers.map(name => ({type: "trigger", name})),
];
test("production release guard accepts exactly schema 25 and migration 0024 pending", () => {
  assert.equal(migrations.length, 25);
  assert.equal(migrations.at(-1), "0024_space_collaboration_revisions.sql");
  const {result, output} = fixture("preflight", "25", migrations.slice(0, -1));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(output, "needs_migration=true\n");
});
test("production release guard accepts idempotent verified schema 26", () => {
  const {result, output} = fixture("preflight", "26", migrations, fullShape);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(output, "needs_migration=false\n");
});
test("production release guard rejects missing prior migration before any write", () => {
  const {result} = fixture("preflight", "25", migrations.slice(0, -2));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /migration count differs/);
});
test("post-migration shape validation requires original schema marker to remain 25", () => {
  assert.equal(fixture("postapply", "25", migrations, fullShape).result.status, 0);
  assert.notEqual(fixture("postapply", "26", migrations, fullShape).result.status, 0);
});
test("post-deploy gate rejects missing revision triggers and wrong schema marker", () => {
  assert.equal(fixture("postdeploy", "26", migrations, fullShape).result.status, 0);
  assert.notEqual(fixture("postdeploy", "25", migrations, fullShape).result.status, 0);
  assert.notEqual(fixture("postdeploy", "26", migrations, fullShape.filter(x => x.name !== "document_revision_post_update")).result.status, 0);
});


test("production dispatch evaluates GitHub expressions instead of passing them as literal strings", () => {
  const workflow = readFileSync(path.join(site, "..", ".github", "workflows", "release-collaboration-2026-10-26.yml"), "utf8");
  const contexts = [
    "inputs.confirm",
    "inputs.migrate",
    "vars.PRODUCTION_DEPLOY_ENABLED",
    "secrets.CLOUDFLARE_API_TOKEN",
    "secrets.CLOUDFLARE_ACCOUNT_ID",
  ];
  for (const context of contexts) {
    const resolvedExpression = "$" + "{{ " + context + " }}";
    assert.ok(workflow.includes(resolvedExpression), "Missing evaluated Actions context: " + context);
  }
  assert.doesNotMatch(workflow, /\$\{\s*(?:inputs|vars|secrets)\./,
    "Unresolved single-brace GitHub expression would make dispatch fail closed");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+push:/m, "Production workflow must remain manual");
});

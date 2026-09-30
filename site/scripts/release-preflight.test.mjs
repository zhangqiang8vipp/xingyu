import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectReleasePreflight } from "./release-preflight.mjs";

const SITE_ROOT = fileURLToPath(new URL("../", import.meta.url));

function makeFixture(t) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "xingyu-release-preflight-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(path.join(fixture, "db"), { recursive: true });
  mkdirSync(path.join(fixture, "drizzle", "meta"), { recursive: true });
  copyFileSync(path.join(SITE_ROOT, "db", "bootstrap.ts"), path.join(fixture, "db", "bootstrap.ts"));
  copyFileSync(path.join(SITE_ROOT, "wrangler.production.jsonc"), path.join(fixture, "wrangler.production.jsonc"));
  copyFileSync(path.join(SITE_ROOT, "drizzle", "meta", "_journal.json"), path.join(fixture, "drizzle", "meta", "_journal.json"));
  for (const entry of readdirSync(path.join(SITE_ROOT, "drizzle"), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".sql")) {
      copyFileSync(path.join(SITE_ROOT, "drizzle", entry.name), path.join(fixture, "drizzle", entry.name));
    }
  }
  return fixture;
}

function inspectFixture(t, mutate) {
  const fixture = makeFixture(t);
  mutate(fixture);
  return inspectReleasePreflight(fixture);
}

function updateProductionConfig(fixture, mutate) {
  const configPath = path.join(fixture, "wrangler.production.jsonc");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  mutate(config);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

test("current repository release fixture passes", () => {
  const result = inspectReleasePreflight(SITE_ROOT);
  assert.deepEqual(result.errors, []);
  assert.equal(result.schemaVersion, 19);
  assert.equal(result.latestMigration, "0017_tiny_christian_walker.sql");
});

test("missing or unparseable schemaVersion fails clearly", (t) => {
  const result = inspectFixture(t, (fixture) => {
    writeFileSync(path.join(fixture, "db", "bootstrap.ts"), "export const schemaVersion = computeSchemaVersion();\n");
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /schemaVersion could not be parsed: schemaVersion must be a decimal string or integer literal/);
});

test("journal reference to a missing migration fails", (t) => {
  const result = inspectFixture(t, (fixture) => {
    rmSync(path.join(fixture, "drizzle", "0017_tiny_christian_walker.sql"));
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /references 0017_tiny_christian_walker, but drizzle\/0017_tiny_christian_walker\.sql is missing/);
});

test("numbered migration omitted from the journal fails", (t) => {
  const result = inspectFixture(t, (fixture) => {
    writeFileSync(path.join(fixture, "drizzle", "0018_unrecorded.sql"), "SELECT 1;\n");
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /0018_unrecorded\.sql exists but drizzle\/meta\/_journal\.json does not record 0018_unrecorded/);
});

test("production schema mode must stay migration-only", (t) => {
  const result = inspectFixture(t, (fixture) => {
    updateProductionConfig(fixture, (config) => { config.vars.DB_SCHEMA_MODE = "legacy-bootstrap"; });
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /must set vars\.DB_SCHEMA_MODE to "migration-only"; found "legacy-bootstrap"/);
});

test("migration directory configuration must resolve to site/drizzle", (t) => {
  const result = inspectFixture(t, (fixture) => {
    updateProductionConfig(fixture, (config) => {
      config.d1_databases.find((database) => database.binding === "DB").migrations_dir = "wrong-migrations";
    });
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /migrations_dir must resolve to site\/drizzle; found "wrong-migrations"/);
});

test("migration pattern must cover every numbered migration", (t) => {
  const result = inspectFixture(t, (fixture) => {
    updateProductionConfig(fixture, (config) => {
      config.d1_databases.find((database) => database.binding === "DB").migrations_pattern = "drizzle/9999_*.sql";
    });
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /does not cover numbered migrations/);
});

test("application schemaVersion must match the journal sequence", (t) => {
  const result = inspectFixture(t, (fixture) => {
    writeFileSync(path.join(fixture, "db", "bootstrap.ts"), "export const schemaVersion: string = \"20\" as const;\n");
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /application requires schema 20, but latest recorded migration is 0017_tiny_christian_walker\.sql/);
});

test("journal indexes and migration ids must be unique and ordered", (t) => {
  const result = inspectFixture(t, (fixture) => {
    const journalPath = path.join(fixture, "drizzle", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries[1].idx = 0;
    journal.entries[1].tag = journal.entries[0].tag;
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /repeats migration idx 0/);
  assert.match(result.errors.join("\n"), /repeats migration tag 0000_common_trish_tilby/);
  assert.match(result.errors.join("\n"), /repeats migration id 0000/);
});

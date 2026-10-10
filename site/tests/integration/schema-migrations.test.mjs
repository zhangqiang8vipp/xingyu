import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  callMcpTool, closeTestHarness, createTestHarness, initializeMcp, jsonRequest, loginAdmin,
  openTestHarness, TEST_ADMIN_PASSWORD, TEST_ADMIN_SESSION_SECRET, TEST_LEGACY_MCP_TOKEN,
} from "./harness.mjs";

const SITE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_ROOT = fileURLToPath(new URL("../../drizzle/", import.meta.url));

async function applySqlFile(db, filename) {
  const sql = readFileSync(new URL(`../../drizzle/${filename}`, import.meta.url), "utf8");
  for (const statement of sql.split(/--> statement-breakpoint/).map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

async function applyVersionedMigrations(db, stopBefore = null) {
  const files = readdirSync(MIGRATIONS_ROOT).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  assert.ok(files.length > 0, "a versioned migration chain must exist");
  for (const file of files) {
    if (file === stopBefore) break;
    await applySqlFile(db, file);
  }
}

test("production D1 config selects versioned migrations but not seed or audit SQL", () => {
  const config = JSON.parse(readFileSync(new URL("../../wrangler.production.jsonc", import.meta.url), "utf8"));
  const binding = config.d1_databases?.find((database) => database.binding === "DB");
  assert.equal(binding?.migrations_dir, "drizzle");
  assert.equal(binding?.migrations_pattern, "drizzle/[0-9][0-9][0-9][0-9]_*.sql");
  assert.notEqual(config.vars?.DB_SCHEMA_MODE, "local-preview-bootstrap",
    "the request-time bootstrap exception belongs only to the local preview binding");
  const files = readdirSync(MIGRATIONS_ROOT).filter((name) => name.endsWith(".sql"));
  const versioned = files.filter((name) => /^\d{4}_.+\.sql$/.test(name));
  assert.ok(versioned.length > 0);
  assert.ok(files.includes("seed-app-defaults.sql"));
  assert.ok(files.includes("verify-core-relations.sql"));
  assert.ok(files.length > versioned.length, "non-migration SQL must stay outside Wrangler's migration pattern");
});

async function schemaShape(db) {
  const rows = await db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger')
      AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
    ORDER BY type, name`).all();
  const shape = [];
  for (const row of rows.results ?? []) {
    if (row.name.startsWith("posts_fts_")) continue; // SQLite's FTS shadow tables.
    const entry = { type: row.type, name: row.name, table: row.tbl_name };
    if (row.type === "table") {
      const columns = await db.prepare(`PRAGMA table_info(${row.name})`).all();
      entry.columns = (columns.results ?? []).map(({ name, type, notnull, dflt_value, pk }) => ({
        name, type, notnull, default: dflt_value, pk,
      }));
    }
    if (row.type === "index") {
      const indexes = await db.prepare(`PRAGMA index_list(${row.tbl_name})`).all();
      const index = (indexes.results ?? []).find((item) => item.name === row.name);
      const columns = await db.prepare(`PRAGMA index_info(${row.name})`).all();
      entry.unique = index?.unique;
      entry.columns = (columns.results ?? []).map((column) => column.name);
      const predicate = row.sql?.match(/\bWHERE\b([\s\S]*)$/i)?.[1];
      entry.predicate = predicate?.replace(/[`\"]/g, "").replace(/\bspaces\./gi, "")
        .replace(/\s+/g, "").replace(/;$/, "").toLowerCase() ?? null;
    }
    if (row.type === "trigger") entry.definition = normalizeTriggerSql(row.sql);
    shape.push(entry);
  }
  return shape;
}

function normalizeTriggerSql(definition) {
  const literals = [];
  const withoutLiterals = definition.replace(/'(?:''|[^'])*'/g, (literal) => {
    literals.push(literal);
    return `__literal_${literals.length - 1}__`;
  });
  return withoutLiterals.replace(/\bIF NOT EXISTS\b/gi, "")
    .replace(/[`\"]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),;=<>])\s*/g, "$1")
    .replace(/;$/, "")
    .trim()
    .toLowerCase()
    .replace(/__literal_(\d+)__/g, (_, index) => literals[Number(index)]);
}

test("trigger definition comparison preserves case-sensitive SQL literals", () => {
  assert.notEqual(
    normalizeTriggerSql("CREATE TRIGGER x AFTER INSERT ON posts BEGIN SELECT 'published'; END"),
    normalizeTriggerSql("CREATE TRIGGER x AFTER INSERT ON posts BEGIN SELECT 'Published'; END"),
  );
});

test("a pre-version article row imports into the migrated schema without losing its stable identity", async () => {
  const blue = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development" } }],
  });
  const green = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development" } }],
  });
  try {
    await blue.listen();
    await green.listen();
    const { DB: blueDb } = await blue.getWorker().getEnv();
    const { DB: greenDb } = await green.getWorker().getEnv();
    await applyVersionedMigrations(blueDb, "0011_careful_marrow.sql");
    await applyVersionedMigrations(greenDb);
    await blueDb.prepare(`INSERT INTO posts (public_id, title, slug, category_id, content, status)
      VALUES ('pre-version-copy', 'Old article', 'pre-version-copy', 1, 'Preserve this body', 'published')`).run();
    const source = await blueDb.prepare("SELECT * FROM posts WHERE public_id = 'pre-version-copy'").first();
    assert.ok(source);
    assert.equal(Object.hasOwn(source, "version"), false, "Blue must actually lack the new column");
    const columns = Object.keys(source);
    await greenDb.prepare(`INSERT INTO posts (${columns.map((name) => `"${name}"`).join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})`).bind(...Object.values(source)).run();
    const copied = await greenDb.prepare(`SELECT public_id, slug, content, status, version FROM posts
      WHERE public_id = 'pre-version-copy'`).first();
    assert.deepEqual(copied, {
      public_id: "pre-version-copy", slug: "pre-version-copy", content: "Preserve this body",
      status: "published", version: 1,
    });
  } finally {
    await Promise.allSettled([blue.close(), green.close()]);
  }
});

const equivalentNamedUniqueIndexes = new Set([
  "attachments_object_key_uidx",
  "attachments_public_id_uidx",
  "attachment_cleanup_queue_object_key_uidx",
  "oauth_access_tokens_hash_uidx",
  "oauth_authorization_codes_hash_uidx",
  "oauth_clients_client_id_uidx",
  "oauth_refresh_tokens_hash_uidx",
  "site_memberships_user_id_uidx",
  "user_identities_provider_subject_uidx",
]);

async function uniqueIndexSignatures(db, table) {
  const indexes = await db.prepare(`PRAGMA index_list(${table})`).all();
  const signatures = [];
  for (const index of indexes.results ?? []) {
    if (!index.unique) continue;
    const columns = await db.prepare(`PRAGMA index_info(${index.name})`).all();
    signatures.push((columns.results ?? []).map((column) => column.name).join(","));
  }
  return signatures;
}

function comparableShape(shape) {
  return shape
    .filter((entry) => !(
      entry.type === "index" && equivalentNamedUniqueIndexes.has(entry.name)
    ) && !(
      entry.type === "trigger" && entry.name.startsWith("posts_public_id_required_")
    ))
    .map((entry) => {
      if (entry.type !== "table") return entry;
      return {
        ...entry,
        columns: entry.columns.map((column) => ({
          ...column,
          // Drizzle makes PKs explicitly NOT NULL. The migrated constraint is
          // stricter for text PKs, and equivalent for integer PKs.
          notnull: column.pk ? 1 : column.name === "public_id" && entry.name === "posts" ? 1 : column.notnull,
          default: column.default === "true" ? "1" : column.default === "false" ? "0" : column.default,
        })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
}

test("the versioned migration chain reconstructs the runtime database schema", async () => {
  const migrated = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development" } }],
  });
  await migrated.listen();
  let runtime;
  try {
    const { DB: migrationDb } = await migrated.getWorker().getEnv();
    const files = readdirSync(MIGRATIONS_ROOT)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    assert.ok(files.length > 0, "a versioned migration chain must exist");
    for (const file of files) {
      if (file.startsWith("0011_")) {
        await migrationDb.prepare(`INSERT INTO posts (public_id, title, slug, category_id, content)
          VALUES ('pre-version-post', 'old article', 'pre-version-post', 1, 'preserved body')`).run();
      }
      await applySqlFile(migrationDb, file);
    }
    const migratedPost = await migrationDb.prepare(
      "SELECT content, version FROM posts WHERE public_id = 'pre-version-post'",
    ).first();
    assert.deepEqual(migratedPost, { content: "preserved body", version: 1 },
      "the article version migration must preserve existing content and backfill version 1");

    runtime = await openTestHarness();
    const rawMigratedShape = await schemaShape(migrationDb);
    const migratedShape = comparableShape(rawMigratedShape);
    const runtimeShape = comparableShape(await schemaShape(runtime.db));
    const runtimeByKey = new Map(runtimeShape.map((entry) => [`${entry.type}:${entry.name}`, entry]));
    const migratedByKey = new Map(migratedShape.map((entry) => [`${entry.type}:${entry.name}`, entry]));
    const differences = [];
    for (const key of new Set([...runtimeByKey.keys(), ...migratedByKey.keys()])) {
      const expected = runtimeByKey.get(key);
      const actual = migratedByKey.get(key);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        if (!expected || !actual) {
          differences.push(`${key}: ${actual ? "migration only" : "runtime only"}`);
        } else if (actual.type === "table") {
          const actualColumns = new Map(actual.columns.map((column) => [column.name, column]));
          const expectedColumns = new Map(expected.columns.map((column) => [column.name, column]));
          for (const name of new Set([...actualColumns.keys(), ...expectedColumns.keys()])) {
            if (JSON.stringify(actualColumns.get(name)) !== JSON.stringify(expectedColumns.get(name))) {
              differences.push(`${key}.${name}: migration=${JSON.stringify(actualColumns.get(name))} runtime=${JSON.stringify(expectedColumns.get(name))}`);
            }
          }
        } else {
          differences.push(`${key}: migration=${JSON.stringify(actual)} runtime=${JSON.stringify(expected)}`);
        }
      }
    }
    assert.deepEqual(differences, []);

    for (const name of equivalentNamedUniqueIndexes) {
      const index = rawMigratedShape.find((entry) => entry.type === "index" && entry.name === name);
      assert.equal(index?.unique, 1, `${name} must enforce uniqueness`);
      const runtimeUnique = await uniqueIndexSignatures(runtime.db, index.table);
      assert.ok(runtimeUnique.includes(index.columns.join(",")), `${name} must match an inline runtime UNIQUE constraint`);
    }

    // An old migration added public_id as nullable; the final migration must
    // restore the runtime's required-ID invariant before accepting any writes.
    for (const publicId of [null, ""]) {
      await assert.rejects(migrationDb.prepare(
        "INSERT INTO posts (public_id, title, slug, category_id) VALUES (?, 'test', ?, 1)",
      ).bind(publicId, `invalid-${publicId ?? "null"}`).run());
    }
    await migrationDb.prepare(
      "INSERT INTO posts (public_id, title, slug, category_id, status) VALUES ('schema-test-id', 'searchable', 'schema-test', 1, 'published')",
    ).run();
    await assert.rejects(migrationDb.prepare(
      "UPDATE posts SET public_id = NULL WHERE public_id = 'schema-test-id'",
    ).run());
    const search = await migrationDb.prepare("SELECT rowid FROM posts_fts WHERE posts_fts MATCH 'searchable'").all();
    assert.equal(search.results?.length, 1, "the migration-built FTS triggers must index posts");
    const cache = await migrationDb.prepare("SELECT revision FROM public_cache_state WHERE id = 1").first();
    assert.ok(cache?.revision > 1, "the migration-built public cache triggers must advance the revision");
    await migrationDb.prepare("INSERT INTO spaces(id,parent_id,name,slug,workspace_id) VALUES(42,NULL,'Schema private','schema-private-test',1)").run();
    await migrationDb.prepare(
      "INSERT INTO posts (public_id, title, slug, category_id, space_id, status) VALUES ('private-schema-test', 'private', 'private-schema-test', 1, 42, 'published')",
    ).run();
    const afterPrivate = await migrationDb.prepare("SELECT revision FROM public_cache_state WHERE id = 1").first();
    assert.equal(afterPrivate?.revision, cache.revision, "private posts must not invalidate the public cache");
  } finally {
    await closeTestHarness(runtime);
    await migrated.close();
  }
});

test("malformed existing schema metadata fails without request-time DDL", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await DB.prepare("CREATE TABLE app_meta (key TEXT PRIMARY KEY)").run();
    const response = await worker.fetch("/");
    assert.equal(response.status, 500);
    const postsTable = await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'").first();
    assert.equal(postsTable, null, "a malformed existing database must not be initialized as a fresh one");
  } finally {
    await server.close();
  }
});

test("category conflicts and storage failures produce different responses", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const first = await jsonRequest(harness, "/api/categories", {
      method: "POST", cookie, body: { name: "Local category", slug: "local-category" },
    });
    assert.equal(first.status, 201);
    const second = await jsonRequest(harness, "/api/categories", {
      method: "POST", cookie, body: { name: "Other category", slug: "other-category" },
    });
    assert.equal(second.status, 201);
    const secondId = (await second.json()).category.id;
    const conflict = await jsonRequest(harness, "/api/categories", {
      method: "POST", cookie, body: { name: "Duplicate", slug: "local-category" },
    });
    assert.equal(conflict.status, 409, "a duplicate slug is a real conflict");
    const editConflict = await jsonRequest(harness, `/api/categories/${secondId}`, {
      method: "PATCH", cookie, body: { slug: "local-category" },
    });
    assert.equal(editConflict.status, 409, "an edited slug conflict is not a storage failure");
    await assert.rejects(harness.db.prepare(
      "INSERT INTO categories (name, slug) VALUES ('Duplicate SQL', 'local-category')",
    ).run(), /UNIQUE constraint failed: categories.slug/);

    await harness.db.prepare("DROP TABLE categories").run();
    const storageFailure = await jsonRequest(harness, "/api/categories", {
      method: "POST", cookie, body: { name: "Unavailable", slug: "unavailable-category" },
    });
    assert.equal(storageFailure.status, 500,
      "a broken database must not be reported as a duplicate category");
    const editStorageFailure = await jsonRequest(harness, `/api/categories/${secondId}`, {
      method: "PATCH", cookie, body: { name: "Renamed while unavailable" },
    });
    assert.equal(editStorageFailure.status, 500,
      "a broken database must not be reported as an edit conflict");
  } finally {
    await closeTestHarness(harness);
  }
});

test("site settings updates cannot report success when the settings row is missing", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    await harness.db.prepare("DELETE FROM site_settings WHERE id = 1").run();
    const response = await jsonRequest(harness, "/api/settings", {
      method: "PATCH", cookie, body: { brandName: "Unpersisted brand" },
    });
    assert.equal(response.status, 500, "a no-op update must not claim the setting was saved");
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS count FROM site_settings").first())?.count, 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("isolated local production preview can still initialize an empty D1", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc",
      vars: { APP_ENV: "production", DB_SCHEMA_MODE: "local-preview-bootstrap" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const response = await worker.fetch("/");
    assert.equal(response.status, 200, "the explicitly isolated preview keeps its empty-site workflow");
    const { DB } = await worker.getEnv();
    assert.equal((await DB.prepare("SELECT value FROM app_meta WHERE key='app_environment'").first())?.value,
      "production");
    assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM posts").first())?.count, 0);
  } finally {
    await server.close();
  }
});

test("production legacy mode refuses empty or older D1 without request-time migration", async () => {
  for (const state of ["empty", "schema-12"]) {
    const server = createTestHarness({
      root: SITE_ROOT,
      workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "production", DB_SCHEMA_MODE: "legacy-bootstrap" } }],
    });
    await server.listen();
    try {
      const worker = server.getWorker();
      const { DB } = await worker.getEnv();
      if (state === "schema-12") {
        await DB.prepare("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
        await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '12'), ('app_environment', 'production'), ('instance_id', 'production:integration')").run();
      }
      const before = (await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results;
      const response = await worker.fetch("/");
      assert.equal(response.status, 500, `${state} production D1 must not be upgraded by a request`);
      const after = (await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB '_cf_*' ORDER BY name").all()).results;
      assert.deepEqual(after, before, `${state} production D1 schema must remain unchanged`);
      if (state === "schema-12") {
        assert.equal((await DB.prepare("SELECT value FROM app_meta WHERE key='schema_version'").first())?.value, "12");
      }
    } finally {
      await server.close();
    }
  }
});

test("a newer database schema is never downgraded by an older worker", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await DB.prepare("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '26'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    const response = await worker.fetch("/");
    assert.equal(response.status, 500, "an older worker must refuse a newer schema");
    const version = await DB.prepare("SELECT value FROM app_meta WHERE key='schema_version'").first();
    assert.equal(version?.value, "26", "the version marker must remain unchanged");
    const postsTable = await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'").first();
    assert.equal(postsTable, null, "the rejected request must not create application tables");
  } finally {
    await server.close();
  }
});

test("an older database from another environment is rejected before initialization", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await DB.prepare("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '12'), ('app_environment', 'production'), ('instance_id', 'production:integration')").run();
    const response = await worker.fetch("/");
    assert.equal(response.status, 500, "the environment boundary must be checked before upgrade DDL");
    const postsTable = await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'").first();
    assert.equal(postsTable, null);
  } finally {
    await server.close();
  }
});

test("legacy initialization refuses historical Slug collisions before upgrading", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await DB.prepare("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '13'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    await DB.prepare("CREATE TABLE posts (id INTEGER PRIMARY KEY, slug TEXT NOT NULL)").run();
    await DB.prepare("CREATE TABLE post_slug_history (post_id INTEGER NOT NULL, slug TEXT NOT NULL)").run();
    await DB.prepare("INSERT INTO posts (id, slug) VALUES (1, 'occupied-slug')").run();
    await DB.prepare("INSERT INTO post_slug_history (post_id, slug) VALUES (2, 'occupied-slug')").run();
    const response = await worker.fetch("/");
    assert.equal(response.status, 500, "a conflicting old database must not be silently upgraded");
    const marker = await DB.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first();
    assert.equal(marker?.value, "13");
    const guard = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'posts_history_slug_guard_insert'").first();
    assert.equal(guard, null, "the preflight must run before any new schema objects are created");
  } finally {
    await server.close();
  }
});

test("legacy schema 13 upgrades to the current schema while preserving posts and historical links", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "legacy-bootstrap" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    const publicId = `01${"K".repeat(24)}`;
    await applyVersionedMigrations(DB, "0012_reserve-historical-slugs.sql");
    // Mirror the pre-upgrade site without touching schema-17 seeds: the legacy
    // request path seeds users, identities and memberships itself.
    await DB.prepare("INSERT INTO categories (id, name, slug) VALUES (1, 'Legacy default', 'notes')").run();
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '13'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    await DB.prepare(`INSERT INTO posts (public_id, title, slug, category_id, content, status, published_at)
      VALUES (?, 'Preserved article', 'upgrade-current', 1, '# Preserved body', 'published', '2025-01-01')`)
      .bind(publicId).run();
    const postBefore = await DB.prepare("SELECT id, public_id, slug, content, status, version FROM posts WHERE public_id = ?")
      .bind(publicId).first();
    await DB.prepare("INSERT INTO post_slug_history (post_id, slug) VALUES (?, 'upgrade-old')")
      .bind(postBefore.id).run();
    const historyBefore = await DB.prepare("SELECT id, post_id, slug FROM post_slug_history WHERE post_id = ?")
      .bind(postBefore.id).first();
    const oldGuard = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'posts_history_slug_guard_insert'").first();
    assert.equal(oldGuard, null, "the rehearsal must start from schema 13, without the new guard");

    const response = await worker.fetch("/");
    assert.equal(response.status, 200, "valid legacy data must upgrade and serve normally");
    const marker = await DB.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first();
    assert.equal(marker?.value, "25");
    const postAfter = await DB.prepare("SELECT id, public_id, slug, content, status, version FROM posts WHERE public_id = ?")
      .bind(publicId).first();
    assert.deepEqual(postAfter, postBefore, "upgrading must not rewrite the article");
    const historyAfter = await DB.prepare("SELECT id, post_id, slug FROM post_slug_history WHERE post_id = ?")
      .bind(postBefore.id).first();
    assert.deepEqual(historyAfter, historyBefore, "upgrading must preserve historical Slugs");
    const guards = await DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'
      AND name IN ('posts_history_slug_guard_insert', 'posts_history_slug_guard_update',
        'history_current_slug_guard_insert', 'history_current_slug_guard_update') ORDER BY name`).all();
    assert.equal(guards.results?.length, 4, "the upgraded database must enforce both sides of Slug uniqueness");
    const oldLink = await worker.fetch("/posts/upgrade-old", { redirect: "manual" });
    assert.ok([301, 308].includes(oldLink.status), `historical Slug must still redirect, got ${oldLink.status}`);
    assert.match(oldLink.headers.get("location") ?? "", /upgrade-current/);
    const schemaBeforeRepeat = await DB.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    assert.equal((await worker.fetch("/")).status, 200);
    const schemaAfterRepeat = await DB.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    assert.deepEqual(schemaAfterRepeat.results, schemaBeforeRepeat.results, "repeat requests must not change the schema");
  } finally {
    await server.close();
  }
});

test("migration-only startup rejects an empty database without running DDL", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    const response = await worker.fetch("/");
    assert.equal(response.status, 500);
    const postsTable = await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'").first();
    assert.equal(postsTable, null, "the request must not repair an unmigrated database");
  } finally {
    await server.close();
  }
});

test("migration-only startup waits for an interrupted local migration and recovers after completion", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await applyVersionedMigrations(DB, "0012_reserve-historical-slugs.sql");
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '13'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    await DB.prepare("INSERT INTO categories (id, name, slug) VALUES (1, 'Retained category', 'retained-category')").run();
    await DB.prepare("INSERT INTO site_settings (id) VALUES (1)").run();
    await DB.prepare(`INSERT INTO posts (public_id, title, slug, category_id, content, status)
      VALUES ('local-interrupted-id', 'Retained post', 'local-interrupted', 1, '# Retained content', 'draft')`).run();
    const postBefore = await DB.prepare("SELECT public_id, title, slug, category_id, content, status, version FROM posts WHERE slug = 'local-interrupted'").first();
    const schemaBefore = await DB.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();

    assert.equal((await worker.fetch("/")).status, 500, "the worker must not repair an incomplete migration");
    const schemaAfterRejection = await DB.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    assert.deepEqual(schemaAfterRejection.results, schemaBefore.results);
    assert.equal((await DB.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first())?.value, "13");

    await applySqlFile(DB, "0012_reserve-historical-slugs.sql");
    await applySqlFile(DB, "0013_bitter_caretaker.sql");
    await applySqlFile(DB, "0014_hot_the_stranger.sql");
    await applySqlFile(DB, "0015_amused_donald_blake.sql");
    await applySqlFile(DB, "0016_bouncy_luckman.sql");
    await applySqlFile(DB, "0017_tiny_christian_walker.sql");
    await applySqlFile(DB, "0018_identity_email_login.sql");
    await applySqlFile(DB, "0019_workspaces_and_verification.sql");
    await applySqlFile(DB, "0020_workspace_collaboration.sql");
    await applySqlFile(DB, "0021_organizations_and_units.sql");
    await applySqlFile(DB, "0022_teams_workspace_grants_space_acl.sql");
    await applySqlFile(DB, "seed-app-defaults.sql");
    const retainedCategory = await DB.prepare("SELECT name FROM categories WHERE id = 1").first();
    assert.equal(retainedCategory?.name, "Retained category", "retrying the seed must not overwrite existing data");
    await DB.prepare("UPDATE app_meta SET value = '25' WHERE key = 'schema_version'").run();
    const schemaBeforeRecovery = await DB.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    assert.equal((await worker.fetch("/")).status, 200, "the same worker must recover once migration is complete");
    const schemaAfterRecovery = await DB.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    assert.deepEqual(schemaAfterRecovery.results, schemaBeforeRecovery.results, "recovery requests must not execute DDL");
    const postAfter = await DB.prepare("SELECT public_id, title, slug, category_id, content, status, version FROM posts WHERE slug = 'local-interrupted'").first();
    assert.deepEqual(postAfter, postBefore, "recovery must not alter existing articles");
  } finally {
    await server.close();
  }
});

test("migration-only startup rejects a version-marked database with a missing secondary table", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await applyVersionedMigrations(DB);
    await applySqlFile(DB, "seed-app-defaults.sql");
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '25'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    await DB.prepare("DROP TABLE attachments").run();
    const response = await worker.fetch("/");
    assert.equal(response.status, 500, "a version marker alone cannot validate the complete schema");
    const missing = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'").first();
    assert.equal(missing, null, "startup must not recreate the missing table");
  } finally {
    await server.close();
  }
});

test("migration-only startup rejects a marked database without the post version column", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await applyVersionedMigrations(DB);
    await applySqlFile(DB, "seed-app-defaults.sql");
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '25'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    await DB.prepare("ALTER TABLE posts RENAME COLUMN version TO obsolete_version").run();
    assert.equal((await worker.fetch("/connect")).status, 500,
      "a public page must not pass startup when article edits cannot use optimistic versions");
    const columns = await DB.prepare("PRAGMA table_info(posts)").all();
    assert.equal(columns.results?.some((column) => column.name === "version"), false,
      "startup must not change the marked schema");
  } finally {
    await server.close();
  }
});

test("migration-only startup rejects an ordinary table in place of FTS5", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await applyVersionedMigrations(DB);
    await applySqlFile(DB, "seed-app-defaults.sql");
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '25'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    await DB.prepare("DROP TABLE posts_fts").run();
    await DB.prepare("CREATE TABLE posts_fts (rowid INTEGER PRIMARY KEY, title TEXT, excerpt TEXT, content TEXT)").run();
    assert.equal((await worker.fetch("/")).status, 500,
      "a version marker and table name cannot substitute for the FTS5 search index");
    const table = await DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts_fts'").first();
    assert.match(table?.sql ?? "", /^CREATE TABLE posts_fts\b/i, "startup must not replace the invalid table");
    await DB.prepare("DROP TABLE posts_fts").run();
    await DB.prepare("CREATE VIRTUAL TABLE posts_fts USING fts5(title, excerpt, content)").run();
    assert.equal((await worker.fetch("/")).status, 500,
      "an unlinked FTS5 table cannot stand in for the posts-backed search index");
  } finally {
    await server.close();
  }
});

test("migration-only startup rejects a marked database without the public ID guards", async () => {
  for (const guardName of ["posts_public_id_required_insert", "posts_public_id_required_update"]) {
    const server = createTestHarness({
      root: SITE_ROOT,
      workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
    });
    await server.listen();
    try {
      const worker = server.getWorker();
      const { DB } = await worker.getEnv();
      await applyVersionedMigrations(DB);
      await applySqlFile(DB, "seed-app-defaults.sql");
      await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '25'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
      await DB.prepare(`DROP TRIGGER ${guardName}`).run();
      assert.equal((await worker.fetch("/")).status, 500,
        `a migration marker must not accept a database without ${guardName}`);
      const guard = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?").bind(guardName).first();
      assert.equal(guard, null, "startup must not recreate the missing trigger");
    } finally {
      await server.close();
    }
  }
});

test("migration-only startup rejects a named index with missing or misplaced uniqueness", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await applyVersionedMigrations(DB);
    await applySqlFile(DB, "seed-app-defaults.sql");
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '25'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    await DB.prepare("DROP INDEX categories_slug_uidx").run();
    await DB.prepare("CREATE INDEX categories_slug_uidx ON categories (slug)").run();
    const response = await worker.fetch("/");
    assert.equal(response.status, 500, "an index name cannot substitute for its UNIQUE constraint");
    const index = await DB.prepare("PRAGMA index_list(categories)").all();
    assert.equal(index.results?.find((row) => row.name === "categories_slug_uidx")?.unique, 0,
      "startup must not silently repair the schema");
    await DB.prepare("DROP INDEX categories_slug_uidx").run();
    await DB.prepare("CREATE UNIQUE INDEX categories_slug_uidx ON categories (name)").run();
    assert.equal((await worker.fetch("/")).status, 500,
      "uniqueness on the wrong column must not count as the category slug constraint");
    await DB.prepare("DROP INDEX categories_slug_uidx").run();
    await DB.prepare("CREATE UNIQUE INDEX categories_slug_uidx ON content_pages (slug)").run();
    assert.equal((await worker.fetch("/")).status, 500,
      "an index on the right column of another table cannot protect category slugs");
    await DB.prepare("DROP INDEX categories_slug_uidx").run();
    await DB.prepare("CREATE UNIQUE INDEX categories_slug_uidx ON categories (slug) WHERE slug <> 'filtered'").run();
    assert.equal((await worker.fetch("/")).status, 500,
      "a partial category index cannot protect every slug");
    await DB.prepare("DROP INDEX categories_slug_uidx").run();
    await DB.prepare("CREATE UNIQUE INDEX categories_slug_uidx ON categories (slug)").run();
    await DB.prepare("DROP INDEX spaces_root_slug_uidx").run();
    await DB.prepare("CREATE UNIQUE INDEX spaces_root_slug_uidx ON spaces (slug) WHERE parent_id IS NOT NULL").run();
    assert.equal((await worker.fetch("/")).status, 500,
      "a root-space index with the opposite predicate cannot protect root slugs");
  } finally {
    await server.close();
  }
});

test("migration-only startup rejects a marked database without required seed data", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await applyVersionedMigrations(DB);
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '25'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();
    const response = await worker.fetch("/");
    assert.equal(response.status, 500, "version markers must not hide a skipped seed step");
    const settings = await DB.prepare("SELECT id FROM site_settings WHERE id = 1").first();
    assert.equal(settings, null, "startup must not silently seed incomplete data");
    await DB.prepare("INSERT INTO site_settings (id) VALUES (1)").run();
    await DB.prepare("INSERT INTO categories (id, name, slug) VALUES (1, 'Temporary', 'temporary')").run();
    const partial = await worker.fetch("/");
    assert.equal(partial.status, 500, "settings and a category cannot mask missing editable pages");
    const pages = await DB.prepare("SELECT COUNT(*) AS count FROM content_pages").first();
    assert.equal(pages?.count, 0, "startup must not create pages after rejecting partial data");
  } finally {
    await server.close();
  }
});

test("a locally migrated and seeded database serves public and admin pages without request-time DDL", async () => {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{
      configPath: "./wrangler.production.jsonc",
      vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" },
      secrets: {
        ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        ADMIN_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
        MCP_WRITE_TOKEN: TEST_LEGACY_MCP_TOKEN,
      },
    }],
  });
  const { url } = await server.listen();
  let runtime;
  try {
    const worker = server.getWorker();
    const { DB, MEDIA } = await worker.getEnv();
    const harness = { dispatch: (path, init) => worker.fetch(path, init), origin: url.origin };
    await applyVersionedMigrations(DB);
    await applySqlFile(DB, "seed-app-defaults.sql");
    await applySqlFile(DB, "seed-chatgpt-oauth.sql");
    runtime = await openTestHarness();
    const withoutVolatileColumns = (row) => Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== "created_at" && key !== "updated_at"),
    );
    for (const table of ["site_settings", "categories", "content_pages", "oauth_clients"]) {
      const migratedRows = await DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
      const legacyRows = await runtime.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
      assert.deepEqual(migratedRows.results?.map(withoutVolatileColumns), legacyRows.results?.map(withoutVolatileColumns),
        `${table} defaults must match the existing initialization path`);
    }
    await DB.prepare("UPDATE content_pages SET title = 'Locally customized about page' WHERE slug = 'about'").run();
    await applySqlFile(DB, "seed-app-defaults.sql");
    const retainedTitle = await DB.prepare("SELECT title FROM content_pages WHERE slug = 'about'").first();
    assert.equal(retainedTitle?.title, "Locally customized about page", "reapplying defaults must preserve edited content");
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '25'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();

    const settings = await DB.prepare("SELECT id FROM site_settings WHERE id = 1").first();
    assert.equal(settings?.id, 1);
    const pages = await DB.prepare("SELECT slug, length(content) AS content_length FROM content_pages ORDER BY slug").all();
    assert.deepEqual(pages.results?.map(({ slug }) => slug), ["about", "connect"]);
    assert.ok(pages.results?.every(({ content_length }) => content_length > 100));
    const schemaBeforeRequests = await DB.prepare(
      "SELECT type, name, tbl_name, rootpage, sql FROM sqlite_master ORDER BY type, name",
    ).all();

    for (const path of ["/", "/about", "/connect", "/admin/login"]) {
      const response = await worker.fetch(path);
      assert.equal(response.status, 200, `${path} must render from the migrated database`);
    }
    const cookie = await loginAdmin(harness);
    const settingsBeforePatch = await DB.prepare(
      "SELECT brand_latin, tagline, home_post_limit FROM site_settings WHERE id = 1",
    ).first();
    const settingsPatch = await jsonRequest(harness, "/api/settings", {
      method: "PATCH", cookie, body: { brandName: "Migrated brand" },
    });
    assert.equal(settingsPatch.status, 200, await settingsPatch.clone().text());
    const settingsAfterPatch = await DB.prepare(
      "SELECT brand_name, brand_latin, tagline, home_post_limit FROM site_settings WHERE id = 1",
    ).first();
    assert.deepEqual(settingsAfterPatch, {
      brand_name: "Migrated brand",
      ...settingsBeforePatch,
    }, "a partial settings update must preserve every omitted field");
    const pageBeforePatch = await DB.prepare(
      "SELECT eyebrow, excerpt, content FROM content_pages WHERE slug = 'about'",
    ).first();
    const pagePatch = await jsonRequest(harness, "/api/pages/about", {
      method: "PATCH", cookie, body: { title: "Migrated about title" },
    });
    assert.equal(pagePatch.status, 200, await pagePatch.clone().text());
    const pageAfterPatch = await DB.prepare(
      "SELECT title, eyebrow, excerpt, content FROM content_pages WHERE slug = 'about'",
    ).first();
    assert.deepEqual(pageAfterPatch, {
      title: "Migrated about title",
      ...pageBeforePatch,
    }, "a partial page update must preserve the existing Markdown and metadata");
    const addedCategory = await jsonRequest(harness, "/api/categories", {
      method: "POST", cookie, body: { name: "Migration test", slug: "migration-test", color: "#336699" },
    });
    assert.equal(addedCategory.status, 201, await addedCategory.clone().text());
    const categoryId = (await addedCategory.json()).category.id;
    const renamedCategory = await jsonRequest(harness, `/api/categories/${categoryId}`, {
      method: "PATCH", cookie, body: { name: "Migration checked" },
    });
    assert.equal(renamedCategory.status, 200, await renamedCategory.clone().text());
    assert.deepEqual(await DB.prepare("SELECT name, slug, color FROM categories WHERE id = ?")
      .bind(categoryId).first(), {
      name: "Migration checked", slug: "migration-test", color: "#336699",
    }, "renaming a category must preserve its omitted slug and color");
    const removedCategory = await jsonRequest(harness, `/api/categories/${categoryId}`, {
      method: "DELETE", cookie,
    });
    assert.equal(removedCategory.status, 200, await removedCategory.clone().text());
    assert.equal(await DB.prepare("SELECT id FROM categories WHERE id = ?")
      .bind(categoryId).first(), null);
    const deleteMissingCategory = await jsonRequest(harness, `/api/categories/${categoryId}`, {
      method: "DELETE", cookie,
    });
    assert.equal(deleteMissingCategory.status, 404, "deleting an absent category must not report success");
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie,
      body: {
        title: "Migrated schema write contract", slug: "migrated-schema-write-contract",
        excerpt: "local migration rehearsal", content: "# Migrated schema write contract",
        categoryId: 1, spaceId: null, status: "draft", featured: false, publishedAt: null,
      },
    });
    assert.equal(created.status, 201, `admin draft creation must work after migration: ${await created.text()}`);
    const post = await DB.prepare("SELECT id, public_id, version FROM posts WHERE slug = 'migrated-schema-write-contract'").first();
    assert.ok(post?.public_id);
    assert.equal(post.version, 1);
    await initializeMcp(harness, TEST_LEGACY_MCP_TOKEN);
    const read = await callMcpTool(harness, {
      name: "get_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.public_id, view: "meta" },
    });
    assert.equal(read.isError, undefined, JSON.stringify(read.structuredContent));
    assert.equal(read.structuredContent?.post?.public_id, post.public_id);
    const edited = await jsonRequest(harness, `/api/posts/${post.id}`, {
      method: "PATCH", cookie,
      body: {
        title: "Migrated schema write contract", slug: "migrated-schema-write-contract",
        excerpt: "local migration rehearsal", content: "# Edited in the admin",
        categoryId: 1, spaceId: null, status: "draft", featured: false,
        publishedAt: null, version: post.version,
      },
    });
    assert.equal(edited.status, 200, `admin editing must work after migration: ${await edited.clone().text()}`);
    const agentEdit = await callMcpTool(harness, {
      name: "update_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.public_id, expected_version: 2, content_markdown: "# Edited through MCP" },
    });
    assert.equal(agentEdit.isError, undefined, JSON.stringify(agentEdit.structuredContent));
    assert.equal(agentEdit.structuredContent?.post?.version, 3);
    const published = await callMcpTool(harness, {
      name: "publish_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.public_id, expected_version: 3 },
    });
    assert.equal(published.isError, undefined, JSON.stringify(published.structuredContent));
    const publicPath = `/posts/${post.public_id}/migrated-schema-write-contract`;
    assert.equal((await worker.fetch(publicPath)).status, 200,
      "a post published from a migrated database must be publicly readable");
    const unpublished = await callMcpTool(harness, {
      name: "unpublish_post", token: TEST_LEGACY_MCP_TOKEN,
      arguments: { identifier: post.public_id, expected_version: 4 },
    });
    assert.equal(unpublished.isError, undefined, JSON.stringify(unpublished.structuredContent));
    assert.equal((await worker.fetch(publicPath)).status, 404,
      "an unpublished migrated post must disappear from public reading");
    const finalPost = await DB.prepare("SELECT content, status, version FROM posts WHERE id = ?").bind(post.id).first();
    assert.deepEqual(finalPost, { content: "# Edited through MCP", status: "draft", version: 5 });

    const spaceResponse = await jsonRequest(harness, "/api/spaces", {
      method: "POST", cookie,
      body: { name: "Migrated private space", slug: "migrated-private-space", parentId: null, sortOrder: 0 },
    });
    assert.equal(spaceResponse.status, 201, `private space creation must work after migration: ${await spaceResponse.clone().text()}`);
    const spaceId = (await spaceResponse.json()).space.id;
    const privateResponse = await jsonRequest(harness, "/api/posts", {
      method: "POST", cookie,
      body: {
        title: "Private migration article", slug: "private-migration-article", excerpt: "private",
        content: "# Private migration article", categoryId: 1, spaceId,
        status: "published", featured: false, publishedAt: null,
      },
    });
    assert.equal(privateResponse.status, 201, `private article creation must work after migration: ${await privateResponse.clone().text()}`);
    const privatePost = (await privateResponse.json()).post;
    assert.equal((await worker.fetch(`/posts/${privatePost.publicId}/private-migration-article`)).status, 404,
      "a published space article must remain private after migration");
    assert.equal((await worker.fetch(`/admin/reader/${privatePost.publicId}`, { headers: { cookie } })).status, 200,
      "the administrator must still be able to read a private space article");

    const boundary = "----XingyuMigrationAttachment";
    const multipart = [
      `--${boundary}\r\nContent-Disposition: form-data; name="postId"\r\n\r\n${privatePost.id}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="migration-note.txt"\r\nContent-Type: text/plain\r\n\r\nprivate migration attachment\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const uploaded = await worker.fetch("/api/attachments", {
      method: "POST", headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, body: multipart,
    });
    assert.equal(uploaded.status, 201, `private attachment upload must work after migration: ${await uploaded.clone().text()}`);
    const attachment = await uploaded.json();
    assert.equal((await worker.fetch(attachment.url)).status, 401,
      "an anonymous visitor must not download a private space attachment");
    const adminDownload = await worker.fetch(attachment.url, { headers: { cookie } });
    assert.equal(adminDownload.status, 200, "the administrator must be able to download the private attachment");
    assert.equal(await adminDownload.text(), "private migration attachment");

    const privateVersion = await DB.prepare("SELECT version FROM posts WHERE id = ?").bind(privatePost.id).first();
    const deletedPrivatePost = await jsonRequest(harness, `/api/posts/${privatePost.id}`, {
      method: "DELETE", cookie, body: { version: privateVersion?.version },
    });
    assert.equal(deletedPrivatePost.status, 200,
      `private article deletion must work after migration: ${await deletedPrivatePost.clone().text()}`);
    assert.equal(await DB.prepare("SELECT id FROM posts WHERE id = ?").bind(privatePost.id).first(), null);
    const detachedAttachment = await DB.prepare("SELECT post_id FROM attachments WHERE public_id = ?")
      .bind(attachment.id).first();
    assert.equal(detachedAttachment?.post_id, null,
      "deleting a private article must retain its attachment as private, recoverable data");
    assert.equal((await worker.fetch(attachment.url)).status, 401,
      "detached private bytes must not become public");
    const recoveredAttachment = await worker.fetch(attachment.url, { headers: { cookie } });
    assert.equal(recoveredAttachment.status, 200);
    assert.equal(await recoveredAttachment.text(), "private migration attachment");
    const object = await DB.prepare("SELECT object_key FROM attachments WHERE public_id = ?")
      .bind(attachment.id).first();
    assert.ok(await MEDIA.get(object.object_key));
    const deletedAttachment = await jsonRequest(harness, `/api/attachments/${attachment.id}`, {
      method: "DELETE", cookie, body: {},
    });
    assert.equal(deletedAttachment.status, 200,
      `detached attachment deletion must work after migration: ${await deletedAttachment.clone().text()}`);
    assert.equal(await DB.prepare("SELECT id FROM attachments WHERE public_id = ?")
      .bind(attachment.id).first(), null);
    assert.equal(await MEDIA.get(object.object_key), null,
      "deleting the detached attachment must remove its local R2 object");

    const marker = await DB.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first();
    assert.equal(marker?.value, "25");
    const schemaAfterRequests = await DB.prepare(
      "SELECT type, name, tbl_name, rootpage, sql FROM sqlite_master ORDER BY type, name",
    ).all();
    assert.deepEqual(schemaAfterRequests.results, schemaBeforeRequests.results,
      "serving pages and writing a draft must not change the database schema");
  } finally {
    await closeTestHarness(runtime);
    await server.close();
  }
});

test("representative legacy rows retain links and visibility in a local migration-built database", async () => {
  const blue = await openTestHarness();
  const green = createTestHarness({
    root: SITE_ROOT,
    workers: [{ configPath: "./wrangler.production.jsonc", vars: { APP_ENV: "development", DB_SCHEMA_MODE: "migration-only" } }],
  });
  try {
    const publicId = `01${"H".repeat(24)}`;
    const privateId = `01${"J".repeat(24)}`;
    await blue.db.prepare("INSERT INTO categories (id, name, slug) VALUES (2, 'Legacy knowledge', 'legacy-knowledge')").run();
    await blue.db.prepare("INSERT INTO spaces (id, name, slug) VALUES (10, 'Legacy team', 'legacy-team')").run();
    await blue.db.prepare(`INSERT INTO posts
      (id, public_id, title, slug, category_id, content, status, published_at)
      VALUES (201, ?, 'Legacy public article', 'legacy-public-article', 2, '# Legacy public body', 'published', '2025-01-01')`)
      .bind(publicId).run();
    await blue.db.prepare(`INSERT INTO posts
      (id, public_id, title, slug, category_id, space_id, content, status, published_at)
      VALUES (202, ?, 'Legacy private article', 'legacy-private-article', 2, 10, '# Legacy private body', 'published', '2025-01-02')`)
      .bind(privateId).run();
    await blue.db.prepare("INSERT INTO post_slug_history (id, post_id, slug) VALUES (301, 201, 'legacy-old-slug')").run();
    await blue.db.prepare(`INSERT INTO attachments
      (id, public_id, post_id, object_key, original_name, content_type, size, sha256)
      VALUES (401, 'legacy-attachment', 202, 'legacy/object.txt', 'object.txt', 'text/plain', 4, 'test-sha256')`).run();
    await blue.db.prepare(`INSERT INTO oauth_clients
      (id, client_id, client_name, allowed_scopes)
      VALUES (30, 'local-legacy-client', 'Legacy agent', 'xingyu.read xingyu.draft')`).run();
    await blue.db.prepare(`INSERT INTO oauth_access_tokens
      (id, token_hash, client_id, subject, resource, scope, expires_at)
      VALUES (31, 'local-test-token-hash', 'local-legacy-client', 'local-owner',
        'https://example.invalid/mcp', 'xingyu.read', 1999999999)`).run();
    await blue.db.prepare(`INSERT INTO oauth_consents
      (id, subject, client_id, resource, granted_scopes, granted_at)
      VALUES (32, 'local-owner', 'local-legacy-client', 'https://example.invalid/mcp', 'xingyu.read', 1000)`).run();
    await blue.db.prepare(`INSERT INTO post_views (post_id, visitor_hash, viewed_on)
      VALUES (201, 'synthetic-visitor-hash', '2025-01-01')`).run();
    await blue.db.prepare(`INSERT INTO mcp_activity (id, action, post_id, public_id, title)
      VALUES (33, 'update_post', 201, ?, 'Legacy public article')`).bind(publicId).run();
    await blue.db.prepare(`INSERT INTO post_preview_tokens (id, post_id, token_hash, expires_at)
      VALUES (34, 202, 'synthetic-preview-hash', 1999999999)`).run();
    await blue.db.prepare(`INSERT INTO oauth_authorization_codes
      (id, code_hash, client_id, subject, redirect_uri, resource, scope, code_challenge, expires_at)
      VALUES (35, 'synthetic-code-hash', 'local-legacy-client', 'local-owner',
        'https://example.invalid/callback', 'https://example.invalid/mcp', 'xingyu.read',
        'synthetic-challenge', 1999999999)`).run();
    await blue.db.prepare(`INSERT INTO oauth_rate_limits (identifier, attempts, window_started, updated_at)
      VALUES ('synthetic-oauth-limit', 2, 1000, 1001)`).run();
    await blue.db.prepare(`INSERT INTO oauth_refresh_tokens
      (id, token_hash, family_id, client_id, subject, resource, scope, expires_at, absolute_expires_at)
      VALUES (36, 'synthetic-refresh-hash', 'synthetic-family', 'local-legacy-client',
        'local-owner', 'https://example.invalid/mcp', 'xingyu.read', 1999999999, 1999999999)`).run();
    await blue.db.prepare(`INSERT INTO admin_login_attempts
      (identifier, attempts, window_started, blocked_until, updated_at)
      VALUES ('synthetic-admin-limit', 3, 1000, 2000, 1001)`).run();
    await blue.db.prepare("UPDATE site_settings SET brand_name = 'Legacy brand' WHERE id = 1").run();

    await green.listen();
    const worker = green.getWorker();
    const { DB } = await worker.getEnv();
    await applyVersionedMigrations(DB);
    // Copy ordinary business tables, excluding app_meta, cache state, FTS and
    // migration history. This checks row compatibility, not CLI export behavior.
    const businessTables = [
      "categories", "spaces", "posts", "post_slug_history", "attachments",
      "content_pages", "site_settings", "post_views", "mcp_activity",
      "post_preview_tokens", "oauth_clients", "oauth_authorization_codes",
      "oauth_access_tokens", "oauth_consents", "oauth_rate_limits",
      "oauth_refresh_tokens", "admin_login_attempts",
    ];
    const sourceRows = new Map();
    for (const table of businessTables) {
      const rows = (await blue.db.prepare(`SELECT * FROM ${table}`).all()).results ?? [];
      assert.ok(rows.length > 0, `${table} must contain a synthetic row in this migration rehearsal`);
      sourceRows.set(table, rows);
      for (const row of rows) {
        const columns = Object.keys(row);
        await DB.prepare(`INSERT INTO ${table} (${columns.map((name) => `"${name}"`).join(", ")})
          VALUES (${columns.map(() => "?").join(", ")})`).bind(...Object.values(row)).run();
      }
    }
    await applySqlFile(DB, "seed-app-defaults.sql");
    await applySqlFile(DB, "seed-chatgpt-oauth.sql");
    for (const table of businessTables) {
      const destination = (await DB.prepare(`SELECT * FROM ${table}`).all()).results ?? [];
      const strip = (row) => {
        const entries = Object.entries(row).sort(([left], [right]) => left.localeCompare(right));
        if (table !== "posts") return JSON.stringify(Object.fromEntries(entries));
        // Attribution columns are repaired by the idempotent seeds after import;
        // compare everything else row-for-row.
        return JSON.stringify(Object.fromEntries(entries.filter(([key]) =>
          !["author_id", "created_by", "updated_by"].includes(key))));
      };
      const sortRows = (rows) => rows.map(strip).sort();
      assert.deepEqual(sortRows(destination), sortRows(sourceRows.get(table)),
        `${table} rows must survive import and later idempotent seeds unchanged`);
    }
    const attributed = await DB.prepare(`SELECT COUNT(*) AS count FROM posts
      WHERE author_id = 1 AND created_by = 1 AND updated_by = 1`).first();
    assert.equal(attributed?.count, 2,
      "imported legacy articles must be attributed to the site owner by the idempotent seeds");
    const owner = await DB.prepare(`SELECT u.id, i.provider, i.subject, m.role FROM users u
      JOIN user_identities i ON i.user_id = u.id
      JOIN site_memberships m ON m.user_id = u.id
      WHERE m.role = 'owner'`).first();
    assert.deepEqual(owner, { id: 1, provider: "local", subject: "owner", role: "owner" },
      "the migration-built site must carry its local owner identity and membership");
    await DB.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '25'), ('app_environment', 'development'), ('instance_id', 'development:integration')").run();

    const copied = await DB.prepare(`SELECT p.public_id, p.space_id, p.version, c.slug AS category_slug
      FROM posts p JOIN categories c ON c.id = p.category_id WHERE p.id IN (201, 202) ORDER BY p.id`).all();
    assert.deepEqual(copied.results, [
      { public_id: publicId, space_id: null, version: 1, category_slug: "legacy-knowledge" },
      { public_id: privateId, space_id: 10, version: 1, category_slug: "legacy-knowledge" },
    ]);
    const linked = await DB.prepare(`SELECT a.post_id, h.post_id AS history_post_id
      FROM attachments a JOIN post_slug_history h ON h.id = 301 WHERE a.id = 401`).first();
    assert.deepEqual(linked, { post_id: 202, history_post_id: 201 });
    const migratedBrand = await DB.prepare("SELECT brand_name FROM site_settings WHERE id = 1").first();
    assert.equal(migratedBrand?.brand_name, "Legacy brand");
    const oauth = await DB.prepare(`SELECT c.client_id, t.client_id AS token_client_id, q.client_id AS consent_client_id,
      t.scope, q.granted_scopes FROM oauth_clients c
      JOIN oauth_access_tokens t ON t.client_id = c.client_id
      JOIN oauth_consents q ON q.client_id = c.client_id WHERE c.id = 30`).first();
    assert.deepEqual(oauth, {
      client_id: "local-legacy-client", token_client_id: "local-legacy-client",
      consent_client_id: "local-legacy-client", scope: "xingyu.read", granted_scopes: "xingyu.read",
    });
    const search = await DB.prepare("SELECT rowid FROM posts_fts WHERE posts_fts MATCH 'Legacy' ORDER BY rowid").all();
    assert.deepEqual(search.results?.map(({ rowid }) => rowid), [201, 202],
      "derived FTS data must index imported articles through migration-built triggers");
    const auditSql = readFileSync(new URL("../../drizzle/verify-core-relations.sql", import.meta.url), "utf8");
    const cleanAudit = await DB.prepare(auditSql).all();
    assert.equal(cleanAudit.results?.length, 1);
    assert.equal(Object.keys(cleanAudit.results[0]).length, 16);
    assert.ok(Object.values(cleanAudit.results[0]).every((count) => count === 0),
      `valid migrated links must pass the cutover audit: ${JSON.stringify(cleanAudit.results)}`);
    await DB.prepare("UPDATE attachments SET post_id = 9999 WHERE id = 401").run();
    const orphanAudit = await DB.prepare(auditSql).first();
    assert.equal(orphanAudit?.attachments_missing_post, 1,
      "the read-only audit must detect an imported attachment with no article");
    await DB.prepare("UPDATE attachments SET post_id = 202 WHERE id = 401").run();
    await DB.prepare("UPDATE posts SET category_id = 9999 WHERE id = 201").run();
    const categoryAudit = await DB.prepare(auditSql).first();
    assert.equal(categoryAudit?.posts_missing_category, 1,
      "the read-only audit must detect an imported article with no category");
    await DB.prepare("UPDATE posts SET category_id = 2 WHERE id = 201").run();
    await DB.prepare("INSERT INTO spaces (id, name, slug, parent_id) VALUES (11, 'Loop A', 'loop-a', 12)").run();
    await DB.prepare("INSERT INTO spaces (id, name, slug, parent_id) VALUES (12, 'Loop B', 'loop-b', 11)").run();
    const cyclicSpaces = await DB.prepare(auditSql).first();
    assert.equal(cyclicSpaces?.spaces_unreachable_from_root, 2,
      "the audit must detect spaces trapped in a parent cycle");
    await DB.prepare("DELETE FROM spaces WHERE id IN (11, 12)").run();
    await DB.prepare("UPDATE oauth_access_tokens SET client_id = 'missing-client' WHERE id = 31").run();
    const orphanToken = await DB.prepare(auditSql).first();
    assert.equal(orphanToken?.access_tokens_missing_oauth_client, 1,
      "the audit must detect OAuth credentials whose client was not imported");
    await DB.prepare("UPDATE oauth_access_tokens SET client_id = 'local-legacy-client' WHERE id = 31").run();
    await DB.prepare("UPDATE posts SET author_id = NULL WHERE id = 201").run();
    const missingAuthor = await DB.prepare(auditSql).first();
    assert.equal(missingAuthor?.posts_missing_author, 1,
      "the audit must detect an article whose attribution was lost");
    await DB.prepare("UPDATE posts SET author_id = 1, created_by = 1, updated_by = 1 WHERE id = 201").run();
    await DB.prepare(`INSERT INTO user_identities (user_id, provider, subject)
      VALUES (9999, 'synthetic', 'orphan-identity')`).run();
    const orphanIdentity = await DB.prepare(auditSql).first();
    assert.equal(orphanIdentity?.identities_missing_user, 1,
      "the audit must detect an identity pointing at a missing user");
    await DB.prepare("DELETE FROM user_identities WHERE user_id = 9999").run();
    await assert.rejects(DB.prepare(
      "INSERT INTO post_slug_history (post_id, slug) VALUES (202, 'legacy-public-article')",
    ).run(), "the migrated schema must refuse a historical URL that shadows another article's current slug");
    const afterRejectedSlug = await DB.prepare(auditSql).first();
    assert.equal(afterRejectedSlug?.history_conflicts_current_slug, 0,
      "a rejected collision must not leave corrupt history behind");

    const publicResponse = await worker.fetch(`/posts/${publicId}/legacy-public-article`);
    assert.equal(publicResponse.status, 200, "the imported public article must render");
    const oldSlug = await worker.fetch("/posts/legacy-old-slug", { redirect: "manual" });
    assert.ok([301, 308].includes(oldSlug.status), `old slug must redirect, got ${oldSlug.status}`);
    assert.match(oldSlug.headers.get("location") ?? "", /legacy-public-article/);
    const privateResponse = await worker.fetch(`/posts/${privateId}/legacy-private-article`);
    assert.equal(privateResponse.status, 404, "an imported space article must remain private");
  } finally {
    await green.close();
    await closeTestHarness(blue);
  }
});

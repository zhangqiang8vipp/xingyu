import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTestHarness } from "./harness.mjs";

const SITE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_ROOT = fileURLToPath(new URL("../../drizzle/", import.meta.url));

async function applySqlFile(db, filename) {
  const sql = readFileSync(new URL(`../../drizzle/${filename}`, import.meta.url), "utf8");
  for (const statement of sql.split(/--> statement-breakpoint/).map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

async function prepareDatabase(db, { environment, instanceId }) {
  const migrations = readdirSync(MIGRATIONS_ROOT)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const migration of migrations) await applySqlFile(db, migration);
  await applySqlFile(db, "seed-app-defaults.sql");
  await db.prepare("INSERT INTO app_meta (key, value) VALUES ('schema_version', '22'), ('app_environment', ?)")
    .bind(environment).run();
  if (instanceId !== null) {
    await db.prepare("INSERT INTO app_meta (key, value) VALUES ('instance_id', ?)").bind(instanceId).run();
  }
}

async function withWorker(runtime, stored, assertion) {
  const server = createTestHarness({
    root: SITE_ROOT,
    workers: [{
      configPath: "./wrangler.production.jsonc",
      vars: {
        APP_ENV: runtime.environment,
        DB_SCHEMA_MODE: "migration-only",
        INSTANCE_ID: runtime.instanceId,
      },
    }],
  });
  await server.listen();
  try {
    const worker = server.getWorker();
    const { DB } = await worker.getEnv();
    await prepareDatabase(DB, stored);
    await assertion({ worker, DB });
  } finally {
    await server.close();
  }
}

test("correct beta instance binding serves normally", async () => {
  await withWorker(
    { environment: "beta", instanceId: "beta:alice" },
    { environment: "beta", instanceId: "beta:alice" },
    async ({ worker }) => {
      const response = await worker.fetch("/");
      assert.equal(response.status, 200);
    },
  );
});

test("Alice runtime fails closed when bound to Bob D1 without rewriting identity", async () => {
  await withWorker(
    { environment: "beta", instanceId: "beta:alice" },
    { environment: "beta", instanceId: "beta:bob" },
    async ({ worker, DB }) => {
      const response = await worker.fetch("/");
      assert.equal(response.status, 500);
      assert.equal(
        (await DB.prepare("SELECT value FROM app_meta WHERE key = 'instance_id'").first())?.value,
        "beta:bob",
        "a mismatched database must never be claimed by the running instance",
      );
    },
  );
});

test("beta runtime rejects a production database and identity", async () => {
  await withWorker(
    { environment: "beta", instanceId: "beta:alice" },
    { environment: "production", instanceId: "production:primary" },
    async ({ worker, DB }) => {
      const response = await worker.fetch("/");
      assert.equal(response.status, 500);
      assert.equal(
        (await DB.prepare("SELECT value FROM app_meta WHERE key = 'app_environment'").first())?.value,
        "production",
      );
      assert.equal(
        (await DB.prepare("SELECT value FROM app_meta WHERE key = 'instance_id'").first())?.value,
        "production:primary",
      );
    },
  );
});

test("runtime without INSTANCE_ID fails closed before claiming a valid D1", async () => {
  await withWorker(
    { environment: "beta", instanceId: "" },
    { environment: "beta", instanceId: "beta:alice" },
    async ({ worker, DB }) => {
      const response = await worker.fetch("/");
      assert.equal(response.status, 500);
      assert.equal(
        (await DB.prepare("SELECT value FROM app_meta WHERE key = 'instance_id'").first())?.value,
        "beta:alice",
        "a missing runtime identity must not modify the persisted D1 identity",
      );
    },
  );
});

test("marked database without instance identity fails closed and stays unclaimed", async () => {
  await withWorker(
    { environment: "beta", instanceId: "beta:alice" },
    { environment: "beta", instanceId: null },
    async ({ worker, DB }) => {
      const response = await worker.fetch("/");
      assert.equal(response.status, 500);
      assert.equal(
        await DB.prepare("SELECT value FROM app_meta WHERE key = 'instance_id'").first(),
        null,
        "request-time validation must not invent a missing persisted identity",
      );
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  BETA_D1_PLACEHOLDER,
  assertIdentityRows,
  assertManifestHasNoSecretValues,
  assertPairing,
  assertSafeDatabaseId,
  assertSafePlan,
  buildBetaPlan,
  buildIdentityStatements,
  buildManifest,
  buildWranglerConfig,
  normalizeInventory,
  reconcileInventory,
  shouldExecuteMutation,
  validateInstanceSlug,
} from "../scripts/beta-provision-core.mjs";
import { parseArgs } from "../scripts/beta-provision.mjs";

const plan = buildBetaPlan("alice", "19");
const d1Id = "11111111-2222-3333-4444-555555555555";

function inventory() {
  return {
    d1: [{ name: plan.resources.d1, id: d1Id }],
    r2: [plan.resources.r2],
  };
}

test("deterministic beta names and runtime identity", () => {
  assert.deepEqual(plan.resources, {
    worker: "xingyu-beta-alice",
    d1: "xingyu-beta-alice-db",
    r2: "xingyu-beta-alice-media",
  });
  assert.equal(plan.environment, "beta");
  assert.equal(plan.instanceId, "beta:alice");
  assert.deepEqual(buildBetaPlan("alice", "19"), plan);
});

test("production-like instance slugs are hard rejected", () => {
  for (const value of ["prod", "production", "live", "primary", "main", "alice-prod", "production-alice"]) {
    assert.throws(() => validateInstanceSlug(value), /production-like/);
  }
  assert.throws(() => validateInstanceSlug("Alice"), /lowercase/);
});

test("known production resource names and ids are rejected", () => {
  assert.doesNotThrow(() => assertSafePlan(plan, ["xingyu-blog", "xingyu-production-v2", "xingyu-production-media"]));
  assert.throws(
    () => assertSafePlan({ ...plan, resources: { ...plan.resources, worker: "xingyu-blog" } }),
    /deterministic|production/,
  );
  assert.throws(() => assertSafeDatabaseId(d1Id, [d1Id]), /production D1 identifier/);
});

test("mutating commands are dry-run unless execute is explicit", () => {
  assert.equal(parseArgs(["apply", "--instance", "alice"]).execute, false);
  assert.equal(parseArgs(["decommission", "--instance", "alice", "--confirm", "beta:alice"]).execute, false);
  assert.equal(parseArgs(["apply", "--instance", "alice", "--execute"]).execute, true);
  assert.equal(shouldExecuteMutation("apply", false), false);
  assert.equal(shouldExecuteMutation("apply", true), true);
  assert.equal(shouldExecuteMutation("verify", true), false);
});

test("reviewable manifest/config contain beta identity and no secret values", () => {
  const manifest = buildManifest(plan);
  const config = buildWranglerConfig(plan);
  assert.equal(manifest.resources.d1.databaseId, null);
  assert.equal(config.d1_databases[0].database_id, BETA_D1_PLACEHOLDER);
  assert.equal(config.vars.APP_ENV, "beta");
  assert.equal(config.vars.INSTANCE_ID, "beta:alice");
  assert.equal(config.routes, undefined);
  assert.equal(config.workers_dev, false);
  assert.equal(config.d1_databases[0].database_name, plan.resources.d1);
  assert.equal(config.r2_buckets[0].bucket_name, plan.resources.r2);
  assertManifestHasNoSecretValues(manifest, ["top-secret-token", "private-password"]);
  assert.equal(JSON.stringify(manifest).includes("top-secret-token"), false);
});

test("same complete resource pair is reused without creating unrelated resources", () => {
  assert.deepEqual(reconcileInventory(plan, inventory()), { mode: "reuse", databaseId: d1Id });
  const withUnrelated = inventory();
  withUnrelated.d1.push({ name: "other-db", id: "other-id" });
  withUnrelated.r2.push("other-media");
  assert.deepEqual(reconcileInventory(plan, withUnrelated), { mode: "reuse", databaseId: d1Id });
});

test("partial resource pair fails clearly instead of auto-completing", () => {
  assert.throws(() => reconcileInventory(plan, { d1: inventory().d1, r2: [] }), /partial beta resource pair/);
  assert.throws(() => reconcileInventory(plan, { d1: [], r2: inventory().r2 }), /partial beta resource pair/);
  assert.deepEqual(reconcileInventory(plan, { d1: [], r2: [] }), { mode: "create", databaseId: null });
});

test("identity marker plan establishes beta environment, instance id, and schema", () => {
  const statements = buildIdentityStatements(plan);
  assert.equal(statements.length, 3);
  assert.match(statements.join("\n"), /app_environment'.*'beta'/);
  assert.match(statements.join("\n"), /instance_id'.*'beta:alice'/);
  assert.match(statements.join("\n"), /schema_version'.*'19'/);
});

test("identity verification fails closed on wrong D1 marker", () => {
  const good = [
    { key: "app_environment", value: "beta" },
    { key: "instance_id", value: "beta:alice" },
    { key: "schema_version", value: "19" },
  ];
  assert.equal(assertIdentityRows(good, plan), true);
  assert.throws(
    () => assertIdentityRows(good.map((row) => row.key === "instance_id" ? { ...row, value: "beta:bob" } : row), plan),
    /instance_id mismatch/,
  );
  assert.throws(() => assertIdentityRows(good.filter((row) => row.key !== "instance_id"), plan), /missing/);
});

test("Worker/D1/R2 pairing verification requires one exact instance", () => {
  const manifest = buildManifest(plan, d1Id);
  const config = buildWranglerConfig(plan, d1Id);
  assert.equal(assertPairing(plan, manifest, config, inventory()), true);
  assert.throws(
    () => assertPairing(
      plan,
      manifest,
      { ...config, r2_buckets: [{ binding: "MEDIA", bucket_name: "xingyu-beta-bob-media" }] },
      inventory(),
    ),
    /config does not match/,
  );
});

test("inventory normalization accepts Wrangler-style shapes", () => {
  assert.deepEqual(normalizeInventory(
    [{ name: plan.resources.d1, uuid: d1Id }],
    { buckets: [{ name: plan.resources.r2 }] },
  ), inventory());
  assert.deepEqual(normalizeInventory(
    [{ name: plan.resources.d1, uuid: d1Id }],
    { name: plan.resources.r2 },
  ), inventory());
});

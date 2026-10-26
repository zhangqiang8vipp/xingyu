import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateProductionConfig, validateD1Metadata, validateOAuthMetadata } from "../scripts/verify-production-deploy.mjs";

const config = JSON.parse(readFileSync(new URL("../wrangler.production.jsonc", import.meta.url), "utf8"));
const bootstrap = readFileSync(new URL("../db/bootstrap.ts", import.meta.url), "utf8");
const expected = validateProductionConfig(config, bootstrap);

test("production deploy config refuses wrong environment, database or schema mode", () => {
  assert.equal(expected.schemaVersion, "26");
  assert.equal(expected.instanceId, "production:xingyu-blog");
  assert.throws(() => validateProductionConfig({ ...config, vars: { ...config.vars, APP_ENV: "beta" } }, bootstrap));
  assert.throws(() => validateProductionConfig({ ...config, vars: { ...config.vars, DB_SCHEMA_MODE: "legacy-bootstrap" } }, bootstrap));
  assert.throws(() => validateProductionConfig({
    ...config,
    d1_databases: [{ ...config.d1_databases[0], database_id: "unexpected" }],
  }, bootstrap));
});

test("production D1 check is read-only and fails closed on wrong instance or schema", () => {
  const valid = [{
    success: true,
    results: [
      { key: "schema_version", value: expected.schemaVersion },
      { key: "instance_id", value: expected.instanceId },
      { key: "app_environment", value: "production" },
    ],
  }];
  assert.equal(validateD1Metadata(valid, expected), true);
  assert.throws(() => validateD1Metadata([{ ...valid[0], success: false }], expected));
  assert.throws(() => validateD1Metadata([{ success: true, results: valid[0].results.slice(1) }], expected));
  assert.throws(() => validateD1Metadata([{ success: true, results: valid[0].results.map(row =>
    row.key === "instance_id" ? { ...row, value: "production:other" } : row) }], expected));
  assert.throws(() => validateD1Metadata([{ success: true, results: valid[0].results.map(row =>
    row.key === "schema_version" ? { ...row, value: "24" } : row) }], expected));
});

test("production OAuth smoke requires Gemini registration and PKCE", () => {
  const good = {
    issuer: expected.siteUrl,
    authorization_endpoint: expected.siteUrl + "/oauth/authorize",
    token_endpoint: expected.siteUrl + "/oauth/token",
    registration_endpoint: expected.siteUrl + "/oauth/register",
    code_challenge_methods_supported: ["S256"],
  };
  assert.equal(validateOAuthMetadata(good, expected), true);
  assert.throws(() => validateOAuthMetadata({ ...good, registration_endpoint: undefined }, expected));
  assert.throws(() => validateOAuthMetadata({ ...good, issuer: "https://another.example" }, expected));
  assert.throws(() => validateOAuthMetadata({ ...good, code_challenge_methods_supported: [] }, expected));
});

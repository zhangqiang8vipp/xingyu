import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateProductionConfig, validateD1Metadata, validateOAuthMetadata } from "../scripts/verify-production-deploy.mjs";
import { assessMainCi, assertCompleteCiJobs } from "../scripts/verify-production-ci.mjs";

const config = JSON.parse(readFileSync(new URL("../wrangler.production.jsonc", import.meta.url), "utf8"));
const bootstrap = readFileSync(new URL("../db/bootstrap.ts", import.meta.url), "utf8");
const expected = validateProductionConfig(config, bootstrap);

test("production deploy config refuses wrong environment, database or schema mode", () => {
  assert.equal(expected.schemaVersion, "27");
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

test("production release requires the successful full main CI for exactly the dispatched SHA", () => {
  const sha="a".repeat(40);
  const ok={id:123,name:"CI",event:"push",head_branch:"main",head_sha:sha,status:"completed",conclusion:"success"};
  assert.equal(assessMainCi({workflow_runs:[ok]},sha).runId,123);
  assert.equal(assessMainCi({workflow_runs:[{...ok,head_sha:"b".repeat(40)}]},sha).state,"waiting");
  assert.equal(assessMainCi({workflow_runs:[{...ok,event:"pull_request"}]},sha).state,"waiting");
  assert.equal(assessMainCi({workflow_runs:[{...ok,status:"in_progress",conclusion:null}]},sha).state,"waiting");
  assert.throws(()=>assessMainCi({workflow_runs:[{...ok,conclusion:"failure"}]},sha),/failed/);
  assert.equal(assessMainCi({workflow_runs:[]},sha).state,"waiting");
  assert.throws(()=>assessMainCi({},sha),/Invalid/);
});

test("production release refuses skipped, failed or missing D1/Worker CI shards", () => {
  const success={status:"completed",conclusion:"success"};
  const required=["ESLint","TypeScript and Worker bindings","Production build and full source test suite","verify"];
  const jobs=[...required.map(name=>({name,...success})),
    ...Array.from({length:16},(_,i)=>({name:"Worker/D1 case shard "+i+" of 16",...success}))];
  assert.equal(assertCompleteCiJobs({jobs}),true);
  assert.throws(()=>assertCompleteCiJobs({jobs:jobs.filter(x=>x.name!=="verify")}),/verify/);
  assert.throws(()=>assertCompleteCiJobs({jobs:jobs.filter(x=>x.name!=="Worker\/D1 case shard 5 of 16")}),/coverage/);
  assert.throws(()=>assertCompleteCiJobs({jobs:jobs.map(x=>x.name==="verify"?{...x,conclusion:"skipped"}:x)}),/verify/);
  assert.throws(()=>assertCompleteCiJobs({jobs:jobs.map(x=>x.name==="Worker\/D1 case shard 9 of 16"?{...x,conclusion:"failure"}:x)}),/shard/);
});

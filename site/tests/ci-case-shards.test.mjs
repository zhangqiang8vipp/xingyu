import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discoverIntegrationCases, planCaseShards, casePattern, assertCompleteCoverage } from "../scripts/ci-case-shard.mjs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("every original integration test case runs exactly once at 1, 3, 8, 12 and 16 shards", () => {
  const cases = discoverIntegrationCases(manifest);
  assert.ok(cases.length >= 136, "Do not drop existing security and D1 test cases");
  assert.ok(cases.some(c => c.name.includes("two AI clients merge independent Markdown edits")));
  assert.ok(cases.some(c => c.name.includes("newer database schema is never downgraded")));
  assert.ok(cases.some(c => c.name.includes("two simultaneous edits from the same version")));
  for (const count of [1, 3, 8, 12, 16]) {
    const shards = planCaseShards(cases, count);
    assert.equal(shards.length, count);
    assert.equal(assertCompleteCoverage(cases, shards), cases.length);
    assert.ok(shards.every(shard => shard.cases.length > 0));
    assert.ok(shards.every(shard => new Set(shard.cases.map(c => c.file)).size > 0));
    const unique = new Set(shards.flatMap(shard => shard.cases.map(c => c.file + "\0" + c.name)));
    assert.equal(unique.size, cases.length);
    for (const shard of shards) {
      const pattern = new RegExp(casePattern(shard.cases));
      const titles = new Set(shard.cases.map(c => c.name));
      assert.ok(shard.cases.every(c => pattern.test(c.name) && titles.has(c.name)));
    }
  }
});

test("sharding fails closed on omissions, duplicates, invalid counts and regex collisions", () => {
  const cases = discoverIntegrationCases(manifest);
  assert.throws(() => planCaseShards(cases, 0), /Invalid/);
  assert.throws(() => planCaseShards(cases, NaN), /Invalid/);
  assert.throws(() => planCaseShards(cases, cases.length + 1), /Invalid/);
  assert.throws(() => planCaseShards([...cases, cases[0]], 16), /Duplicate/);
  assert.throws(() => assertCompleteCoverage(cases, planCaseShards(cases.slice(1), 16)), /Missing/);
  const tricky = [{file:"one",name:"foo (a+b) [c]? ^$ |"}];
  const pattern = new RegExp(casePattern(tricky));
  assert.ok(pattern.test(tricky[0].name));
  assert.equal(pattern.test("foo aaab c"), false);
});

test("all integration case names are literal and source registration count is deterministic", () => {
  const cases = discoverIntegrationCases(manifest);
  const second = discoverIntegrationCases(manifest);
  assert.deepEqual(second, cases);
  assert.ok(cases.some(c=>c.file.endsWith("post-write-contracts.test.mjs")));
  const heavy = cases.filter(c=>c.file.endsWith("post-write-contracts.test.mjs"));
  assert.equal(heavy.length, 38, "Split the monolithic 38-case D1 write suite completely");
});

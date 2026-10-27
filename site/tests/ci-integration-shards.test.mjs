import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listedIntegrationTests, filesForShard } from "../scripts/ci-integration-shard.mjs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("CI shards cover every declared D1/Worker integration test exactly once", () => {
  const files = listedIntegrationTests(manifest);
  assert.ok(files.includes("tests/integration/space-ai-collaboration.test.mjs"),
    "do not omit security-critical multi-AI collaboration coverage");
  for (const count of [1, 2, 3, 4]) {
    const groups = Array.from({length: count}, (_, index) => filesForShard(files, index, count));
    const flattened = groups.flat();
    assert.deepEqual(flattened.slice().sort(), files.slice().sort());
    assert.equal(new Set(flattened).size, files.length);
    assert.ok(groups.every(group => group.length > 0));
    assert.ok(Math.max(...groups.map(group => group.length)) -
      Math.min(...groups.map(group => group.length)) <= 1,
      "shards should have balanced file counts");
  }
});

test("invalid shard configuration and altered test manifests fail closed", () => {
  const files = listedIntegrationTests(manifest);
  assert.throws(() => filesForShard(files, -1, 3), /Invalid/);
  assert.throws(() => filesForShard(files, 3, 3), /Invalid/);
  assert.throws(() => filesForShard(files, 0, 0), /Invalid/);
  assert.throws(() => filesForShard(files, NaN, 3), /Invalid/);
  assert.throws(() => filesForShard(files, 0, files.length + 1), /Invalid/);
  assert.throws(() => listedIntegrationTests({scripts:{"test:integration":"echo skipped"}}), /Unexpected/);
  assert.throws(() => listedIntegrationTests({scripts:{"test:integration":"node --test tests/integration/missing.test.mjs tests/integration/missing.test.mjs tests/integration/space-ai-collaboration.test.mjs"}}), /Duplicate/);
});

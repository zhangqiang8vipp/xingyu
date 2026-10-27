/**
 * Split the existing full Worker/D1 integration suite across GitHub runners.
 * Source of truth is package.json:test:integration, not a second hand-maintained list.
 * Every test file is executed exactly once across the configured shards.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = fileURLToPath(new URL("../", import.meta.url));

export function listedIntegrationTests(packageData) {
  const command = packageData?.scripts?.["test:integration"];
  if (typeof command !== "string") throw new Error("Missing test:integration script");
  const args = command.trim().split(/\s+/);
  if (args[0] !== "node" || args[1] !== "--test")
    throw new Error("Unexpected test:integration command; do not silently skip tests");
  const files = args.slice(2);
  if (files.length < 3) throw new Error("Integration suite is unexpectedly small");
  if (new Set(files).size !== files.length) throw new Error("Duplicate integration test file");
  for (const file of files) {
    if (!/^tests\/integration\/[a-z0-9-]+\.test\.mjs$/.test(file) ||
        !existsSync(path.join(SITE_ROOT, file)))
      throw new Error("Missing or invalid integration test: " + file);
  }
  return files;
}

export function filesForShard(files, shard, total) {
  if (!Number.isSafeInteger(shard) || !Number.isSafeInteger(total) ||
      total < 1 || total > files.length || shard < 0 || shard >= total)
    throw new Error("Invalid CI integration shard " + shard + "/" + total);
  const chosen = files.filter((_, index) => index % total === shard);
  if (!chosen.length) throw new Error("Empty CI integration shard");
  return chosen;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(readFileSync(path.join(SITE_ROOT, "package.json"), "utf8"));
  const files = filesForShard(listedIntegrationTests(data), Number(process.argv[2]), Number(process.argv[3]));
  console.log("Running full-coverage D1/Worker shard " + process.argv[2] +
    "/" + process.argv[3] + " (" + files.length + " files): " + files.join(", "));
  const run = spawnSync(process.execPath, ["--test", ...files], {
    cwd: SITE_ROOT, stdio: "inherit", env: process.env,
  });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
}

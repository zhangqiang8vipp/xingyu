import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertIdentityRows,
  assertPairing,
  assertSafeDatabaseId,
  assertSafePlan,
  buildBetaPlan,
  buildIdentityStatements,
  buildManifest,
  buildWranglerConfig,
  extractD1Rows,
  normalizeInventory,
  reconcileInventory,
} from "./beta-provision-core.mjs";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUTPUT_ROOT = path.join(SITE_ROOT, "outputs", "beta");
const COMMANDS = new Set(["prepare", "apply", "verify", "smoke", "decommission"]);

function usage() {
  return `Usage:
  node scripts/beta-provision.mjs prepare --instance <slug>
  node scripts/beta-provision.mjs apply --instance <slug> [--execute]
  node scripts/beta-provision.mjs verify --instance <slug>
  node scripts/beta-provision.mjs smoke --instance <slug> --url <https://...>
  node scripts/beta-provision.mjs decommission --instance <slug> --confirm beta:<slug> [--execute]

Mutating commands are dry-run unless --execute is present.`;
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "prepare";
  if (!COMMANDS.has(command)) throw new Error(`unknown command: ${command}`);
  const options = { command, execute: false, instance: "", url: "", confirm: "" };
  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--execute") {
      options.execute = true;
      continue;
    }
    if (!["--instance", "--url", "--confirm"].includes(flag)) throw new Error(`unknown option: ${flag}`);
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--instance") options.instance = value;
    if (flag === "--url") options.url = value;
    if (flag === "--confirm") options.confirm = value;
  }
  return options;
}

function readSchemaVersion() {
  const source = fs.readFileSync(path.join(SITE_ROOT, "db", "bootstrap.ts"), "utf8");
  const match = source.match(/export const schemaVersion\s*=\s*["'](\d+)["']/);
  if (!match) throw new Error("could not read schemaVersion from db/bootstrap.ts");
  return match[1];
}

function readProductionIdentifiers() {
  const config = JSON.parse(fs.readFileSync(path.join(SITE_ROOT, "wrangler.production.jsonc"), "utf8"));
  return [
    config.name,
    ...(config.d1_databases ?? []).flatMap((entry) => [entry.database_name, entry.database_id]),
    ...(config.r2_buckets ?? []).map((entry) => entry.bucket_name),
  ].filter(Boolean);
}

function assertInstanceSafetyIntegrated() {
  const identityPath = path.join(SITE_ROOT, "db", "instance-identity.ts");
  if (!fs.existsSync(identityPath)) {
    throw new Error("A2 instance-safety contract is not integrated; refusing remote beta mutation");
  }
  const source = fs.readFileSync(identityPath, "utf8");
  if (!source.includes("APP_ENVIRONMENTS") || !source.includes('"beta"') || !source.includes("INSTANCE_ID")) {
    throw new Error("A2 instance-safety contract is incomplete; refusing remote beta mutation");
  }
}

function outputDirFor(plan) {
  return path.join(OUTPUT_ROOT, plan.instance);
}

function artifactPaths(plan) {
  const outputDir = outputDirFor(plan);
  return {
    outputDir,
    manifest: path.join(outputDir, "manifest.json"),
    config: path.join(outputDir, "wrangler.beta.jsonc"),
  };
}

function writeArtifacts(plan, databaseId = null) {
  const paths = artifactPaths(plan);
  fs.mkdirSync(paths.outputDir, { recursive: true });
  const manifest = buildManifest(plan, databaseId);
  const config = buildWranglerConfig(plan, databaseId);
  fs.writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(paths.config, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { paths, manifest, config };
}

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxBin() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function run(command, args, { capture = true } = {}) {
  const result = execFileSync(command, args, {
    cwd: SITE_ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
  });
  return capture ? result.trim() : "";
}

function runWrangler(args, options) {
  return run(npxBin(), ["wrangler", ...args], options);
}

function parseJsonOutput(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function readInventory() {
  const d1 = parseJsonOutput(runWrangler(["d1", "list", "--json"]), "wrangler d1 list");
  const r2 = parseJsonOutput(runWrangler(["r2", "bucket", "list", "--json"]), "wrangler r2 bucket list");
  return normalizeInventory(d1, r2);
}

function markerRows(configPath) {
  const query = "SELECT key, value FROM app_meta WHERE key IN ('schema_version','app_environment','instance_id') ORDER BY key";
  const payload = parseJsonOutput(runWrangler([
    "d1", "execute", "DB", "--remote", "--config", configPath, "--command", query, "--json",
  ]), "D1 marker query");
  return extractD1Rows(payload);
}

function migrationCount(configPath) {
  const payload = parseJsonOutput(runWrangler([
    "d1", "execute", "DB", "--remote", "--config", configPath,
    "--command", "SELECT COUNT(*) AS count FROM d1_migrations", "--json",
  ]), "D1 migration count query");
  const rows = extractD1Rows(payload);
  return Number(rows[0]?.count ?? -1);
}

function expectedMigrationCount() {
  return fs.readdirSync(path.join(SITE_ROOT, "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name)).length;
}

function plannedMutations(plan) {
  return [
    `create/reuse exact D1 ${plan.resources.d1}`,
    `create/reuse exact R2 ${plan.resources.r2}`,
    "apply numbered D1 migrations and idempotent seeds",
    "set app_meta.app_environment=beta",
    `set app_meta.instance_id=${plan.instanceId}`,
    `set app_meta.schema_version=${plan.schemaVersion}`,
    "verify D1 identity + generated Worker/D1/R2 pairing",
    `build and deploy non-routed Worker ${plan.resources.worker} using generated beta config only`,
    "verify pair again after deployment",
  ];
}

function verifyResolvedPair(plan, inventory, artifacts, { requireWorker = false } = {}) {
  assertPairing(plan, artifacts.manifest, artifacts.config, inventory);
  assertIdentityRows(markerRows(artifacts.paths.config), plan);
  const actualMigrations = migrationCount(artifacts.paths.config);
  const expectedMigrations = expectedMigrationCount();
  if (actualMigrations !== expectedMigrations) {
    throw new Error(`D1 migration count mismatch: expected ${expectedMigrations}, found ${actualMigrations}`);
  }
  if (requireWorker) {
    runWrangler(["versions", "list", "--config", artifacts.paths.config]);
  }
}

function apply(plan, execute) {
  const prepared = writeArtifacts(plan);
  if (!execute) {
    console.log(JSON.stringify({
      mode: "dry-run",
      command: "apply",
      instanceId: plan.instanceId,
      resources: plan.resources,
      artifacts: prepared.paths,
      plannedMutations: plannedMutations(plan),
    }, null, 2));
    return;
  }

  assertInstanceSafetyIntegrated();
  const before = readInventory();
  const reconciliation = reconcileInventory(plan, before);
  let createdFreshPair = false;

  if (reconciliation.mode === "create") {
    runWrangler(["d1", "create", plan.resources.d1]);
    runWrangler(["r2", "bucket", "create", plan.resources.r2]);
    createdFreshPair = true;
  }

  const afterCreate = readInventory();
  const resolved = reconcileInventory(plan, afterCreate);
  if (resolved.mode !== "reuse" || !resolved.databaseId) {
    throw new Error("beta resource pair was not resolved after creation");
  }
  assertSafeDatabaseId(resolved.databaseId, readProductionIdentifiers());
  const artifacts = writeArtifacts(plan, resolved.databaseId);
  assertPairing(plan, artifacts.manifest, artifacts.config, afterCreate);

  if (!createdFreshPair) {
    assertIdentityRows(markerRows(artifacts.paths.config), plan);
  }

  runWrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", artifacts.paths.config]);
  runWrangler(["d1", "execute", "DB", "--remote", "--config", artifacts.paths.config, "--file", "drizzle/seed-app-defaults.sql"]);
  runWrangler(["d1", "execute", "DB", "--remote", "--config", artifacts.paths.config, "--file", "drizzle/seed-chatgpt-oauth.sql"]);
  for (const statement of buildIdentityStatements(plan)) {
    runWrangler(["d1", "execute", "DB", "--remote", "--config", artifacts.paths.config, "--command", statement]);
  }

  verifyResolvedPair(plan, readInventory(), artifacts, { requireWorker: false });
  run(npmBin(), ["run", "build"], { capture: false });
  runWrangler(["deploy", "--config", artifacts.paths.config], { capture: false });
  verifyResolvedPair(plan, readInventory(), artifacts, { requireWorker: true });

  console.log(JSON.stringify({
    status: "APPLIED",
    instanceId: plan.instanceId,
    resources: plan.resources,
    manifest: artifacts.paths.manifest,
    config: artifacts.paths.config,
    next: "Set required secrets interactively, configure only the intended beta exposure, redeploy the reviewed config, then run smoke.",
  }, null, 2));
}

function verify(plan) {
  const inventory = readInventory();
  const reconciliation = reconcileInventory(plan, inventory);
  if (reconciliation.mode !== "reuse" || !reconciliation.databaseId) {
    throw new Error("beta resource pair does not exist");
  }
  assertSafeDatabaseId(reconciliation.databaseId, readProductionIdentifiers());
  const artifacts = writeArtifacts(plan, reconciliation.databaseId);
  verifyResolvedPair(plan, inventory, artifacts, { requireWorker: true });
  console.log(JSON.stringify({
    status: "VERIFIED",
    instanceId: plan.instanceId,
    worker: plan.resources.worker,
    d1: { name: plan.resources.d1, databaseId: reconciliation.databaseId },
    r2: plan.resources.r2,
  }, null, 2));
}

async function smoke(plan, url) {
  if (!url) throw new Error("smoke requires --url");
  assertInstanceSafetyIntegrated();
  verify(plan);
  const base = new URL(url);
  if (base.protocol !== "https:") throw new Error("smoke URL must use https");
  const checks = [
    ["/", new Set([200])],
    ["/about", new Set([200])],
    ["/admin", new Set([301, 302, 303, 307, 308])],
  ];
  const results = [];
  for (const [pathname, allowed] of checks) {
    const response = await fetch(new URL(pathname, base), { redirect: "manual" });
    if (!allowed.has(response.status)) throw new Error(`smoke ${pathname} returned ${response.status}`);
    results.push({ pathname, status: response.status });
  }
  console.log(JSON.stringify({ status: "SMOKE_PASS", instanceId: plan.instanceId, results }, null, 2));
}

function decommission(plan, execute, confirm) {
  if (confirm !== plan.instanceId) {
    throw new Error(`decommission requires --confirm ${plan.instanceId}`);
  }
  const steps = [
    `delete Worker ${plan.resources.worker} first`,
    `delete R2 ${plan.resources.r2}; if non-empty/refused, STOP and keep D1 intact`,
    `delete D1 ${plan.resources.d1} only after R2 deletion succeeds`,
  ];
  if (!execute) {
    console.log(JSON.stringify({ mode: "dry-run", command: "decommission", instanceId: plan.instanceId, steps }, null, 2));
    return;
  }
  const inventory = readInventory();
  const d1Present = inventory.d1.some((item) => item.name === plan.resources.d1);
  const r2Present = inventory.r2.includes(plan.resources.r2);
  if (!d1Present && !r2Present) {
    console.log(JSON.stringify({ status: "ALREADY_ABSENT", instanceId: plan.instanceId }, null, 2));
    return;
  }
  try {
    runWrangler(["delete", "--name", plan.resources.worker, "--force"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|does not exist|404/i.test(message)) throw error;
  }
  if (r2Present) {
    runWrangler(["r2", "bucket", "delete", plan.resources.r2]);
  }
  if (d1Present) {
    runWrangler(["d1", "delete", plan.resources.d1, "--skip-confirmation"]);
  }
  console.log(JSON.stringify({ status: "DECOMMISSIONED", instanceId: plan.instanceId }, null, 2));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const productionIdentifiers = readProductionIdentifiers();
  const plan = assertSafePlan(buildBetaPlan(options.instance, readSchemaVersion()), productionIdentifiers);
  if (options.command === "prepare") {
    const artifacts = writeArtifacts(plan);
    console.log(JSON.stringify({
      status: "PREPARED",
      mode: "dry-run",
      instanceId: plan.instanceId,
      resources: plan.resources,
      manifest: artifacts.paths.manifest,
      config: artifacts.paths.config,
    }, null, 2));
    return;
  }
  if (options.command === "apply") return apply(plan, options.execute);
  if (options.command === "verify") return verify(plan);
  if (options.command === "smoke") return smoke(plan, options.url);
  if (options.command === "decommission") return decommission(plan, options.execute, options.confirm);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`beta provisioning failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exitCode = 1;
  });
}

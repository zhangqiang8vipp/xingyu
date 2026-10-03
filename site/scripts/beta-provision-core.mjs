const INSTANCE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const PRODUCTION_TOKEN_PATTERN = /(^|[-_.:])(prod|production|live|primary|main)([-_.:]|$)/i;
const PLACEHOLDER_D1_ID = "__RESOLVED_D1_DATABASE_ID_AFTER_APPLY__";

export const REQUIRED_SECRET_NAMES = Object.freeze([
  "ADMIN_EMAILS",
  "ADMIN_SESSION_SECRET",
  "MCP_WRITE_TOKEN",
  "VIEWS_IDENTITY_SECRET",
]);

export function validateInstanceSlug(raw) {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("--instance is required");
  if (value !== value.toLowerCase()) throw new Error("instance slug must already be lowercase");
  if (!INSTANCE_PATTERN.test(value)) {
    throw new Error("instance slug must be 1-40 lowercase letters/numbers with internal hyphens only");
  }
  if (PRODUCTION_TOKEN_PATTERN.test(value)) {
    throw new Error(`production-like instance slug is forbidden: ${value}`);
  }
  return value;
}

export function buildBetaPlan(instance, schemaVersion) {
  const slug = validateInstanceSlug(instance);
  const version = String(schemaVersion ?? "").trim();
  if (!/^\d+$/.test(version)) throw new Error("schemaVersion must be a positive integer string");
  return Object.freeze({
    version: 1,
    environment: "beta",
    instance: slug,
    instanceId: `beta:${slug}`,
    schemaVersion: version,
    resources: Object.freeze({
      worker: `xingyu-beta-${slug}`,
      d1: `xingyu-beta-${slug}-db`,
      r2: `xingyu-beta-${slug}-media`,
    }),
  });
}

export function assertSafePlan(plan, productionResources = []) {
  if (plan.environment !== "beta" || !String(plan.instanceId).startsWith("beta:")) {
    throw new Error("beta provisioning refuses non-beta runtime identity");
  }
  const expected = buildBetaPlan(plan.instance, plan.schemaVersion);
  for (const kind of ["worker", "d1", "r2"]) {
    const actual = plan.resources?.[kind];
    if (actual !== expected.resources[kind]) {
      throw new Error(`${kind} name is not the deterministic beta name for ${plan.instance}`);
    }
    if (!actual.startsWith("xingyu-beta-") || PRODUCTION_TOKEN_PATTERN.test(actual.replace(/^xingyu-beta-/, ""))) {
      throw new Error(`unsafe ${kind} resource name: ${actual}`);
    }
  }
  const knownProduction = new Set(productionResources.filter(Boolean).map((value) => String(value).trim().toLowerCase()));
  for (const name of Object.values(plan.resources)) {
    if (knownProduction.has(String(name).toLowerCase())) {
      throw new Error(`refusing known production resource name: ${name}`);
    }
  }
  return plan;
}

export function assertSafeDatabaseId(databaseId, productionIdentifiers = []) {
  const value = String(databaseId ?? "").trim().toLowerCase();
  if (!value) throw new Error("resolved D1 database id is required");
  const forbidden = new Set(productionIdentifiers.filter(Boolean).map((item) => String(item).trim().toLowerCase()));
  if (forbidden.has(value)) throw new Error(`refusing known production D1 identifier: ${databaseId}`);
  return databaseId;
}

export function shouldExecuteMutation(command, execute) {
  return (command === "apply" || command === "decommission") && execute === true;
}

export function buildManifest(plan, databaseId = null) {
  return {
    manifestVersion: 1,
    environment: plan.environment,
    instance: plan.instance,
    instanceId: plan.instanceId,
    schemaVersion: plan.schemaVersion,
    resources: {
      worker: { name: plan.resources.worker },
      d1: { name: plan.resources.d1, databaseId: databaseId || null },
      r2: { name: plan.resources.r2 },
    },
    bindings: { d1: "DB", r2: "MEDIA", assets: "ASSETS", images: "IMAGES" },
    requiredSecretNames: [...REQUIRED_SECRET_NAMES],
    safety: {
      defaultMode: "dry-run",
      applyRequiresExecute: true,
      productionRoutesIncluded: false,
      secretValuesIncluded: false,
    },
  };
}

export function buildWranglerConfig(plan, databaseId = null) {
  return {
    $schema: "../../../node_modules/wrangler/config-schema.json",
    name: plan.resources.worker,
    main: "../../../dist/server/index.js",
    compatibility_date: "2026-07-23",
    compatibility_flags: ["nodejs_compat"],
    no_bundle: true,
    workers_dev: false,
    triggers: { crons: ["17 3 * * *"] },
    vars: {
      APP_ENV: "beta",
      INSTANCE_ID: plan.instanceId,
      DB_SCHEMA_MODE: "migration-only",
      CSP_MODE: "report-only",
    },
    d1_databases: [{
      binding: "DB",
      database_name: plan.resources.d1,
      database_id: databaseId || PLACEHOLDER_D1_ID,
      migrations_dir: "../../../drizzle",
      migrations_pattern: "../../../drizzle/[0-9][0-9][0-9][0-9]_*.sql",
    }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: plan.resources.r2 }],
    assets: { binding: "ASSETS", directory: "../../../dist/client" },
    images: { binding: "IMAGES" },
    cache: { enabled: true },
    observability: { enabled: true },
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
  };
}

export function buildIdentityStatements(plan) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  return [
    "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('app_environment', 'beta')",
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('instance_id', ${quote(plan.instanceId)})`,
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ${quote(plan.schemaVersion)})`,
  ];
}

export function extractD1Rows(payload) {
  const queue = Array.isArray(payload) ? [...payload] : [payload];
  const rows = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current.results)) rows.push(...current.results);
    if (Array.isArray(current.result)) queue.push(...current.result);
  }
  return rows;
}

export function assertIdentityRows(rows, plan) {
  const markers = new Map(rows.map((row) => [String(row.key), String(row.value)]));
  const expected = {
    app_environment: "beta",
    instance_id: plan.instanceId,
    schema_version: plan.schemaVersion,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (markers.get(key) !== value) {
      throw new Error(`D1 ${key} mismatch: expected ${value}, found ${markers.get(key) ?? "missing"}`);
    }
  }
  return true;
}

export function normalizeInventory(d1Payload, r2Payload) {
  const d1List = Array.isArray(d1Payload)
    ? d1Payload
    : Array.isArray(d1Payload?.result)
      ? d1Payload.result
      : Array.isArray(d1Payload?.databases)
        ? d1Payload.databases
        : Array.isArray(d1Payload?.result?.databases)
          ? d1Payload.result.databases
          : [];
  const r2List = Array.isArray(r2Payload)
    ? r2Payload
    : Array.isArray(r2Payload?.result)
      ? r2Payload.result
      : Array.isArray(r2Payload?.buckets)
        ? r2Payload.buckets
        : Array.isArray(r2Payload?.result?.buckets)
          ? r2Payload.result.buckets
          : r2Payload?.name || r2Payload?.bucket_name
            ? [r2Payload]
            : r2Payload?.result?.name || r2Payload?.result?.bucket_name
              ? [r2Payload.result]
              : [];
  return {
    d1: d1List.map((item) => ({
      name: String(item.name ?? item.database_name ?? ""),
      id: String(item.uuid ?? item.id ?? item.database_id ?? ""),
    })).filter((item) => item.name),
    r2: r2List.map((item) => String(item.name ?? item.bucket_name ?? item)).filter(Boolean),
  };
}

export function reconcileInventory(plan, inventory) {
  const d1Matches = inventory.d1.filter((item) => item.name === plan.resources.d1);
  const r2Matches = inventory.r2.filter((name) => name === plan.resources.r2);
  if (d1Matches.length > 1 || r2Matches.length > 1) {
    throw new Error("duplicate deterministic beta resources found; manual investigation required");
  }
  const hasD1 = d1Matches.length === 1;
  const hasR2 = r2Matches.length === 1;
  if (hasD1 !== hasR2) {
    throw new Error("partial beta resource pair exists; refusing to create the missing half automatically");
  }
  if (hasD1 && !d1Matches[0].id) {
    throw new Error("existing D1 resource is missing its database id");
  }
  return hasD1
    ? { mode: "reuse", databaseId: d1Matches[0].id }
    : { mode: "create", databaseId: null };
}

export function assertPairing(plan, manifest, config, inventory) {
  const d1 = inventory.d1.find((item) => item.name === plan.resources.d1);
  const hasR2 = inventory.r2.includes(plan.resources.r2);
  if (!d1 || !d1.id || !hasR2) throw new Error("expected D1/R2 pair is not present");
  if (manifest.instanceId !== plan.instanceId
      || manifest.resources?.worker?.name !== plan.resources.worker
      || manifest.resources?.d1?.name !== plan.resources.d1
      || manifest.resources?.d1?.databaseId !== d1.id
      || manifest.resources?.r2?.name !== plan.resources.r2) {
    throw new Error("manifest does not match deterministic beta resource pair");
  }
  const d1Binding = config.d1_databases?.find((binding) => binding.binding === "DB");
  const r2Binding = config.r2_buckets?.find((binding) => binding.binding === "MEDIA");
  if (config.name !== plan.resources.worker
      || config.vars?.APP_ENV !== "beta"
      || config.vars?.INSTANCE_ID !== plan.instanceId
      || d1Binding?.database_name !== plan.resources.d1
      || d1Binding?.database_id !== d1.id
      || r2Binding?.bucket_name !== plan.resources.r2) {
    throw new Error("generated Worker/D1/R2 config does not match the instance plan");
  }
  return true;
}

export function assertManifestHasNoSecretValues(manifest, secretValues = []) {
  const serialized = JSON.stringify(manifest);
  for (const value of secretValues.filter(Boolean).map(String)) {
    if (serialized.includes(value)) throw new Error("manifest contains a secret value");
  }
  return true;
}

export const BETA_D1_PLACEHOLDER = PLACEHOLDER_D1_ID;

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractD1Rows } from "./beta-provision-core.mjs";

const SITE_ROOT = fileURLToPath(new URL("..", import.meta.url));

function required(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateProductionConfig(config, bootstrapSource) {
  const schema = bootstrapSource.match(/export const schemaVersion\s*=\s*["'](\d+)["']/);
  required(schema, "Cannot determine expected D1 schemaVersion from db/bootstrap.ts");
  required(config.name === "xingyu-blog", "Unexpected production Worker name");
  required(config.vars?.APP_ENV === "production", "Worker APP_ENV must be production");
  required(config.vars?.INSTANCE_ID === "production:xingyu-blog", "Unexpected production INSTANCE_ID");
  required(config.vars?.DB_SCHEMA_MODE === "migration-only", "Production must use migration-only DB mode");
  required(config.vars?.PUBLIC_SITE_URL === "https://zhangwansen.click", "Unexpected production PUBLIC_SITE_URL");

  required(config.d1_databases?.length === 1, "Production must have exactly one D1 binding");
  const database = config.d1_databases[0];
  required(database.binding === "DB"
    && database.database_name === "xingyu-production-v2"
    && database.database_id === "ef27f3c6-349a-44ea-ae09-0cc9dccca691",
  "D1 binding does not match the audited production database");

  required(config.r2_buckets?.length === 1
    && config.r2_buckets[0].binding === "MEDIA"
    && config.r2_buckets[0].bucket_name === "xingyu-production-media",
  "R2 binding does not match the production bucket");
  required(config.assets?.directory === "./dist/client", "Unexpected Worker asset directory");
  required(config.routes?.some((route) => route.pattern === "zhangwansen.click/*"
    && route.zone_name === "zhangwansen.click"), "Production route does not match zhangwansen.click");

  return {
    schemaVersion: schema[1],
    instanceId: config.vars.INSTANCE_ID,
    siteUrl: config.vars.PUBLIC_SITE_URL,
  };
}

export function validateD1Metadata(payload, expected) {
  const entries = Array.isArray(payload) ? payload : [payload];
  required(entries.every((entry) => entry?.success !== false), "Remote D1 query did not succeed");
  const rows = extractD1Rows(payload);
  required(rows.length === 3, "D1 app_meta query must return exactly three identity markers");
  const markers = new Map(rows.map((row) => [String(row.key), String(row.value)]));
  const requirements = {
    schema_version: expected.schemaVersion,
    app_environment: "production",
    instance_id: expected.instanceId,
  };
  for (const [key, value] of Object.entries(requirements)) {
    required(markers.get(key) === value,
      "Production D1 " + key + " mismatch: expected " + value + ", got " + (markers.get(key) ?? "missing"));
  }
  return true;
}

export function validateOAuthMetadata(payload, expected) {
  required(payload && typeof payload === "object" && !Array.isArray(payload),
    "Invalid authorization-server metadata");
  required(payload.issuer === expected.siteUrl, "Unexpected OAuth issuer");
  required(payload.authorization_endpoint === expected.siteUrl + "/oauth/authorize", "Incorrect authorize endpoint");
  required(payload.token_endpoint === expected.siteUrl + "/oauth/token", "Incorrect token endpoint");
  required(payload.registration_endpoint === expected.siteUrl + "/oauth/register",
    "Gemini dynamic client registration endpoint is missing");
  required(Array.isArray(payload.code_challenge_methods_supported)
    && payload.code_challenge_methods_supported.includes("S256"), "OAuth PKCE S256 is missing");
  return true;
}

function readExpected() {
  const config = JSON.parse(readFileSync(path.join(SITE_ROOT, "wrangler.production.jsonc"), "utf8"));
  const bootstrap = readFileSync(path.join(SITE_ROOT, "db", "bootstrap.ts"), "utf8");
  return validateProductionConfig(config, bootstrap);
}

function main() {
  const [mode, filename] = process.argv.slice(2);
  const expected = readExpected();
  if (mode === "config" && !filename) {
    console.log("Production config verified; expected schema " + expected.schemaVersion);
    return;
  }
  required(typeof filename === "string" && filename.length > 0, "Missing JSON input file");
  const payload = JSON.parse(readFileSync(filename, "utf8"));
  if (mode === "d1") {
    validateD1Metadata(payload, expected);
    console.log("Remote production D1 identity and schema verified");
  } else if (mode === "oauth") {
    validateOAuthMetadata(payload, expected);
    console.log("Production OAuth discovery verified");
  } else {
    throw new Error("Usage: node scripts/verify-production-deploy.mjs config|d1 <file>|oauth <file>");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production deployment gate failed");
    process.exitCode = 1;
  }
}

#!/usr/bin/env bash
# Protected one-time production D1 schema 27 migration and AXIS Worker release.
# A human must dispatch the matching workflow with BOTH confirmation phrases.
set -euo pipefail
trap 'echo "::error::Interrupted: verify current D1 schema and Worker revision before retrying; never restore Time Travel automatically."' ERR

if [[ "$GITHUB_REF" != "refs/heads/main" || "$RELEASE_CONFIRM" != "RELEASE-AXIS-27" || "$MIGRATE_CONFIRM" != "D1-SCHEMA-27" ]]; then
  echo "::error::Main branch and two exact confirmations are required"; exit 1
fi
if [[ "$PRODUCTION_DEPLOY_ENABLED" != "true" || -z "$CLOUDFLARE_API_TOKEN" || -z "$CLOUDFLARE_ACCOUNT_ID" ]]; then
  echo "::error::Protected CLOUDFLARE environment is not enabled or credentials are missing"; exit 1
fi

ROOT="$RUNNER_TEMP/xingyu-axis-27-release"
mkdir -p "$ROOT"
export WRANGLER_WRITE_LOGS=false

node scripts/verify-production-deploy.mjs config
npx wrangler secret list --config wrangler.production.jsonc --format json > "$ROOT/secrets.json"
node -e 'const fs=require("node:fs");const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const names=new Set(data.filter(s=>s.type==="secret_text").map(s=>s.name));for(const name of ["OPENROUTER_API_KEY","RESEND_API_KEY","ADMIN_SESSION_SECRET"]){if(!names.has(name))throw Error("Missing encrypted Worker secret "+name)}console.log("Required production Worker secret names verified")' "$ROOT/secrets.json"

inspect_remote() {
  local suffix="$1"
  npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "SELECT key,value FROM app_meta WHERE key IN ('schema_version','app_environment','instance_id')" --json > "$ROOT/meta-$suffix.json"
  npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "SELECT name FROM d1_migrations ORDER BY name" --json > "$ROOT/migrations-$suffix.json"
  npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger')" --json > "$ROOT/shape-$suffix.json"
}

echo "Checking existing D1 schema/identity, applied migrations and OAuth label table..."
inspect_remote before
node scripts/axis-schema-27-release.mjs preflight "$ROOT/meta-before.json" "$ROOT/migrations-before.json" "$ROOT/shape-before.json" | tee "$ROOT/plan.txt"
needs_migration=false
needs_marker=false
if grep -qx "needs_migration=true" "$ROOT/plan.txt"; then needs_migration=true; fi
if grep -qx "needs_marker=true" "$ROOT/plan.txt"; then needs_marker=true; fi

# Build before changing the schema: keep the incompatible version window short.
echo "Building the exact reviewed production candidate before mutating D1..."
npm run build
test -s dist/server/index.js

if [[ "$needs_migration" == "true" ]]; then
  echo "Capturing the mandatory pre-migration D1 Time Travel bookmark..."
  npx wrangler d1 time-travel info DB --config wrangler.production.jsonc --json > "$ROOT/time-travel.json"
  node -e 'const fs=require("node:fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const found=[];const visit=x=>{if(!x||typeof x!=="object")return;for(const [key,value] of Object.entries(x)){if(/bookmark/i.test(key)&&typeof value==="string"&&value.length>12)found.push(value);else if(value&&typeof value==="object")visit(value)}};visit(v);if(!found.length)throw Error("Time Travel recovery bookmark unavailable; aborting BEFORE migration");console.log("Recovery bookmark available: "+found[0])' "$ROOT/time-travel.json"

  echo "Applying only pending migration 0025 (inventory checked exactly)..."
  npx wrangler d1 migrations apply DB --config wrangler.production.jsonc --remote
else
  echo "Migration 0025 already recorded and verified; safe retry path."
fi

inspect_remote migrated
node scripts/axis-schema-27-release.mjs postapply "$ROOT/meta-migrated.json" "$ROOT/migrations-migrated.json" "$ROOT/shape-migrated.json"

if [[ "$needs_marker" == "true" ]]; then
  echo "Promoting schema marker 26 -> 27 only after migration and table verification..."
  npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "UPDATE app_meta SET value='27' WHERE key='schema_version' AND value='26' AND EXISTS (SELECT 1 FROM d1_migrations WHERE name='0025_oauth_connection_labels.sql') AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='oauth_connection_labels')" --json > "$ROOT/marker-update.json"
fi

inspect_remote ready
node scripts/axis-schema-27-release.mjs postmarker "$ROOT/meta-ready.json" "$ROOT/migrations-ready.json" "$ROOT/shape-ready.json"
node scripts/verify-production-deploy.mjs d1 "$ROOT/meta-ready.json"

echo "Publishing the already-built production Worker..."
npx wrangler deploy --config wrangler.production.jsonc

echo "Checking live public pages, OAuth discovery and private authentication boundaries..."
curl --fail --silent --show-error --location --retry 5 --retry-all-errors --retry-delay 3 "https://zhangwansen.click/" -o /dev/null
curl --fail --silent --show-error --location --retry 5 --retry-all-errors --retry-delay 3 "https://zhangwansen.click/ask" -o /dev/null
curl --fail --silent --show-error "https://zhangwansen.click/.well-known/oauth-authorization-server" -o "$ROOT/oauth-metadata.json"
node scripts/verify-production-deploy.mjs oauth "$ROOT/oauth-metadata.json"
for endpoint in /mcp /api/space-collaboration; do
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "https://zhangwansen.click$endpoint")"
  if [[ "$status" != "401" ]]; then
    echo "::error::Anonymous $endpoint returned $status; expected 401"; exit 1
  fi
done
echo "::notice::AXIS schema 27 production release passed protected migration and smoke gates."

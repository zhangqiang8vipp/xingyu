#!/usr/bin/env bash
# One-time, operator-approved production D1 migration + Cloudflare Worker release.
# This script is ONLY invoked by the protected manual GitHub Actions workflow.
set -euo pipefail
trap 'echo "::error::Release interrupted: D1 may already be schema 26. Do not blindly restore time travel or deploy an older Worker without investigating."' ERR

if [[ "$GITHUB_REF" != "refs/heads/main" ]]; then
  echo "::error::Only main may deploy production"; exit 1
fi
if [[ "$PRODUCTION_DEPLOY_ENABLED" != "true" || -z "$CLOUDFLARE_API_TOKEN" || -z "$CLOUDFLARE_ACCOUNT_ID" ]]; then
  echo "::error::Missing production approval flag or Cloudflare Environment credentials"; exit 1
fi

ROOT="$RUNNER_TEMP/xingyu-collab-release"
mkdir -p "$ROOT"
export WRANGLER_WRITE_LOGS=false

echo "Checking expected production Worker/D1/R2 bindings..."
node scripts/verify-production-deploy.mjs config

echo "Checking encrypted Worker secret names (never their values)..."
npx wrangler secret list --config wrangler.production.jsonc --format json > "$ROOT/secrets.json"
node -e 'const fs=require("node:fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const names=new Set(x.filter(i=>i.type==="secret_text").map(i=>i.name));for(const k of ["OPENROUTER_API_KEY","RESEND_API_KEY","ADMIN_SESSION_SECRET"]){if(!names.has(k)){console.error("::error::Missing encrypted Worker secret "+k);process.exit(1)}}' "$ROOT/secrets.json"

function inspect_remote() {
  local suffix="$1"
  npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "SELECT key,value FROM app_meta WHERE key IN ('schema_version','app_environment','instance_id')" --json > "$ROOT/meta-$suffix.json"
  npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "SELECT name FROM d1_migrations ORDER BY name" --json > "$ROOT/migrations-$suffix.json"
  npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "SELECT type,name FROM sqlite_master WHERE type IN ('table','trigger')" --json > "$ROOT/shape-$suffix.json"
}

inspect_remote before
export GITHUB_OUTPUT="$ROOT/preflight-output"
node scripts/collaboration-production-release.mjs preflight "$ROOT/meta-before.json" "$ROOT/migrations-before.json" "$ROOT/shape-before.json"
if grep -qx "needs_migration=true" "$ROOT/preflight-output"; then
  echo "Recording mandatory D1 Time Travel recovery bookmark..."
  npx wrangler d1 time-travel info DB --config wrangler.production.jsonc

  echo "Applying audited migration 0024 only (migration inventory verified before this step)..."
  npx wrangler d1 migrations apply DB --config wrangler.production.jsonc --remote
  inspect_remote migrated
  node scripts/collaboration-production-release.mjs postapply "$ROOT/meta-migrated.json" "$ROOT/migrations-migrated.json" "$ROOT/shape-migrated.json"

  echo "Promoting app_meta schema marker, guarded by migration and table presence..."
  npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "UPDATE app_meta SET value='26' WHERE key='schema_version' AND value='25' AND (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('space_collaboration_settings','space_collaboration_members','space_collaboration_invites','document_revisions','document_merge_proposals'))=5 AND EXISTS(SELECT 1 FROM d1_migrations WHERE name='0024_space_collaboration_revisions.sql')" --json > "$ROOT/schema-promotion.json"
else
  echo "Production schema 26 already present; no D1 mutation necessary."
fi

inspect_remote ready
node scripts/collaboration-production-release.mjs postdeploy "$ROOT/meta-ready.json" "$ROOT/migrations-ready.json" "$ROOT/shape-ready.json"

echo "D1 schema and identity verified. Building and deploying production Worker."
npm run deploy:production

echo "Smoke-testing public routes, OAuth and the anonymous collaboration boundary..."
curl --fail --silent --show-error --location --retry 4 --retry-all-errors --retry-delay 3 "https://zhangwansen.click/" -o /dev/null
curl --fail --silent --show-error --location --retry 4 --retry-all-errors --retry-delay 3 "https://zhangwansen.click/ask" -o /dev/null
curl --fail --silent --show-error "https://zhangwansen.click/.well-known/oauth-authorization-server" -o "$ROOT/oauth-metadata.json"
node scripts/verify-production-deploy.mjs oauth "$ROOT/oauth-metadata.json"

for path in /mcp /api/space-collaboration; do
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "https://zhangwansen.click$path")"
  if [[ "$status" != "401" ]]; then
    echo "::error::Anonymous $path must return 401, got $status"; exit 1
  fi
done
status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "https://zhangwansen.click/collaboration")"
if [[ "$status" != "302" && "$status" != "303" && "$status" != "307" && "$status" != "308" ]]; then
  echo "::error::Anonymous collaboration page must redirect to login, got $status"; exit 1
fi
echo "::notice::Production collaboration release smoke tests passed."

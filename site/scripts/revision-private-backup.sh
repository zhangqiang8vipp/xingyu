#!/usr/bin/env bash
# Protected main-only D1 export; encrypt, upload to dedicated private R2, retrieve and verify.
# No SQL, backup keys or plaintext checksums may be written to GitHub logs/artifacts.
set -euo pipefail
umask 077

test "$GITHUB_REF" = "refs/heads/main"
test "$PRODUCTION_DEPLOY_ENABLED" = "true"
test -n "$CLOUDFLARE_API_TOKEN"
test -n "$CLOUDFLARE_ACCOUNT_ID"
if [[ -z "$REVISION_BACKUP_KEY_B64" || -z "$REVISION_BACKUP_BUCKET" ]]; then
  echo "::error::Configure protected CLOUDFLARE secret REVISION_BACKUP_KEY_B64 and variable REVISION_BACKUP_BUCKET"; exit 1
fi
if [[ ! "$REVISION_BACKUP_BUCKET" =~ ^xingyu-private-[a-z0-9-]+$ ]]; then
  echo "::error::Use a dedicated private xingyu-private-* R2 bucket, never MEDIA"; exit 1
fi

ROOT="$(mktemp -d "$RUNNER_TEMP/xingyu-revision-backup.XXXXXXXX")"
trap 'rm -f "$ROOT/d1.sql" "$ROOT/d1.enc" "$ROOT/from-r2.enc" "$ROOT/meta.json"; rmdir "$ROOT" 2>/dev/null || true' EXIT
node scripts/verify-production-deploy.mjs config
npx wrangler d1 execute DB --config wrangler.production.jsonc --remote --command "SELECT key,value FROM app_meta WHERE key IN ('schema_version','app_environment','instance_id')" --json > "$ROOT/meta.json"
node scripts/verify-production-deploy.mjs d1 "$ROOT/meta.json"
# Full DB export, not just historical revision bodies.
npx wrangler d1 export DB --config wrangler.production.jsonc --remote --skip-confirmation --output "$ROOT/d1.sql"
test -s "$ROOT/d1.sql"
for table in app_meta posts document_revisions; do
  if ! grep -Fq "$table" "$ROOT/d1.sql"; then
    echo "::error::The D1 export appears incomplete (required schema table missing)"; exit 1
  fi
done
node scripts/encrypted-d1-backup.mjs encrypt "$ROOT/d1.sql" "$ROOT/d1.enc"
object="revision-history/$(date -u '+%Y%m%dT%H%M%SZ')-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.sql.aes256gcm"
npx wrangler r2 object put "$REVISION_BACKUP_BUCKET/$object" --remote --file "$ROOT/d1.enc" --content-type application/octet-stream
npx wrangler r2 object get "$REVISION_BACKUP_BUCKET/$object" --remote --file "$ROOT/from-r2.enc"
node scripts/encrypted-d1-backup.mjs verify "$ROOT/d1.sql" "$ROOT/from-r2.enc"
echo "::notice::Verified encrypted backup: $REVISION_BACKUP_BUCKET/$object"
echo "::notice::Keep the protected encryption key independently in a password manager; never expose this bucket publicly."

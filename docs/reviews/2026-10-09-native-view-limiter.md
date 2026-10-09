# Native Worker rate limiting for public view tracking (2026-10-09)

## Decision
Forward-port the narrow server-side part of former Draft PR #2 onto current main. Do **not** merge the outdated branch itself; keep the unrelated reader UI unchanged.

- Move only the **rate-limit gate** from per-request D1 `view_request_limits` UPSERT to Cloudflare's native `VIEW_RATE_LIMITER` binding.
- Preserve server-derived keyed-HMAC identity, per-post/day deduplicated `post_views`, atomic counter update, private/draft/missing shared response, existing production instance identity and Worker/D1/R2 bindings.
- Keep the old `view_request_limits` table in D1 untouched for rollback; no D1 migration, destructive cleanup, new secret or user-facing UI change.
- `POST /api/views/:slug` uses 429 + Retry-After:60 when rate limited; 503 fail closed in production if the binding or HMAC secret is unavailable.
- Local dev can function without the binding and will not write legacy rate-limit rows.

## Cloudflare constraints and operational safety
- Config: `wrangler.production.jsonc` defines `VIEW_RATE_LIMITER` under `ratelimits` with namespace_id `1901` and 240 requests / 60 seconds.
- Confirm namespace 1901 is not unintentionally shared by other Workers in this account before deployment. Binding provisioning in the actual production deployment and smoke testing still must be checked.
- Cloudflare native rate limits are **per Cloudflare location and eventually consistent**. They are appropriate for protecting the D1 write path, not a strictly global/billing quota. Keying to server-derived network identity can group users on shared IPs and is an existing trade-off.
- Preserve all old published, private and draft view-count contracts, and ensure the production INSTANCE_ID remains `production:xingyu-blog`.
- Live Cloudflare binding behaviour and auto-deploy triggers are not verified by GitHub CI alone. Do not claim it has been deployed merely because a PR is merged.

## Merge gate
- On latest main-based branch: `cd site && npm ci && npm run ci`.
- Assert generated Worker types remain current, and the production config D1/R2/INSTANCE_ID values are unchanged.
- Integration tests must cover first/duplicate/parallel public views, private/draft/missing, abuse 429, binding failure 503, no legacy D1 limit writes, retention, and database atomic failure.
- Merge only with CI green. Production roll-out requires explicit review of namespace uniqueness, the deployed binding and live view counting. Roll back the Worker version if needed; do not roll back post counts or delete the legacy D1 table.

Official reference: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

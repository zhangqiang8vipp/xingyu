# XINGYU multi-user identity release: operator runbook

> **Draft PR #15 / deployment blocked pending final-head CI and staging acceptance.**
> Do not merge, deploy, mutate production D1/R2, or enable public registration before all gates pass.

## Scope and invariants

- One Cloudflare Worker, one D1, one R2; personal workspace isolation and membership checks on every authenticated web/MCP read and write.
- Legacy blog data is assigned `workspace_id=1`; existing post public IDs, slugs, content and R2 keys must not change.
- Existing owner remains `users.id=1`, email identity `zhangqiang8vip@gmail.com`, with the **same current admin password**. The password is verified against existing `ADMIN_PASSWORD_HASH` on first identity login and re-hashed to `user_credentials`. The raw password is never migrated or sent to the operator.
- All new signups are `pending` until a verified, single-use email link activates them. On activation they get their own personal workspace, private category and private root space; **no site admin privileges**.
- Self-service password recovery uses a distinct purpose-bound email token; password reset invalidates all browser sessions and issued MCP tokens/consents for that user. Once owner email login migrates the credential, the legacy password-only admin endpoint and previously issued admin cookies are no longer valid.
- Users can list/revoke their own MCP client connections under `/workspace` without affecting another account.
- MCP login OAuth and MCP authorization OAuth remain separate: MCP `subject=user:<id>`; all MCP requests check both OAuth scopes and current workspace membership. Old owner/random-subject MCP OAuth grants and the global legacy bearer are not accepted in production; users must reconnect.
- Workspaces may later be organization-owned and multi-member, but **organization invitations, sharing UI and external identity providers (WeChat/Google/Alipay) are not enabled in this release**.

## Release gates

1. Record exact PR **head commit** and pass `cd site && npm ci && npm run ci` on that commit: lint, TypeScript, vinext build, worker types, source, migrations, provisioning and Worker integration.
2. Audit packages/security (at least any critical/high production-impact vulnerabilities). This branch does not blanket-run `npm audit fix --force`.
3. Run a *disposable* Worker/D1/R2 stage with the exact branch and expected instance-identity. Verify owner email migration, schema parity, user registration and actual Resend delivery, session cookies, logout, private spaces, attachments, anonymous GET 404, two-client MCP OAuth and token refresh/revoke.
4. Use at least two users (A/B): cross-workspace reads/writes, search, attachment URL guessing, forged workspace IDs, revoked membership, expired email links, invalid CSRF, repeated verification and token replay MUST fail. Confirm published private notes are still unreachable by public article routes.
5. Verify old public blog links and rendered content (home, archives, read dialog, Mermaid, images); check production R2 object history. Check new login, registration, email-verification, workspace UI on mobile and desktop.
6. Confirm Cloudflare Builds merge/autodeploy triggers; do not assume merging is safe. Establish rollback and on-call owner.

## Configuration (staging first)

For the application Worker, use a verified HTTPS site origin and an email-sending domain whose DNS sender identity has been verified.

- `PUBLIC_SITE_URL=https://zhangwansen.click` (or the exact beta origin on staging)
- `EMAIL_FROM=XINGYU <accounts@your-verified-domain.example>` (example only)
- `RESEND_API_KEY` — **secret**, not committed to git or exposed to frontend
- `REGISTRATION_ENABLED=false` during migration and smoke; set `true` only after email and isolation tests are green
- Preserve existing `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `APP_ENV` and `INSTANCE_ID`. Preserve private D1/R2 bindings. Do not send or reset the owner's password.
- Verify CAPTCHA/abuse monitoring, sender deliverability, email quota and API budget for a public launch. Request throttling is implemented; infrastructure-level anti-abuse is recommended before broad promotion.

## Production migration order (execute only after approval)

1. Freeze administrative writes for the short cutover. Record current Worker deploy SHA, D1 schema marker, `app_environment`, `instance_id`, R2 binding/bucket and backups.
2. Export an independently restorable D1 backup. Confirm R2 versioning/backups and snapshot of existing objects. Perform restore rehearsal on beta resources. Do not reuse beta IDs/buckets for production.
3. Apply the versioned D1 migration files `0018_identity_email_login.sql` and `0019_workspaces_and_verification.sql` **through the existing Wrangler migration system on the confirmed production D1**. Never run them twice by hand. Existing owner data gets `workspace_id=1`; new workspace tables, indices and cross-workspace triggers are created.
4. Verify required schema objects, owner identity, memberships and workspace; validate there are no duplicate identities and all legacy post IDs/slugs, statuses and R2 keys remain identical.
5. After verifying all migration statements, advance `app_meta.schema_version` to **21** on the correct production D1, maintaining unchanged `app_environment` and `instance_id`. Never claim production D1 by rewriting its instance marker. If the previous marker is not the approved version, stop and investigate.
6. Deploy the **exact CI-green SHA**, run `/api/admin/diagnostics` from an authenticated owner session and check code/database version, relation audit, schema/instance identity fail-closed gates.
7. Use the existing owner's email `zhangqiang8vip@gmail.com` and current password at `/login`. Check it resolves to `users.id=1`, and the original blog administration is accessible. This first login stores an independent PBKDF2 credential, without exposing the password. Confirm the old admin-password-only endpoint is **disabled** and previous admin-session cookies no longer authorize admin requests.
8. On the production Worker only after smoke, verify Resend sender and set `REGISTRATION_ENABLED=true` explicitly. Register two new nonowner test accounts via real email delivery; verify they cannot read the owner's content, each other's content or public administrative APIs. Test forgot-password, one-time reset and invalidation of sessions/MCP tokens. Run ChatGPT MCP OAuth login, consent, tool catalog, refresh, revocation and reconnect.
9. Monitor rate limits, email delivery failures, schema guards, R2 download 403/404, audit events and MCP authorization errors. Treat unexpected cross-workspace access as a release-stopping incident.

## Rollback and failure handling

- Before creating new accounts/writes, a failed rollout can restore pre-cutover D1 backup plus previous Worker revision after a coordinated rollback.
- **Do not just redeploy schema-19 code against schema-21 D1.** The application's migration-only guard deliberately fails closed; a rollback must restore a matching D1 snapshot (and R2 state if uploads occurred) or use a reviewed forward fix.
- After public registrations or uploads start, rollback risks destroying user data. Freeze writes, back up the new state, and prefer safe roll-forward with incident handling.
- If email service or workspace ACL breaks, disable `REGISTRATION_ENABLED` and block risky MCP grants; do not reenable the global production `MCP_WRITE_TOKEN`.
- Preserve backups and access logs according to the project's retention and privacy policy; never log plaintext passwords, verification URLs or OAuth secrets.

## Acceptance checklist

- [ ] CI on final SHA: all phases passed; integration tests run, not just source grep
- [ ] Two-user D1 and MCP cross-boundary tests passed in staging
- [ ] Email sign-up, link expiry/one-time use, re-send, password reset and login abuse tests passed with actual provider
- [ ] Owner password reused successfully; original site/URLs/R2 preserved
- [ ] Old auth bypasses closed and prior MCP clients reconnected
- [ ] Public images accessible; workspace R2 objects not accessible via legacy media/attachment routes
- [ ] Backups and restoration rehearsal completed; production instance markers unchanged
- [ ] Cloudflare auto-deploy risk reviewed; operator explicitly approves cutover
- [ ] Production registrations only enabled after post-deploy smoke


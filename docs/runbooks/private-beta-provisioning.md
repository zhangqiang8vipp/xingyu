# Private Beta Provisioning Runbook

This runbook provisions **one beta user = one isolated XINGYU Worker + D1 + R2 pair**.

It is deliberately separate from production. Do not change `site/wrangler.production.jsonc`, production routes, production resources, production data, or production secrets while following this runbook.

## Safety contract

Given instance slug `<instance>`, provisioning owns only:

- Worker: `xingyu-beta-<instance>`
- D1: `xingyu-beta-<instance>-db`
- R2: `xingyu-beta-<instance>-media`
- runtime `APP_ENV=beta`
- runtime `INSTANCE_ID=beta:<instance>`

The CLI rejects production-like instance slugs and rejects any generated resource name or resolved D1 database ID that matches the checked-in production configuration.

`prepare`, `apply`, and `decommission` are safe to inspect first. Remote mutation requires `--execute`.

Generated files live under ignored `site/outputs/beta/<instance>/` and contain resource identifiers and required **secret names only**. They never accept or print secret values.

## 1. Prepare

From `site/`:

```bash
npm run beta:prepare -- --instance alice
```

Review:

- `outputs/beta/alice/manifest.json`
- `outputs/beta/alice/wrangler.beta.jsonc`

Required findings:

- all three resource names start with `xingyu-beta-alice`;
- `APP_ENV` is exactly `beta`;
- `INSTANCE_ID` is exactly `beta:alice`;
- no `routes` entry exists;
- `workers_dev` is `false`;
- D1 binding is `DB`, R2 binding is `MEDIA`;
- no password, token, session secret, API key, or secret value appears.

Then review the mutation plan without changing Cloudflare:

```bash
npm run beta:apply -- --instance alice
```

Do not add `--execute` until the generated names and identity are approved.

## 2. Apply

Authorized beta-only execution **only from an integration checkout that already contains A2 instance safety**. The CLI checks for A2's `db/instance-identity.ts` beta/INSTANCE_ID contract before any remote mutation and fails before creating resources when it is absent.


```bash
npm run beta:apply -- --instance alice --execute
```

The command:

1. reads the remote D1/R2 inventory;
2. creates the deterministic D1 and R2 only when **both** are absent;
3. fails closed when only one half exists;
4. if both already exist, requires the D1 to already prove `app_environment=beta`, `instance_id=beta:alice`, and the current schema before reuse;
5. applies numbered migrations and the existing idempotent seeds;
6. explicitly establishes:
   - `app_meta.app_environment=beta`
   - `app_meta.instance_id=beta:alice`
   - `app_meta.schema_version=<current worker schema>`
7. re-reads and verifies those markers;
8. verifies the D1 ID/name and R2 name match the same generated manifest/config;
9. builds the Worker;
10. deploys it with **no route and `workers_dev=false`**;
11. verifies the same pair again.

This order satisfies A2's fail-closed contract: request traffic never claims an unmarked existing database.

### Reruns

A rerun for the same instance is predictable:

- both resources absent -> create the deterministic pair;
- both resources present + correct D1 identity -> reuse the same pair;
- one resource present and the other absent -> fail; do not auto-create the missing half;
- existing D1 with missing/wrong identity -> fail; do not rewrite it;
- unrelated beta resources are ignored.

If a first run fails after creating resources but before identity verification, investigate or decommission that exact pair before retrying. Do not manually point the manifest at another D1/R2.

## 3. Configure secrets

The provisioning CLI does not receive secret values.

After the non-routed Worker exists, set each secret **interactively** against the generated beta config:

```bash
npx wrangler secret put ADMIN_EMAILS --config outputs/beta/alice/wrangler.beta.jsonc
npx wrangler secret put ADMIN_SESSION_SECRET --config outputs/beta/alice/wrangler.beta.jsonc
npx wrangler secret put MCP_WRITE_TOKEN --config outputs/beta/alice/wrangler.beta.jsonc
npx wrangler secret put VIEWS_IDENTITY_SECRET --config outputs/beta/alice/wrangler.beta.jsonc
```

Never paste secret values into the manifest, Wrangler config, shell history, issue text, PR text, or repository files.

## 4. Verify before exposure

Run:

```bash
npm run beta:verify -- --instance alice
```

It must verify:

- current D1 migration count;
- `app_environment=beta`;
- `instance_id=beta:alice`;
- current schema version;
- deterministic Worker/D1/R2 names;
- D1 database ID is not the production D1 ID;
- generated DB/R2 bindings match the manifest;
- the Worker exists.

### Required R2 operational pairing check

A2 documents that application code cannot read a stable R2 bucket identity at runtime. Before exposing the instance, use Cloudflare's Worker settings/deployment view and compare against `manifest.json`:

- Worker name is exactly `xingyu-beta-alice`;
- binding `DB` is the D1 named `xingyu-beta-alice-db` with the manifest database ID;
- binding `MEDIA` is exactly `xingyu-beta-alice-media`;
- there is no production D1 or production R2 binding;
- there is no production/custom production route.

Record this operator verification in the beta onboarding ticket or other restricted operational record. Do not store secrets in that evidence.

This manual binding comparison is mandatory because a correct D1 plus independently misbound R2 cannot be detected by A2 at request time.

## 5. Explicit beta exposure

Exposure is intentionally not automated by A1.

Only after **Apply + secret configuration + Verify + R2 operational pairing check** pass:

1. keep the generated DB/R2 bindings unchanged;
2. choose a beta-only exposure, preferably the instance's non-production `workers.dev` URL or a dedicated beta hostname;
3. do not use `zhangwansen.click` or any production route;
4. review the diff so only exposure settings change;
5. redeploy the same Worker/config.

If any binding changed while adding exposure, stop and rerun Verify plus the R2 operational check before accepting traffic.

## 6. Smoke

With the approved HTTPS beta URL:

```bash
npm run beta:smoke -- --instance alice --url https://<beta-url>/
```

The smoke command reruns instance/resource verification, then checks:

- `/` -> 200
- `/about` -> 200
- `/admin` -> redirect

After that, manually authenticate to the beta admin and exercise only disposable beta data. Do not point the smoke test at production.

## 7. Decommission

First inspect the exact destructive plan:

```bash
npm run beta:decommission -- --instance alice --confirm beta:alice
```

Before execution, export any beta data that must be retained.

Then:

```bash
npm run beta:decommission -- --instance alice --confirm beta:alice --execute
```

Order is intentional:

1. delete the beta Worker;
2. delete the beta R2 bucket;
3. delete the beta D1 only after R2 deletion succeeds.

If R2 deletion fails because objects remain or for any other reason, the command stops before deleting D1. This preserves the metadata needed to investigate retained objects.

## Production boundary

This runbook does **not** authorize:

- production migrations;
- production D1/R2 writes;
- production Worker deployment;
- production route/DNS changes;
- production secret creation/rotation;
- shared-D1 multi-tenancy;
- teams, registration, billing, or workspace abstractions.

A green beta provisioning result is not production deployment authorization.

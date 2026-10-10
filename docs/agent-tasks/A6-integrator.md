# A6 — Private Beta Sprint Integrator / Product Gate

Branch: `integration/private-beta-sprint-01`

## Gate status

**READY TO START**

CEO/Product recheck on 2026-10-02 confirmed that the current final reports for A1–A5 all end with `READY FOR INTEGRATION`.

Frozen baseline remains:

```
FORK_BASELINE_SHA: cbb4b4742547981e814e627f6b0c12ba2ebdf0eb
```

Do not create the integration branch from current `main`. Read current task/review files from `main`, then create `integration/private-beta-sprint-01` from the frozen baseline above.

## Required sources

Read completely before integrating:

- `docs/agent-tasks/README.md`
- `docs/plans/2026-09-30-private-beta-sprint-01.md`
- `docs/reviews/2026-10-02-private-beta-sprint-01-ceo-review.md`
- `agent/beta-provisioning:docs/agent-reports/A1.md`
- `agent/beta-instance-safety:docs/agent-reports/A2.md`
- `agent/beta-knowledge-import:docs/agent-reports/A3.md`
- `agent/beta-activation:docs/agent-reports/A4.md`
- `agent/beta-safety-contracts:docs/agent-reports/A5.md`

At start, re-read the actual current head of every owner branch. Do not integrate a stale SHA from an earlier report snapshot.

## Product scope gate

Before merging code, confirm the combined result still means:

> one beta user = one isolated XINGYU instance; real private Knowledge Space content -> Agent connection -> real Knowledge Space create/update -> understandable audit proof.

Reject scope expansion into:
- shared-D1 multi-tenancy;
- Workspace / Organization / teams;
- invitations / RBAC / SSO;
- billing / self-serve SaaS;
- broad migration platform;
- unrelated platform abstractions.

## Integration order

Prefer this semantic order:

1. **A2 — Instance Identity & Resource Safety**
2. **A1 — Beta Provisioning Core**
3. **A3 — Real Knowledge Import**
4. **A4 — Activation UX & Beta Signals**
5. **A5 — Independent Safety Contracts**

You may adjust commit/cherry-pick order when needed, but preserve the dependency that A1 provisioning must satisfy A2's runtime/D1 identity contract.

## Conflict policy

Multiple branches touch `site/package.json`. Do not choose one side wholesale.

The integrated test path must preserve all owner additions:

- A1
  - `test:provisioning`
  - `tests/beta-provisioning.test.mjs`
- A2
  - `tests/instance-identity.test.mjs`
  - `tests/integration/instance-safety.test.mjs`
- A3
  - `tests/integration/knowledge-import-contracts.test.mjs`
- A4
  - `tests/admin-activation.test.mjs`
- A5
  - `tests/integration/private-beta-safety-contracts.test.mjs`

Preserve existing baseline tests as well.

Resolve conflicts with the smallest semantic change. Do not redesign owner features during integration.

## Mandatory integrated verification

Run from the integrated checkout:

1. install dependencies using the repository-supported Node/npm version;
2. full `npm run ci`;
3. A1 provisioning contracts;
4. A2 wrong-instance contracts;
5. A3 import privacy/no-overwrite contracts;
6. A4 Knowledge Space activation false-positive regressions;
7. A5 private lifecycle/version/destructive contracts;
8. a feasible end-to-end Private Beta acceptance scenario in **non-production**.

The acceptance scenario must demonstrate:

- a beta instance plan uses deterministic unique Worker/D1/R2 resources;
- production-like resources are rejected;
- dry-run has no remote mutation;
- runtime `APP_ENV=beta` + `INSTANCE_ID=beta:<instance>` matches D1 markers;
- wrong-instance D1 binding fails closed;
- Worker/D1/R2 pairing is verified using A1's manifest/operator contract;
- 10–100 item Markdown/Text import lands in Knowledge Space as private drafts;
- duplicate/invalid import does not overwrite unrelated content;
- root/public blog posts and root drafts do **not** satisfy Activation;
- root `create_draft` / root `update_post` do **not** count as private knowledge writes;
- Knowledge Space create/update can qualify;
- publish/unpublish/destructive boundaries remain unchanged;
- anonymous public routes do not expose Knowledge Space content;
- existing public blog behavior still works after instance identity guard is satisfied.

## Production boundary

Do not deploy or mutate production Worker, D1, R2, DNS/routes, production data or production secrets.

A green integration branch is not authorization to deploy production.

## Defect return loop

If you find a substantial owner defect:

1. do not silently absorb it into the integration branch;
2. write a focused feedback file under `docs/agent-feedback/A<N>-from-A6.md` containing:
   - reproduction;
   - expected behavior;
   - required fix;
   - required regression test;
3. report `NOT READY` until the owning agent fixes its own branch and updates its report;
4. re-integrate the fixed owner head.

Small mechanical conflict resolution is allowed on A6; feature-semantic fixes are not.

## Deliverables

When integration succeeds:

- integration branch: `integration/private-beta-sprint-01`
- final integration commit SHA
- optional draft PR to main; do not merge
- `docs/agent-reports/A6.md`

The A6 report must cover:

### Product
- Does a beta user now have a coherent first-value path?
- Is the result still intentionally single-tenant-per-instance?
- Which steps remain operator-assisted / concierge?

### Safety
- wrong-instance fail-closed evidence;
- production-name rejection;
- private import/no-overwrite;
- Worker/D1/R2 pairing evidence;
- publish/destructive boundary regression evidence;
- production resources touched = NO.

### Architecture
- reuse of bootstrap / post-write / mcp_activity;
- no duplicate frameworks;
- no premature multi-tenant abstractions;
- package/test conflict resolution.

### Delivery
- exact owner branch heads integrated;
- integration commit SHA;
- full test commands/results;
- E2E evidence;
- known risks;
- schema/migration impact.

Final line must be exactly:

`READY FOR CEO REVIEW`

or

`NOT READY`

A6 does not make the final GO decision.

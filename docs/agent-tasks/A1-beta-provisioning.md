# A1 — Beta Provisioning Core

Branch: `agent/beta-provisioning`

Goal: build a repeatable, reviewable, safe-by-default operator workflow for one beta user = one isolated XINGYU instance.

Start gate: read `docs/agent-tasks/README.md`; if not READY with both baseline SHAs, stop and do not change code.

Must: explicit instance id; deterministic Worker/D1/R2 names; dry-run default; hard reject production names; reviewable generated config; never print/commit secrets; predictable rerun; prepare/verify/apply/smoke/decommission runbook; no production mutation.

Do not build shared-D1 multi-tenancy, registration, billing, teams.

Completion: branch from `FORK_BASELINE_SHA`; commit code; write `docs/agent-reports/A1.md` with branch, final SHA, changed files, implemented/not implemented, tests, manual verification, security impact, schema/migration impact, risks, production touched=NO, ending `READY FOR INTEGRATION` or `NOT READY`.

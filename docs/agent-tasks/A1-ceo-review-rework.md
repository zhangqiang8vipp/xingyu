# A1 CEO Review Rework — Provisioning Blocker

You are A1 — Beta Provisioning Core.

Repository: `zhangqiang8vipp/xingyu`

Read:
- `docs/agent-tasks/README.md`
- `docs/agent-tasks/A1-beta-provisioning.md`
- `docs/reviews/2026-10-02-private-beta-sprint-01-ceo-review.md`
- A2 final report on `agent/beta-instance-safety:docs/agent-reports/A2.md`
- A5 final report on `agent/beta-safety-contracts:docs/agent-reports/A5.md`

Your branch `agent/beta-provisioning` is currently identical to the frozen baseline, so this task is still unimplemented.

Continue from the existing A1 branch rooted at `FORK_BASELINE_SHA=cbb4b4742547981e814e627f6b0c12ba2ebdf0eb`.

In addition to the original A1 task, you MUST satisfy the A2/A5 integration contract:
1. deterministic unique Worker/D1/R2 names from instance slug;
2. dry-run default, explicit apply;
3. hard reject production-like resource names/identifiers;
4. generated reviewable manifest/config contains no secrets;
5. set/emit `APP_ENV=beta`;
6. set/emit `INSTANCE_ID=beta:<instance>`;
7. after schema preparation, explicitly establish and verify D1 `app_meta.instance_id` matching runtime identity;
8. verify `app_environment=beta`, schema version, instance id before instance exposure;
9. verify the generated Worker/D1/R2 resource pair belongs to the same instance; address A2's R2 residual risk operationally;
10. rerunning the same plan is idempotent or fails clearly without creating unrelated resources;
11. provide prepare/verify/apply/smoke/decommission runbook;
12. do not touch production resources/secrets/data during development.

Add automated tests for naming, production rejection, dry-run, manifest redaction/no-secret, rerun behavior, and identity marker plan/verification.

Write `docs/agent-reports/A1.md` with full evidence and final line exactly:
`READY FOR INTEGRATION` or `NOT READY`.

Do not merge to main.

# XINGYU Private Beta Sprint 01 — Single-Tenant Beta Enablement

> Task / work repository: `zhangqiang8vipp/xingyu`
> Upstream source repository: `zhangqiang8vip/xingyu`
> Status: BLOCKED until the upstream baseline is frozen and the fork is synced to that exact SHA.

## Goal

Safely support 5–8 real Private Beta users with **one isolated XINGYU instance per user**, then validate the first-value path:

real knowledge → connect Agent → Agent performs a real private knowledge write → user understands what changed.

This sprint is not a multi-tenant SaaS conversion.

## Repository contract

- GitHub Issues, agent branches, reports and integration work live in `zhangqiang8vipp/xingyu`.
- `zhangqiang8vip/xingyu` is the upstream source of truth for the frozen baseline.
- Before agents start, the control issue must record:
  - `UPSTREAM_BASELINE_SHA`
  - `FORK_BASELINE_SHA`
  - proof that fork baseline contains the upstream baseline
  - `STATUS: READY`
- All A1–A5 branches must start from the same fork baseline.
- No agent may start from the fork's current stale main unless it has first been synced to the frozen upstream baseline.

## Team

- A1 — Beta Provisioning Core
- A2 — Instance Identity & Resource Safety
- A3 — Real Knowledge Import
- A4 — Activation UX & Beta Signals
- A5 — Independent QA / Safety Contracts
- A6 — Integrator / Product Gate

A1–A4 may run in parallel after READY. A5 can start analysis in parallel and finishes against real implementations. A6 starts only after A1–A5 are READY FOR INTEGRATION.

## Non-goals

Do not build multi-tenant shared D1, organizations, teams, invitations, enterprise RBAC/SSO, comments, newsletter, billing, mobile, workflow engine, agent marketplace, broad third-party migration platform, or generic Knowledge OS abstractions.

Do not deploy or mutate production resources during agent work.

## Completion report

Every implementation/QA agent must report in its own issue:
- branch
- final commit SHA
- PR URL if any
- changed modules
- implemented / deliberately not implemented
- tests and results
- manual verification
- security/isolation impact
- schema/migration impact
- known risks
- confirmation that production resources/data/secrets were not touched
- final line: `READY FOR INTEGRATION` or `NOT READY`

## Integration

A6 integrates from the frozen fork baseline, reviews product scope before architecture, sends substantial defects back to the owning agent, runs full CI/E2E, and ends with `READY FOR CEO REVIEW` or `NOT READY`.

Final GO / GO WITH CONDITIONS / NO-GO is made by CEO/Product after reviewing GitHub reports, final diff, tests, architecture and product scope.

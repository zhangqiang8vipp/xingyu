# A6 — Private Beta Sprint Integrator / Product Gate

Branch: `integration/private-beta-sprint-01`

Start only after A1–A5 reports exist under `docs/agent-reports/` and each ends `READY FOR INTEGRATION`.

Responsibilities: read control plan and all reports; review product scope before architecture; integrate from frozen `FORK_BASELINE_SHA`; merge in safest order; resolve only minimal semantic conflicts; run full CI and feasible beta E2E; substantial defects go back to original owner; final report covers product, safety, architecture, delivery.

Final line must be `READY FOR CEO REVIEW` or `NOT READY`. Do not make final GO decision.

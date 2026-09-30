# A5 — Independent Private Beta Safety Contracts

Branch: `agent/beta-safety-contracts`

Role: independent QA / Safety Agent. Do not redesign A1–A4.

Start gate: if control is BLOCKED, analysis only; no implementation branch work.

Attack: production names rejected; wrong-instance binding fails closed; import stays private; duplicate/bad import cannot silently overwrite unrelated content; private writes retain version/write contracts; publish/unpublish/destructive boundaries do not regress; generated config/logs contain no secrets; reruns predictable; public blog does not regress; migration/security CI remains intact.

If a feature defect exists, report reproduction + expected behavior to the owning agent rather than rewriting the feature.

Completion: write `docs/agent-reports/A5.md` listing automated/manual/uncovered risks, blockers, tests, ending `READY FOR INTEGRATION` or `NOT READY`.

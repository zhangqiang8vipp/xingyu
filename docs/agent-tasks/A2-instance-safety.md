# A2 — Instance Identity & Resource Safety

Branch: `agent/beta-instance-safety`

Goal: add instance-level identity guards so wrong D1/resource bindings fail closed.

Start gate: read `docs/agent-tasks/README.md`; if not READY with both baseline SHAs, stop.

Must: explicit runtime expected instance id; persist instance identity in D1; mismatch fails closed; production/beta identities distinct; tests for correct binding, Alice config + Bob DB, beta + production, missing identity; document R2 residual risk if equivalent identity cannot be enforced.

Prefer extending existing bootstrap/environment identity. Do not add tenant_id or Workspace/Organization.

Completion: branch from `FORK_BASELINE_SHA`; write `docs/agent-reports/A2.md` with standard report ending `READY FOR INTEGRATION` or `NOT READY`.

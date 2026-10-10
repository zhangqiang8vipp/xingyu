# A4 — Activation UX & Beta Signals

Branch: `agent/beta-activation`

Goal: make first-value path legible: real knowledge -> Agent connected -> Agent private create/update -> user understands change -> activation can be determined.

Start gate: read `docs/agent-tasks/README.md`; if not READY, stop.

Must: clear next step without MCP docs; clear connected state; show who/which connection did what, when, and to which item after first private write; reuse mcp_activity/receipts; lightweight activation determination; distinguish connected-only vs real write; do not weaken publish/destructive boundaries. Avoid scope/subject/receipt/client-id/D1/MCP jargon in primary UI.

Completion: branch from `FORK_BASELINE_SHA`; write `docs/agent-reports/A4.md` ending `READY FOR INTEGRATION` or `NOT READY`.

# A3 — Real Knowledge Import

Branch: `agent/beta-knowledge-import`

Goal: smallest real import path for 10–100 Markdown/Text items into a private Knowledge Space.

Start gate: read `docs/agent-tasks/README.md`; if not READY, stop.

Must: Markdown/Text batch import; private by default; stable title/content mapping; duplicate/invalid behavior explicit; never silently overwrite; import never publishes; per-item actionable errors; preserve existing post-write validation; user need not understand MCP/DB/Cloudflare.

Do not build full Notion/Obsidian/WordPress migration platforms.

Completion: branch from `FORK_BASELINE_SHA`; write `docs/agent-reports/A3.md` ending `READY FOR INTEGRATION` or `NOT READY`.

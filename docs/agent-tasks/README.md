# XINGYU Private Beta Sprint 01 — Agent Task Index

STATUS: READY
UPSTREAM_BASELINE_SHA: 342171235c1f68194ae8c16050c1d64874088e70
FORK_BASELINE_SHA: cbb4b4742547981e814e627f6b0c12ba2ebdf0eb

## Baseline validation

- Upstream functional baseline is `342171235c1f68194ae8c16050c1d64874088e70`.
- Working fork merged that baseline through PR #3.
- Structural compare confirms the fork baseline is ahead of upstream only by Private Beta planning/task documentation; product code is the upstream baseline.
- The fork currently exposes no GitHub Actions run/status records for the merge commit, so absence of a CI status is **not** treated as a pass.
- Every implementation agent must run relevant tests and, where possible, full `npm run ci` before reporting `READY FOR INTEGRATION`.

A1–A4 may run in parallel now.
A5 may start in parallel, but finalizes against A1–A4 implementations.
A6 starts only after A1–A5 each report READY FOR INTEGRATION.

Task files:
- docs/agent-tasks/A1-beta-provisioning.md
- docs/agent-tasks/A2-instance-safety.md
- docs/agent-tasks/A3-knowledge-import.md
- docs/agent-tasks/A4-activation.md
- docs/agent-tasks/A5-safety-contracts.md
- docs/agent-tasks/A6-integrator.md

## Universal launch prompt

你是 XINGYU Private Beta Sprint 01 的执行 Agent。使用 GitHub 插件打开 `zhangqiang8vipp/xingyu`，先读取 `docs/agent-tasks/README.md` 和你对应的任务文件。GitHub 仓库文件是唯一任务真相源。确认状态为 READY 后，严格从 `FORK_BASELINE_SHA` 新建自己的分支，按任务文件完成开发、测试和报告；不要从当前 main 或其他 Agent 分支起步。

A6 additionally must wait until A1–A5 reports all end with `READY FOR INTEGRATION`.

# XINGYU Private Beta Sprint 01 — Agent Task Index

STATUS: BLOCKED
UPSTREAM_BASELINE_SHA:
FORK_BASELINE_SHA:

A1–A4 may run in parallel after READY. A5 may start analysis in parallel and finish against A1–A4 implementations. A6 starts only after A1–A5 each report READY FOR INTEGRATION.

Task files:
- docs/agent-tasks/A1-beta-provisioning.md
- docs/agent-tasks/A2-instance-safety.md
- docs/agent-tasks/A3-knowledge-import.md
- docs/agent-tasks/A4-activation.md
- docs/agent-tasks/A5-safety-contracts.md
- docs/agent-tasks/A6-integrator.md

Universal launch prompt:
你是 XINGYU Private Beta Sprint 01 的执行 Agent。使用 GitHub 插件打开 zhangqiang8vipp/xingyu，读取 docs/agent-tasks/README.md 和你对应的任务文件，严格按里面的门禁、分支、实现范围、测试和报告要求执行。GitHub 仓库文件是唯一任务真相源。如果 README 仍是 BLOCKED，则停止实现，只报告阻塞原因。

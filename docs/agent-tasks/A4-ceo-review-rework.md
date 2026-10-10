# A4 CEO Review Rework — Activation Semantics

You are A4 — Activation UX & Beta Signals.

Repository: `zhangqiang8vipp/xingyu`

Continue on `agent/beta-activation`. Do not rebase onto current main.

Read:
- `docs/agent-tasks/A4-activation.md`
- `docs/reviews/2026-10-02-private-beta-sprint-01-ceo-review.md`

The current implementation has a product-semantic bug.

Current defects:
1. `site/db/activation.ts` counts all posts as knowledge. Public/root blog posts must NOT satisfy the private-knowledge prerequisite.
2. `isPrivateActivationWrite()` currently returns true for root `create_draft` with `spaceId=null`.
3. It also counts root draft `update_post` as private.
4. `site/tests/admin-activation.test.mjs` explicitly encodes those false-positive behaviors.

Required semantics:
- Knowledge prerequisite = at least one Knowledge Space/private-space post (`space_id IS NOT NULL`), not any post.
- A qualifying activation write must be `create_draft` or `update_post` on a post whose `spaceId != null`.
- Root/public-blog draft creation/update must never count as the private knowledge write.
- Space posts remain private by boundary even if their status changes; do not infer privacy only from draft status.

Required regression tests:
- public/root published posts only -> `needs-knowledge`;
- root draft only -> `needs-knowledge`;
- root `create_draft` activity -> not activated;
- root `update_post` activity -> not activated;
- Knowledge Space create -> qualifying write;
- Knowledge Space update -> qualifying write;
- connected-only remains distinct from activated.

Update A4 report with delta, tests, and final line `READY FOR INTEGRATION` or `NOT READY`.

Do not merge to main.

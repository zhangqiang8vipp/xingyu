# XINGYU invitation-based spaces and multi-agent document merge (implementation plan)

Status: PARTIAL IMPLEMENTATION — DO NOT DEPLOY. The three-way merge primitive is only a library; it is not connected to document writes.

## Product contract
- Any space in an eligible workspace may be shared by *explicit email invitation*; default is private. Personal content not explicitly shared remains private.
- Invitation scoped to one specific space and optionally its descendants; nested space can restrict inheritance.
- Accept only with authenticated, verified account matching invite email; raw one-time token never stored; expiry, revocation, rate limits and audit mandatory.
- Membership role: owner/admin/editor/viewer. Invitation does **not** grant entire workspace access.
- AI clients operate under distinct OAuth/PAT identities and the account's effective space permissions. Revocation must affect all endpoints and caches immediately.

## Minimum security implementation before enabling
1. Space membership/invitation tables with scoped privileges and signed-off D1 schema migration.
2. Unified effective-space-permission evaluator for browse, search, post read/write, attachment read/write, AI retrieval and MCP. Never first grant broad workspace access and filter after access.
3. Descendant inheritance must not leak restricted children. Cross-tenant moves, deletion, ID guessing, invited non-organization members and revoked members must be tested.
4. Separate transactional accept + account-verified email match, anti-CSRF same-origin write, no invite token/log leakage.
5. MCP tools: list/invite/revoke/change-role space members and read/propose/list revisions/merge/resolve. All use same server-side permission evaluator as web API.
6. Preserve existing personal-only MCP restrictions until the above are implemented. Do not expose existing workspace tools directly to all ordinary users.

## Versioned documents
- Append immutable content revisions keyed by (workspace_id, post_id, revision), base_revision, author_user_id and agent client_id.
- Backfill initial baseline safely before accepting merges. Never accept a client-supplied base body as trusted revision history.
- Proposals carry base revision and content patch; server loads stored base/current, merges, writes new current and revision in one atomic guarded D1 transaction. On compare-and-swap failure, retry from newly read head within a bounded limit or return 409.
- Conservative three-way merge is a first primitive and is currently restricted to at most 1,000,000 line-pair comparisons. Conflicts are never silently overwritten. Non-overlap does not guarantee semantic correctness; provide review workflow.
- On conflict, store proposal/inputs as a pending review item, not overwrite live content; surface conflict segments and approval/restore UI. Protect Markdown code fences/structured blocks via syntax-aware follow-up merging.
- Every revision, merge, restore and conflict resolution is audited and attributed to both user and OAuth client.
- Handle deletion/tombstones, idempotency keys, revision retention, large documents and concurrent CAS carefully.

## Release gates
- Unit: independent edits, overlap, same-position inserts, identical edits, large inputs, Unicode/Markdown blocks.
- Integration: invite acceptance/replay/expiry, ACL isolation across all access paths, two-agent racing commit and human+AI race, revocation while writing, audit rollback.
- Test only on separate staging Worker/D1/R2 and staging identity. Never point tests at production D1 or reuse production INSTANCE_ID.
- Run full npm ci + npm run ci and browser tests. Verify real invitation email and OAuth MCP flows on staging.
- Production release is manual and requires explicit approval and migration backup/recovery; this PR must not enable functionality prematurely.

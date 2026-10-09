# Release batch integration — 2026-10-09

## Decision: BLOCKED

PR #7, #10 and #9 are integrated in `integration/2026-10-09-release-batch`. Local CI passes all 183 tests. Real compiled-app browser checks described below passed. Do not merge main or deploy: the production instance identity is not prepared, Cloudflare Builds linkage could not be verified, and the final combined version has not undergone a fresh remote Beta Worker/D1/R2 exercise. No production writes, exports, provisioning or deployments were performed.

## Verified inputs and commit identity

Repository: `zhangqiang8vipp/xingyu` (the fork, not the similarly named upstream).

| Input | Actual head SHA retrieved from GitHub |
| --- | --- |
| main at integration start | `b1f43cb032cb707d89c37476e7645b4600533c05` |
| PR #7 | `4ebacab855f97d3828134e821bf7a1e92aa70666` |
| PR #10 | `c7fd213516d2424048ef985642c492e59c4ad4eb` |
| PR #9 | `f8df2633eca1664e9287606b34131b7b606ea6d2` |
| Final integrated application commit, fully tested locally | `7d40b9f1dc7bbb0db96f2a862e59a014e64c460c` |

This report and public synthetic screenshots are committed afterwards as evidence only. The integration PR identifies its exact final head SHA, including this report; GitHub CI must test that head too. A report cannot embed the SHA of its own enclosing commit without changing that SHA.

All requested inputs were read from actual fetched PR commits: task README, A6 task and report, AI block design, Chinese MCP guide, reader flicker review, CI workflow and package.json. None were missing. Task README retains an older BLOCKED record; A6's later report documents its previous isolated remote exercise. That historical exercise is not evidence of a new remote test of this combined commit.

## Integration and fixes

Merge order was #7 → #10 → #9, preserving original histories. Only package.json conflicted. Its test lists were combined semantically: instance identity, activation, provisioning, import and private lifecycle tests remain in CI, together with document-block tests. blog-mcp.ts auto-merged and was checked for both private-space instructions and four-component instructions.

Additional defects found and corrected:

1. Two stray array brackets in PR #9's oversized status-list/timeline tests prevented lint and tests from parsing. Fixed syntax without changing expected behavior or relaxing assertions.
2. Added an official MCP client integration scenario to the existing private safety suite. It loads all four guide samples, checks server 1.1.0 and tool instructions, creates a private draft, updates using expected_version, verifies exact Markdown and private space preservation, and requires anonymous rejection. Sample extraction accepts both LF and CRLF; the first run correctly failed before that fix.
3. Real browser testing with a 17 KB invalid block exposed an implicit modal grid track of 128664 px, putting the reader at x=63856.109375. Scoped CSS now uses `minmax(0, 1fr)` and `min-width: 0`; actual final reader was x=150 with width=980 at desktop 1280 px, and x=0/width=390 on mobile. The fallback remains a normal horizontally scrollable code block. No homepage, navigation or admin redesign and no global third-party CSS reset.
4. MCP instructions now explicitly prohibit invented task states/event dates and require explicit private space, full-content/version reads and preservation of existing content.

## Full CI evidence

Executed in site on application commit `7d40b9f1dc7bbb0db96f2a862e59a014e64c460c`:

```powershell
$env:WRANGLER_SEND_METRICS='false'
$env:CI='true'
npm ci
npm run ci
```

Node v24.19.0 / npm 12.0.2. Both commands exited 0. lint, TypeScript, production build, generated Worker type check and all existing/new test paths passed:

| Suite | Tests | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| provisioning | 12 | 12 | 0 | 0 |
| source | 80 | 80 | 0 | 0 |
| integration | 91 | 91 | 0 | 0 |
| Total | 183 | 183 | 0 | 0 |

Full local logs retained in ignored `site/outputs/release-batch/npm-ci-final.log` and `ci-final.log`. An initial npm ci attempt encountered EBUSY while the local server was shutting down; retry after shutdown succeeded. Earlier failed logs are retained, not represented as passes. Build emits the existing >500 KB chunk warning; repository CSS and resource/lazy-load gates pass. No test was skipped or removed to obtain a pass. Reading the reader remains lazy; source/built-output checks retain the lazy chunk boundary.

## Private Beta safety

Current combined local provisioning/source/Worker integration tests pass: environment and identity namespace validation, missing/wrong D1 identity fail-closed, production-name rejection, dry-run planning and repeat handling, private import non-overwrite, private read isolation, ordinary-blog exclusion from knowledge activation, and MCP publish/unpublish/delete confirmation and optimistic version boundaries. The new AI draft/update test also preserves these boundaries.

The previous A6 report records a real isolated remote Beta exercise followed by resource decommissioning. No live remote Beta instance exists from that exercise, and this combined commit's remote Worker/D1/R2 co-ownership and provisioning E2E are **UNVERIFIED**. Local emulation and old remote results do not substitute for that operational gate.

Production read-only inspection found `schema_version=19`, `app_environment=production`, and no `app_meta.instance_id`. The production config also lacks INSTANCE_ID. Integrated code explicitly rejects missing identities. Production must receive an approved, verified identity preparation before this version can serve it; do not weaken fail-closed checks to bypass this.

## AI document and MCP

All four valid fenced JSON types render: quiz_result, metric_grid, status_list, timeline. Quiz shows 2 correct / 2 partial / 1 incorrect, calculated from five source items. Parser tests reject invalid JSON/version/fields/size and untrusted extra totals. Real article includes all four guide samples, four invalid blocks (syntax/version/field/17 KB size), legacy Markdown/table/code, KaTeX, Mermaid and a local image. Four malformed blocks remain code; HTML-looking metric text stays literal, with no injected img elements or alert. Existing attachment security tests pass; an actual attachment download and clipboard-copy click were not separately browser exercised in this run.

MCP server reports 1.1.0 through the official SDK client. create_draft and update_post retain old parameters and accept content_markdown; no new mandatory field was added. Guidelines retain explicit publication authorization and private-space boundaries. The Chinese guide contains four directly copyable examples.

Use `list_spaces` to identify the private destination; create_draft with title, space, change_summary and Markdown containing a fenced `xingyu-block` JSON object. Use version=1 and one of the four types. For edits first get_post(view=content), preserve the whole document, then update_post with identifier and expected_version. Never invent numbers/statuses or invoke publish_post without explicit user authorization. See [Chinese guide](../guides/ai-document-blocks-mcp.md).

## Real browser evidence

Used Codex's Chromium in-app browser against the actual production build served by local Wrangler, using only an isolated copy of local D1/R2. Synthetic public/private QA articles were created only in that copy. No isolated HTML fixture substituted for the application. Desktop and 390×844 responsive mobile viewport were exercised; these are not physical iOS/Android devices.

| Scenario | Observation |
| --- | --- |
| Desktop first and second open | Actual article renders; modal/panel computed animation-name=none; persistent wrapper owns entrance. No repeated panel entry observed. |
| Mobile first and second open | Full-width 390 px reader, all component types, no nested re-entry observed. |
| Slow first open, desktop/mobile | Local HTTP proxy delays actual reader chunk and API by 1500 ms. Observed real Suspense label “正在打开文章”; fallback and final panel both animation-name=none, wrapper reader-backdrop-in. |
| Admin article and private Knowledge Space | Authenticated actual local backend; public/admin and private draft both render five block cards, ESC closes; no serious Console errors recorded. No private user content is captured in report screenshots. |
| ESC / desktop backdrop / close button | Reader wrapper count returns to 0. |
| Mobile scroll restoration | Warm open locks at -701 px and restores 701 px. Reloaded open locks at -697 px and restores 696 px (1 px rounding); locator click can scroll the card into view before open. |
| Reader failure | Separate local proxy returns 503 only for reader API. Actual error “文章暂时无法打开，请稍后再试。” appears and close works. |
| Themes / legacy content | Light and dark cards, KaTeX, Mermaid SVG and image rendered; malformed blocks remain code. |
| Console | Actual normal/public/admin sessions returned zero error entries; failure injection intentionally creates an API failure. Report-only CSP telemetry reports inline script/data-font violations from existing rendering; enforcement is not enabled or claimed validated. |

No animationstart event counter was available through the supported browser API; we report real observed transition and computed animations, not a fabricated event count. Lazy imports remain in the tested build. The previous report's fixture 4→1 count is historical and not used as current application evidence.

Local persistent HTML cache initially served the old CSS filename after rebuild. A non-cacheable QA query loaded current compiled assets and verified the fix. Deployment cache invalidation remains a release consideration; a cached older HTML response must not be mistaken for the new build.

Screenshots show only synthetic public QA:

- [Desktop components](evidence/2026-10-09-release-batch/desktop-components.jpg)
- [Mobile light](evidence/2026-10-09-release-batch/mobile-components.jpg)
- [Mobile dark](evidence/2026-10-09-release-batch/mobile-dark.jpg)
- [Injected reader error](evidence/2026-10-09-release-batch/mobile-error.jpg)

## Blocking gates and follow-through

1. Production INSTANCE_ID/D1 marker preparation is absent. A controlled release must choose and verify the production identity and binding ownership; production writes are outside this task. The known missing marker is not interpreted as healthy.
2. GitHub workflow contains CI only and no repository hook was listed, but this does not prove Cloudflare Builds is disconnected. Official GET Builds triggers for the live Worker's tag returned HTTP 403. **Auto-deploy association UNVERIFIED**; obtain read access or an authoritative dashboard check before merging main, respecting the user's no-production-deploy requirement.
3. Fresh combined-version isolated remote Beta provisioning/smoke and Worker/D1/R2 identity test is still required. The old A6 run cannot certify a different commit. Obtain approved isolated resource scope and run existing prepare/apply/verify/smoke with no production identifiers.
4. Physical iOS/Android and actual attachment/clipboard browser checks remain unverified; perform these before claiming comprehensive device acceptance.

Keep integration PR Draft and main unchanged. Once these gates are cleared, rebase/merge current main if it changed, rerun complete CI on the new final head and revalidate affected browser paths. No deploy command is recommended as ready-to-run while blocked.

Rollback: before an eventual authorized release retain the previous immutable Worker version/config and verified D1 recovery point. If this version fails, restore the prior Worker version/config; do not delete identities or private knowledge. AI component content is ordinary Markdown and older readers can display the JSON fence. No new AI schema migration was introduced. Cache warm/cold responses and identity mismatch rejection must be included in post-release checks.

# Quiet Island · 星屿文档阅读设计语言 v1

> Status: Draft PR #8 · visually checked against representative fixture · not merged into main.

## Product intent

星屿是一处可以长期积累思想的知识之岛。阅读界面要让文字成为主角：安静、温润、清晰、可信。借鉴现代 AI 文档阅读器的排版节奏，而不是复制聊天 UI 或在文档里添加聊天气泡。

## Design principles

1. **Content first.** 不添加阅读时不必要的装饰。标题、链接、代码和引用按信息重要程度建立层次。
2. **Comfortable Chinese reading.** 桌面正文约 720px、17px 正文字号、约 1.9 行高；小屏正文 16px。
3. **Warm neutrality.** 深墨字、低饱和岛绿、浅雾灰，避免高饱和蓝色在正文内抢视线。
4. **Consistent reading contexts.** 文章独立页和沉浸弹窗共享样式；编辑器、后台操作栏、站点导航不包含在首轮改动中。
5. **Accessible and reversible.** 亮暗主题、键盘焦点、移动端长表格滚动必须可用，样式文件单独引入，可以按一个 import 回退。

## Semantic palette

| Role | Light | Dark | Intent |
| --- | --- | --- | --- |
| Content ink | `#26302f` | `#e1e8e4` | Paragraphs and headings |
| Muted ink | `#697572` | `#b4bfb9` | Quotes and subdued detail |
| Island accent | `#4a7870` | `#91bdb0` | WCAG-AA body links, list markers, callout rails |
| Soft surface | `#f7f8f5` | `#202a28` | Quotes and restrained panels |
| Border | `#e4e8e3` | `#35433e` | Code, tables, attachments |

## Implementation scope

- `site/features/reader/quiet-island.css`: a scoped visual layer targeting existing `.post-page .prose.markdown-body` and `.reader-prose.markdown-body`, including dark mode and mobile overrides.
- `site/features/reader/PostPageView.tsx` and `site/features/reader/ModalPostReader.tsx`: import the scoped CSS from the two actual reading entry points, keeping it out of the site-wide root layout.
- `site/tests/quiet-island-reading.test.mjs` and `site/package.json`: include scoped-style and contrast regression checks in the existing source suite.
- Keep `MarkdownRenderer.tsx` and its sanitization, KaTeX, Mermaid, attachment, and code-copy capabilities unchanged.
- No changes to Markdown storage, Knowledge Space permissions, MCP boundaries, database schema, publishing, or APIs.
- Private Beta Sprint 01 PR #7 is independent. Do not merge or rebase it as part of this design experiment.

## Design review checklist

- Long-form Chinese and English paragraphs, headings H1–H6, bold/italic, nested lists, GFM tables, blockquotes, code, inline code and external links.
- KaTeX and Mermaid, details, callouts and attachment cards retain function and clarity.
- Light/dark and mobile/desktop: contrast, overflow, table scrolling, code copying and focus outlines.
- Page reader, modal reader, admin reader and preview have no regressions.
- Verify bundle size and project CI; retain before/after screenshots for human acceptance.

## Rollout gate

Do not deploy or merge without visual checks on real long/short articles and private Knowledge Space items, automated CI and accessibility checks. This first version is intentionally visual only: tune from a real reading screenshot, then consider centralizing shared tokens in a second iteration.

## Visual QA evidence · 2026-10-09

The design was checked in a sandbox Chromium browser using the exact `quiet-island.css` from the PR (content hash verified) plus a **representative static HTML fixture** that models the article and immersive-reader shells. This is a visual design check, **not** an end-to-end test of the deployed app.

| Fixture mode | Viewport | Result |
| --- | --- | --- |
| Article page, light | 1440 × 920 | PASS — 720px text column, 17px paragraph font, no page overflow |
| Article page, dark | 1440 × 920 | PASS — same column, charcoal paper surface, no overflow |
| Article page, light | 390 × 844 | PASS — 356px column, 16px text, balanced title, table scroll |
| Article page, dark | 390 × 844 | PASS — 16px text, readable dark code panel, no page overflow |
| Immersive modal, light | 1440 × 920 | PASS — 720px column, 57px hero title, no page overflow |
| Immersive modal, dark | 390 × 844 | PASS — 356px column, 32px hero title, no page overflow |

The preview screenshots are available as conversation artifacts from the review session; no product/private data was used. The fixture intentionally does not render or authenticate a live Knowledge Space, and it does not run the actual KaTeX/Mermaid runtime.

Source-level remote checks: **32/32 passed**, including reading-entry CSS imports, selector scope, responsive behavior, unchanged Markdown safety pipeline, and the verified MarkdownRenderer blob matching `main`. Normal text colors passed WCAG AA contrast math on the chosen surfaces: light body **12.90:1**, light island link **4.74:1**, light muted **4.55:1**, dark body **13.99:1**, dark link **8.39:1**, dark muted **9.20:1**. The CSS also defines distinct light/dark syntax-highlight palettes.

## Pending release gates

- **NOT RUN:** `cd site && npm ci && npm run ci`, because the sandbox cannot fetch the full repository/packages and PR #8 has no GitHub Actions run yet.
- **NOT RUN:** production-like E2E screenshot against a real article and a real private Knowledge Space entry. The fixture check above is not a substitute.
- **NOT VERIFIED:** production Next/Vinext CSS asset ordering and chunk sizes; confirm that both entry-point imports work with the actual build and the existing 270 KB stylesheet assertion.
- **NOT VERIFIED:** live keyboard focus, code copying, TOC, KaTeX, Mermaid and attachment links in the actual app.
- Keep PR #8 in **Draft**, do not deploy, do not merge `main` until those checks pass and the user approves the visual direction.

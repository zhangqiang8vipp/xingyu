# Quiet Island · 星屿文档阅读设计语言 v1

> Status: proposed / scoped prototype — not merged into main.

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
| Island accent | `#507f78` | `#91bdb0` | Links, list markers, callout rails |
| Soft surface | `#f7f8f5` | `#202a28` | Quotes and restrained panels |
| Border | `#e4e8e3` | `#35433e` | Code, tables, attachments |

## Implementation scope

- `site/features/reader/quiet-island.css`: a scoped visual layer targeting existing `.post-page .prose.markdown-body` and `.reader-prose.markdown-body`, including dark mode and mobile overrides.
- `site/app/layout.tsx`: load that style after existing global styles.
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

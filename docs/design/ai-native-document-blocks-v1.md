# XINGYU AI Document · 结构化文档区块 v1

> STATUS: EXPERIMENTAL / DRAFT PR, not approved to deploy. **Component-only upgrade**: retain the current XINGYU website, article layout, typography and administration UI. PR #8's reading restyle is not a dependency.

## Product contract

AI writes human-readable **ordinary Markdown** by default. When the supplied source material clearly contains a measurement collection or an itemized quiz assessment, it may include a strictly validated `xingyu-block` fenced JSON object. The reader then turns **that explicit block** into a consistent, accessible UI without running a model at display time.

**Not yet implemented:** detecting arbitrary narrative prose and silently rewriting it into blocks. That should happen at an explicit, auditable AI authoring/import step rather than during read-time rendering. The reader must never invent numbers, infer missing grades, or re-interpret private content using a network AI call.

## Example 1: quiz result

```xingyu-block
{
  "version": 1,
  "type": "quiz_result",
  "title": "Java 泛型小测",
  "items": [
    {"title": "泛型作用", "status": "partial", "explanation": "需要进一步说明类型检查。"},
    {"title": "编译期检查", "status": "correct"},
    {"title": "原始 List", "status": "incorrect", "explanation": "原始类型会失去部分类型检查。"},
    {"title": "泛型 T", "status": "correct"},
    {"title": "泛型与继承", "status": "partial"}
  ]
}
```

The 2 / 2 / 1 summary is computed by the renderer from `items`; it must never be a separately trusted summary field. Optional explanations are available through native keyboard-accessible disclosure controls.

## Example 2: metric grid

```xingyu-block
{
  "version": 1,
  "type": "metric_grid",
  "title": "本周阅读",
  "items": [
    {"label": "阅读时长", "value": "12.5 小时", "note": "来源：个人记录"},
    {"label": "完成文章", "value": "8 篇"},
    {"label": "完成笔记", "value": "3 篇"}
  ]
}
```


## Example 3: status list

```xingyu-block
{
  "version": 1,
  "type": "status_list",
  "title": "学习计划进度",
  "items": [
    {"title": "泛型基础", "status": "done", "detail": "完成练习与复盘"},
    {"title": "通配符", "status": "active", "detail": "正在整理笔记"},
    {"title": "类型擦除", "status": "pending"},
    {"title": "环境故障", "status": "blocked", "detail": "需要修复构建工具"}
  ]
}
```

Allowed `status`: `done`, `active`, `pending`, `blocked`. The author must not infer a task status from unrelated wording. At most 40 entries; optional `detail` is plain text.

## Example 4: timeline

```xingyu-block
{
  "version": 1,
  "type": "timeline",
  "title": "研发记录",
  "items": [
    {"label": "10 月 8 日", "title": "确定文档设计方向"},
    {"label": "10 月 9 日", "title": "完成结构化组件原型", "detail": "内容仍存为 Markdown"}
  ]
}
```

The label is authored chronological text, **not** a parser-invented date; order is preserved. At most 30 items. Optional detail is plain text. Both new types use existing XINGYU Web UI tokens and only render inside existing Markdown documents.

## Authoring and preservation rules

1. Keep paragraphs, headings, existing Markdown tables, attachment links, KaTeX, Mermaid and all ordinary fences untouched.
2. Use a block only when the user-supplied factual data contains all required values. Do not invent metrics or grade outcomes.
3. Store the literal block in the existing Markdown content field; it round-trips through editor/MCP/Knowledge Space import without a database migration.
4. No raw HTML, dynamic React code, URLs, links, JavaScript, function calls or external lookups are permitted inside block values. Strings are displayed as escaped text.
5. The reader is deterministic and offline; no model invocation occurs at view time. It never affects publish/unpublish, draft status, or private Knowledge Space ACL.
6. Every object is versioned (`version:1`), strict-keyed, capped in source length (16,384 code units) and item count (quiz 1–60; metrics 1–12; status 1–40; timeline 1–30). Unknown versions, unknown types and malformed shapes fall back to visible ordinary code fences.
7. Keep authored content editable and reversible. Avoid rewriting legacy Markdown or existing published documents without explicit approval.
8. Render `xingyu-block` on the existing `MarkdownRenderer` pipeline **after** Markdown sanitization, mapping only validated data to known component types.

## Native visual integration — no full-site redesign

- Rich blocks follow the **current XINGYU product palette** (`--ink`, `--muted`, `--blue`, `--soft`, `--line`) and the existing `html[data-theme="dark"]` theme switch.
- Scope all styles to `.markdown-body .xy-block`, so the home page, nav, article heading, modal shell, archive, Knowledge Space management and editor layout retain their existing appearance.
- Correct/partially correct/incorrect states retain semantic green/amber/red labels, but the component surface and actions use XINGYU's existing neutral/blue style.
- Do **not** globally import OpenAI Apps SDK UI CSS or Tailwind reset; optional external component patterns must be adapted inside the block boundary. V1 uses existing React and CSS; it does not install the official OpenAI package.
- No connection to, merging of, or dependency on Quiet Island PR #8. Keep AI Blocks as the only visual change inside documents.

## Safety and QA gates

- Validate correct/malformed/oversized/unknown-schema blocks and HTML-like string payloads.
- Verify keyboard-accessible explanation toggles, semantic summary labels and readable status labels (not color alone).
- Check desktop/mobile, bright/dark, document preview, public post, immersive reader and private Knowledge Space.
- Verify existing `rehypeSanitize`, attachment preview tokens and publish permissions remain unchanged.
- Run full `cd site && npm ci && npm run ci`, then browser screenshots against real app pages before merging. No real data or production deployment during prototype QA.

## Next phase (not in v1)

An opt-in **AI Document Composer** can analyze supplied Markdown at create/update/import time, suggest blocks with source excerpts, and let the user accept/reject the transformation. It must preserve content, cite provenance, and use the same versioned block schema. Later candidates: comparison, chart from explicit numeric series, interactive concept cards. Avoid trying to convert every paragraph into a widget.

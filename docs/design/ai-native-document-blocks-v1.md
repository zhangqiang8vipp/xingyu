# XINGYU AI Document · 结构化文档区块 v1

> STATUS: EXPERIMENTAL / DRAFT PR, not approved to deploy. This capability is independent of Quiet Island's reading-style PR #8.

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

## Authoring and preservation rules

1. Keep paragraphs, headings, existing Markdown tables, attachment links, KaTeX, Mermaid and all ordinary fences untouched.
2. Use a block only when the user-supplied factual data contains all required values. Do not invent metrics or grade outcomes.
3. Store the literal block in the existing Markdown content field; it round-trips through editor/MCP/Knowledge Space import without a database migration.
4. No raw HTML, dynamic React code, URLs, links, JavaScript, function calls or external lookups are permitted inside block values. Strings are displayed as escaped text.
5. The reader is deterministic and offline; no model invocation occurs at view time. It never affects publish/unpublish, draft status, or private Knowledge Space ACL.
6. Every object is versioned (`version:1`), strict-keyed, capped in source length (16,384 code units) and item count (quiz 1–60; metrics 1–12). Unknown versions, unknown types and malformed shapes fall back to visible ordinary code fences.
7. Keep authored content editable and reversible. Avoid rewriting legacy Markdown or existing published documents without explicit approval.
8. Render `xingyu-block` on the existing `MarkdownRenderer` pipeline **after** Markdown sanitization, mapping only validated data to known component types.

## Safety and QA gates

- Validate correct/malformed/oversized/unknown-schema blocks and HTML-like string payloads.
- Verify keyboard-accessible explanation toggles, semantic summary labels and readable status labels (not color alone).
- Check desktop/mobile, bright/dark, document preview, public post, immersive reader and private Knowledge Space.
- Verify existing `rehypeSanitize`, attachment preview tokens and publish permissions remain unchanged.
- Run full `cd site && npm ci && npm run ci`, then browser screenshots against real app pages before merging. No real data or production deployment during prototype QA.

## Next phase (not in v1)

An opt-in **AI Document Composer** can analyze supplied Markdown at create/update/import time, suggest blocks with source excerpts, and let the user accept/reject the transformation. It must preserve content, cite provenance, and use the same versioned block schema. Later candidates: comparison, timeline, progress, chart from explicit numeric series, interactive concept cards. Avoid trying to convert every paragraph into a widget.

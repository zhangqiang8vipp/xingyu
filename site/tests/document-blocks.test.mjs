import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseXingyuBlock, summarizeQuiz } from "../features/document-blocks/schema.ts";
import { XINGYU_DOCUMENT_BLOCK_CATALOG, getXingyuBlockShortList, xingyuBlockMcpInstructions } from "../features/document-blocks/catalog.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("chart SVG titles survive React server rendering as escaped text", async () => {
  const [{ default: ts }, { default: React }, { renderToStaticMarkup }] = await Promise.all([
    import("typescript"), import("react"), import("react-dom/server"),
  ]);
  const compiled = ts.transpileModule(await source("features/document-blocks/MiniChartView.tsx"), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleText = `import React from ${JSON.stringify(import.meta.resolve("react"))};\n${compiled}`;
  const { default: MiniChartView } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);
  for (const [kind, label] of [["bar", "柱状图"], ["line", "折线图"], ["pie", "饼图"]]) {
    const html = renderToStaticMarkup(React.createElement(MiniChartView, { block: {
      version: 1, type: "chart", kind, title: "学习 <记录>", items: [{ label: "一", value: 1 }, { label: "二", value: 2 }],
    } }));
    assert.ok(html.includes(`<title>学习 &lt;记录&gt; · ${label}</title>`));
    assert.ok(!html.includes("<title></title>"));
  }
});

test("XINGYU writing showcase has valid copyable examples for every registered block", async () => {
  const guide = await source("../docs/guides/xingyu-writing-showcase.md");
  const examples = [...guide.matchAll(/```xingyu-block\r?\n([\s\S]*?)```/g)];
  assert.equal(examples.length, 18, "nine rendered examples and nine copyable examples");
  const types = new Set();
  for (const [, json] of examples) {
    const block = parseXingyuBlock(json);
    assert.ok(block, "published example must satisfy the real block schema");
    types.add(block.type);
  }
  assert.deepEqual([...types].sort(), XINGYU_DOCUMENT_BLOCK_CATALOG.map(block => block.type).sort());
  assert.match(guide, /演示数据/);
});

const quiz = {
  version: 1,
  type: "quiz_result",
  title: "Java 泛型练习",
  items: [
    { title: "泛型作用", status: "partial", explanation: "需要说明类型检查。" },
    { title: "编译期检查", status: "correct" },
    { title: "原始 List", status: "incorrect" },
    { title: "泛型 T", status: "correct" },
    { title: "泛型与继承", status: "partial" },
  ],
};

test("XINGYU quiz block parses and derives results without trusting counts", () => {
  const parsed = parseXingyuBlock(JSON.stringify(quiz));
  assert.deepEqual(parsed, quiz);
  assert.deepEqual(summarizeQuiz(parsed.items), { correct: 2, partial: 2, incorrect: 1 });
  assert.equal(parseXingyuBlock(JSON.stringify({ ...quiz, correct: 100 })), null);
});

test("metric blocks preserve authored values and notes", () => {
  const metrics = { version: 1, type: "metric_grid", title: "学习记录", items: [
    { label: "学习时长", value: "12.5 小时", note: "个人记录" },
    { label: "复习章节", value: "8 章" },
  ] };
  assert.deepEqual(parseXingyuBlock(JSON.stringify(metrics)), metrics);
});

test("unknown, malformed, oversized and extra-key blocks are rejected", () => {
  const invalid = [
    "",
    "not json",
    JSON.stringify({ version: 2, type: "quiz_result", items: quiz.items }),
    JSON.stringify({ version: 1, type: "fake", items: quiz.items }),
    JSON.stringify({ version: 1, type: "metric_grid", items: [] }),
    JSON.stringify({ version: 1, type: "quiz_result", items: [] }),
    JSON.stringify({ ...quiz, items: [...quiz.items, ...Array.from({ length: 60 }, () => quiz.items[0])] }),
    JSON.stringify({ version: 1, type: "metric_grid", items: Array.from({ length: 13 }, () => ({ label: "a", value: "1" })) }),
    JSON.stringify({ version: 1, type: "quiz_result", items: [{ title: "a", status: "passed" }] }),
    JSON.stringify({ version: 1, type: "metric_grid", items: [{ label: "x", value: 100 }] }),
    JSON.stringify({ version: 1, type: "metric_grid", items: [{ label: "x", value: "1", onClick: "alert(1)" }] }),
    JSON.stringify({ ...quiz, title: "\u0000" }),
    " ".repeat(17_000),
  ];
  for (const item of invalid) assert.equal(parseXingyuBlock(item), null, item.slice(0, 80));
});

test("HTML-looking text is never treated as markup or evaluated", async () => {
  const value = "<img src=x onerror=alert(1)>";
  const parsed = parseXingyuBlock(JSON.stringify({
    version: 1, type: "metric_grid", items: [{ label: value, value: "1" }],
  }));
  assert.equal(parsed.items[0].label, value);
  const view = await source("features/document-blocks/XingyuBlockView.tsx");
  assert.doesNotMatch(view, /dangerouslySetInnerHTML|eval\(|new Function\(/);
  assert.match(view, /\{item\.label\}/);
  assert.match(view, /<details className="xy-quiz-explanation">/);
});

test("Markdown Plus routes only valid fences into the new renderer", async () => {
  const [markdown, mcp, pkg] = await Promise.all([
    source("features/markdown/MarkdownRenderer.tsx"),
    source("worker/blog-mcp.ts"),
    source("package.json"),
  ]);
  assert.match(markdown, /rehypeSanitize/);
  assert.match(markdown, /plainText: \["mermaid", "xingyu-block"/);
  assert.match(markdown, /parseXingyuBlock\(source\)/);
  assert.match(markdown, /if \(block\) return <XingyuBlockView block=\{block\} \/>/);
  assert.match(markdown, /Malformed\/unknown blocks remain visible/);
  assert.match(markdown, /previewAuthorizedUrl/);
  assert.match(mcp, /xingyu-block JSON/);
  assert.match(mcp, /xingyuBlockMcpInstructions/);
  assert.match(mcp, /version: "2\.0\.0"/);
  const toolDescriptions = await source("worker/mcp/draft-tools.ts");
  assert.match(toolDescriptions, /可选的 xingyu-block/);
  assert.match(toolDescriptions, /以 xingyu-block 为语言标记/);
  const guide = await source("../docs/guides/ai-document-blocks-mcp.md");
  assert.equal((guide.match(/```xingyu-block/g) || []).length, 4);
  assert.match(pkg, /tests\/document-blocks\.test\.mjs/);
});


test("AI blocks inherit the existing XINGYU design without restyling the website", async () => {
  const [css, globals, layout, component] = await Promise.all([
    source("features/document-blocks/blocks.css"),
    source("app/globals.css"),
    source("app/layout.tsx"),
    source("features/document-blocks/XingyuBlockView.tsx"),
  ]);
  for (const token of ["--ink", "--muted", "--blue", "--soft", "--line"]) {
    assert.ok(css.includes("var(" + token), "native site token missing: " + token);
    assert.ok(globals.includes(token + ":"), "token not defined by current site: " + token);
  }
  assert.match(css, /\.markdown-body \.xy-block/);
  assert.match(css, /html\[data-theme="dark"\] \.markdown-body \.xy-block/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?::root|body|html|main|button|h1|p)\s*\{/);
  assert.doesNotMatch(layout, /document-blocks|quiet-island|apps-sdk-ui/);
  assert.match(component, /import "\.\/blocks\.css"/);
  assert.doesNotMatch(css, /#fbfaf7|#26302f|#4a7870/);
});


test("status list block uses explicit progress states without inferred status", () => {
  const input = {
    version: 1, type: "status_list", title: "开发计划",
    items: [
      { title: "解析器实现", status: "done", detail: "现有结构化 Markdown 可以识别" },
      { title: "视觉验收", status: "active" },
      { title: "全量上线", status: "pending" },
      { title: "外部依赖", status: "blocked" },
    ],
  };
  assert.deepEqual(parseXingyuBlock(JSON.stringify(input)), input);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ title: "流程", status: "success" }],
  })), null);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ title: "流程", status: "done", onclick: "alert(1)" }],
  })), null);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: Array.from({ length: 41 }, () => ({ title: "进度", status: "done" })),
  })), null);
});

test("timeline block preserves explicit labels but rejects unknown properties", () => {
  const input = {
    version: 1, type: "timeline", title: "项目记录",
    items: [
      { label: "2026-10-08", title: "明确界面方向", detail: "保留原有星屿视觉。" },
      { label: "2026-10-09", title: "添加 AI 内容组件" },
    ],
  };
  assert.deepEqual(parseXingyuBlock(JSON.stringify(input)), input);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ label: "明天", title: "新节点", script: "alert(1)" }],
  })), null);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ label: "明天", title: "新节点", detail: "x".repeat(321) }],
  })), null);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: Array.from({ length: 31 }, () => ({ label: "日期", title: "节点" })),
  })), null);
});

test("status and timeline reuse scoped existing-theme styles and stay pure text", async () => {
  const [view, css] = await Promise.all([
    source("features/document-blocks/XingyuBlockView.tsx"),
    source("features/document-blocks/blocks.css"),
  ]);
  assert.match(view, /block\.type === "status_list"/);
  assert.match(view, /block\.type === "timeline"/);
  assert.match(view, /xy-status-pill-/);
  assert.match(view, /xy-timeline-items/);
  assert.doesNotMatch(view, /dangerouslySetInnerHTML|eval\(|new Function\(/);
  assert.match(css, /\.markdown-body \.xy-block ul\.xy-status-items/);
  assert.match(css, /\.markdown-body \.xy-block ol\.xy-timeline-items/);
  assert.match(css, /html\[data-theme="dark"\] \.markdown-body \.xy-status-pill-done/);
});


test("comparison block validates two-to-three column values and exact row widths", () => {
  const input = {
    version: 1, type: "comparison", title: "ArrayList vs LinkedList",
    columns: [{ name: "ArrayList" }, { name: "LinkedList", note: "双向链表" }],
    rows: [
      { label: "随机访问", values: ["通常较快", "通常较慢"] },
      { label: "中间删除", values: ["可能搬移元素", "已定位节点后修改链接"] },
    ],
    takeaway: "根据实际访问模式选择。",
  };
  assert.deepEqual(parseXingyuBlock(JSON.stringify(input)), input);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, rows: [{ label: "不匹配", values: ["仅一项"] }],
  })), null);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, columns: Array.from({ length: 4 }, (_, i) => ({ name: `选项 ${i}` })),
  })), null);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, rows: [{ label: "测试", values: ["安全", "<script>alert(1)</script>"], html: true }],
  })), null);
});

test("flashcards reject missing answers, unknown keys and excessive card counts", () => {
  const input = { version: 1, type: "flashcards", title: "Java 复习",
    items: [
      { question: "什么是类型擦除？", answer: "编译时替换大部分泛型类型参数。" },
      { question: "泛型何时检查？", answer: "主要在编译期。", hint: "关注编译器。" },
    ],
  };
  assert.deepEqual(parseXingyuBlock(JSON.stringify(input)), input);
  for (const invalid of [
    { ...input, items: [{ question: "问题", answer: "" }] },
    { ...input, items: [{ question: "问题", answer: "答案", script: "alert(1)" }] },
    { ...input, items: Array.from({ length: 31 }, () => input.items[0]) },
    { ...input, items: [{ question: "问题", answer: "A".repeat(751) }] },
  ]) assert.equal(parseXingyuBlock(JSON.stringify(invalid)), null);
});

test("chart only accepts finite, bounded and labeled non-negative source data", () => {
  const entries = [{ label: "周一", value: 1.5 }, { label: "周二", value: 2.5 }];
  for (const kind of ["bar", "line", "pie"]) {
    const input = { version: 1, type: "chart", kind, title: "学习趋势", unit: "小时", items: entries };
    assert.deepEqual(parseXingyuBlock(JSON.stringify(input)), input);
  }
  const base = { version: 1, type: "chart", kind: "bar", items: entries };
  for (const invalid of [
    { ...base, items: [{ label: "x", value: -1 }, entries[1]] },
    { ...base, items: [{ label: "x", value: 1_000_000_001 }, entries[1]] },
    { ...base, items: [{ label: "x", value: "3" }, entries[1]] },
    { ...base, items: [{ label: "重复", value: 2 }, { label: "重复", value: 3 }] },
    { ...base, kind: "donut" },
    { ...base, items: Array.from({ length: 13 }, (_, i) => ({ label: String(i), value: i })) },
    { ...base, items: [{ label: "x", value: NaN }, entries[1]] },
    { ...base, items: [{ label: "x", value: Infinity }, entries[1]] },
    { ...base, kind: "pie", items: [{ label: "A", value: 0 }, { label: "B", value: 0 }] },
    { ...base, kind: "pie", items: Array.from({ length: 9 }, (_, i) => ({ label: String(i), value: i + 1 })) },
  ]) assert.equal(parseXingyuBlock(JSON.stringify(invalid)), null);
});

test("steps preserve plain code as data without executable instructions", () => {
  const input = { version: 1, type: "steps", title: "操作指引", items: [
    { title: "准备环境", description: "先核实 Node 版本。", command: "node --version" },
    { title: "运行检查", description: "检查完成后再处理结果。" },
  ] };
  assert.deepEqual(parseXingyuBlock(JSON.stringify(input)), input);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ title: "x", description: "", command: "npm ci" }],
  })), null);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ title: "x", description: "说明", command: "x".repeat(601) }],
  })), null);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ title: "x", description: "说明", onClick: "alert(1)" }],
  })), null);
});

test("sources are HTTPS-only with no user info or extra executable fields", () => {
  const input = { version: 1, type: "sources", title: "参考资料", items: [
    { label: "Java 文档", url: "https://docs.oracle.com/en/java/", note: "官方参考" },
  ] };
  assert.deepEqual(parseXingyuBlock(JSON.stringify(input)), input);
  for (const url of [
    "http://example.com", "javascript:alert(1)", "data:text/html,hi",
    "/api/attachments/att_0123", "https://user:pass@example.com/",
    "https://example.com/\nmore", "https://example.com/\\bad",
    "https://", "https://example.com/ trailing",
  ]) assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ label: "bad", url }],
  })), null, url);
  assert.equal(parseXingyuBlock(JSON.stringify({
    ...input, items: [{ label: "bad", url: "https://example.com", onclick: "alert(1)" }],
  })), null);
});

test("plus renderer remains XINGYU-scoped, interactive flashcards are isolated", async () => {
  const [view, cards, chart, css, renderer, guide] = await Promise.all([
    source("features/document-blocks/XingyuBlockView.tsx"),
    source("features/document-blocks/FlashcardsView.tsx"),
    source("features/document-blocks/MiniChartView.tsx"),
    source("features/document-blocks/blocks.css"),
    source("features/markdown/MarkdownRenderer.tsx"),
    source("../docs/guides/ai-document-blocks-plus.md"),
  ]);
  for (const t of ["comparison", "flashcards", "chart", "steps", "sources"])
    assert.match(view, new RegExp('block\\.type === "' + t + '"'));
  assert.match(cards, /^"use client";/);
  assert.match(cards, /aria-expanded=\{revealed\}/);
  assert.match(cards, /onClick=\{\(\) => navigate\(index \+ 1\)\}/);
  assert.match(chart, /role="img"/);
  assert.match(chart, /<details className="xy-chart-raw">/);
  assert.match(view, /rel="noopener noreferrer"/);
  assert.match(view, /referrerPolicy="no-referrer"/);
  assert.match(renderer, /rehypeSanitize/);
  assert.match(css, /\.markdown-body \.xy-flash-stage/);
  assert.match(css, /\.markdown-body \.xy-comparison-table/);
  assert.match(css, /\.markdown-body \.xy-chart-svg/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?::root|body|html|main)\s*\{/);
  for (const code of [view, cards, chart]) assert.doesNotMatch(code, /dangerouslySetInnerHTML|eval\(|new Function\(/);
  const examples = [...guide.matchAll(/```xingyu-block\s*\n([\s\S]*?)\n```/g)];
  assert.equal(examples.length, 5);
  for (const example of examples) {
    const data = JSON.parse(example[1]);
    assert.deepEqual(parseXingyuBlock(example[1]), data, "documented example must validate");
  }
});

test("typed capability catalog drives MCP discovery without business-code type lists", async () => {
  const types = XINGYU_DOCUMENT_BLOCK_CATALOG.map((entry) => entry.type);
  assert.deepEqual(types, [
    "quiz_result", "metric_grid", "status_list", "timeline",
    "comparison", "flashcards", "chart", "steps", "sources",
  ]);
  assert.equal(new Set(types).size, types.length);
  for (const type of types) {
    assert.match(xingyuBlockMcpInstructions(), new RegExp(type));
    assert.match(getXingyuBlockShortList(), new RegExp(type));
  }
  const [workerSource, toolSource] = await Promise.all([
    source("worker/blog-mcp.ts"), source("worker/mcp/draft-tools.ts"),
  ]);
  assert.match(workerSource, /xingyuBlockMcpInstructions\(\)/);
  assert.match(toolSource, /getXingyuBlockShortList\(\)/);
  assert.match(workerSource, /创建私有知识必须显式传入 space/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseXingyuBlock, summarizeQuiz } from "../features/document-blocks/schema.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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
  assert.match(mcp, /version: "1\\.1\\.0"/);
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
    ...input, items: Array.from({ length: 41 }, () => ({ title: "进度", status: "done" }))],
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
    ...input, items: Array.from({ length: 31 }, () => ({ label: "日期", title: "节点" }))],
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

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
  assert.match(pkg, /tests\/document-blocks\.test\.mjs/);
});

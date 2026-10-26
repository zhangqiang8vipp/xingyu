import test from "node:test";
import assert from "node:assert/strict";
import { mergeMarkdown } from "../domain/posts/three-way-merge.mjs";

test("independent section edits merge without overwriting either agent", () => {
  const base = "# Guide\n## Deploy\nold deploy\n## Recovery\nold recovery";
  const a = base.replace("old deploy", "new deploy");
  const b = base.replace("old recovery", "new recovery");
  assert.deepEqual(mergeMarkdown(base, a, b), {
    status: "merged",
    content: "# Guide\n## Deploy\nnew deploy\n## Recovery\nnew recovery",
  });
});
test("overlapping edits fail closed", () => {
  const base = "# Guide\nold";
  const result = mergeMarkdown(base, "# Guide\nagent A", "# Guide\nagent B");
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "overlapping_changes");
});
test("same insertion boundary by two agents conflicts", () => {
  const base = "# Guide\nparagraph";
  assert.equal(mergeMarkdown(base, "# Guide\nA\nparagraph", "# Guide\nB\nparagraph").status, "conflict");
});
test("identical concurrent edits are idempotent", () => {
  assert.deepEqual(mergeMarkdown("a", "b", "b"), { status: "merged", content: "b" });
});
test("no change preserves current head", () => {
  assert.deepEqual(mergeMarkdown("a", "b", "a"), { status: "merged", content: "b" });
});
test("large input fails closed rather than consuming unbounded memory", () => {
  const base = Array.from({length: 1200}, (_, i) => String(i)).join("\n");
  assert.equal(mergeMarkdown(base, base + "\nx", base + "\ny").status, "conflict");
});

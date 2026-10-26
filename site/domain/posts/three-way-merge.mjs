/**
 * Conservative, deterministic three-way line merge for Markdown documents.
 * base = version read by collaborator, current = committed head, proposed = edit.
 * Any potentially overlapping hunks are reported as conflicts (never overwritten).
 * Independent insertions at the same position intentionally conflict.
 */
function lines(value) {
  if (typeof value !== "string") throw new TypeError("Expected text");
  return value.split("\n");
}
function edits(base, changed) {
  const a = lines(base), b = lines(changed);
  // Bounded dynamic programming. Large files must use a chunked diff algorithm.
  if (a.length * b.length > 1_000_000) return null;
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result = [];
  let i = 0, j = 0;
  let start = -1, removed = 0, added = [];
  const flush = () => {
    if (start >= 0) result.push({ start, end: start + removed, lines: added });
    start = -1; removed = 0; added = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush(); i++; j++;
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      if (start < 0) start = i;
      added.push(b[j++]);
    } else {
      if (start < 0) start = i;
      removed++; i++;
    }
  }
  flush();
  return result;
}
function overlaps(a, b) {
  // Same-position insertions or insertion at changed boundary are ambiguous.
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return a.start >= b.start && a.start <= b.end;
  if (b.start === b.end) return b.start >= a.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}
/**
 * @returns {{status:"merged",content:string}|{status:"conflict",reason:string,conflicts?:object[]}}
 */
export function mergeMarkdown(base, current, proposed) {
  if ([base, current, proposed].some(v => typeof v !== "string"))
    throw new TypeError("Merge inputs must be strings");
  if (current === proposed) return { status: "merged", content: current };
  if (base === current) return { status: "merged", content: proposed };
  if (base === proposed) return { status: "merged", content: current };
  const ours = edits(base, current), theirs = edits(base, proposed);
  if (!ours || !theirs) return { status: "conflict", reason: "document_too_large_for_safe_merge" };
  const conflicts = [];
  for (const left of ours) for (const right of theirs) {
    if (overlaps(left, right)) {
      if (left.start === right.start && left.end === right.end && left.lines.join("\n") === right.lines.join("\n")) continue;
      conflicts.push({ current: left, proposed: right });
    }
  }
  if (conflicts.length) return { status: "conflict", reason: "overlapping_changes", conflicts };
  const combined = [...ours, ...theirs].sort((a, b) => b.start - a.start || b.end - a.end);
  const unique = [];
  for (const edit of combined) {
    if (!unique.some(x => x.start === edit.start && x.end === edit.end && x.lines.join("\n") === edit.lines.join("\n"))) unique.push(edit);
  }
  const result = lines(base);
  for (const edit of unique) result.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return { status: "merged", content: result.join("\n") };
}

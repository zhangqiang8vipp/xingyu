/**
 * XINGYU Blocks v1: strict, intentionally tiny, render-only data contract.
 * AI authors may write fenced `xingyu-block` JSON, but the reader never runs AI
 * or evaluates scripts from document content.
 */
export type QuizStatus = "correct" | "partial" | "incorrect";

export type QuizResultBlock = {
  version: 1;
  type: "quiz_result";
  title?: string;
  items: Array<{ title: string; status: QuizStatus; explanation?: string }>;
};

export type MetricGridBlock = {
  version: 1;
  type: "metric_grid";
  title?: string;
  items: Array<{ label: string; value: string; note?: string }>;
};

export type ProgressStatus = "done" | "active" | "pending" | "blocked";

export type StatusListBlock = {
  version: 1;
  type: "status_list";
  title?: string;
  items: Array<{ title: string; status: ProgressStatus; detail?: string }>;
};

export type TimelineBlock = {
  version: 1;
  type: "timeline";
  title?: string;
  items: Array<{ label: string; title: string; detail?: string }>;
};

export type XingyuBlock = QuizResultBlock | MetricGridBlock | StatusListBlock | TimelineBlock;

const MAX_SOURCE_LENGTH = 16_384;
const textControlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function text(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !textControlCharacters.test(value);
}

function optionalText(value: Record<string, unknown>, key: string, maxLength: number) {
  return !(key in value) || text(value[key], maxLength);
}

export function parseXingyuBlock(source: string): XingyuBlock | null {
  if (!source || source.length > MAX_SOURCE_LENGTH) return null;
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return null;
  }
  if (!record(data) || data.version !== 1
    || !optionalText(data, "title", 100)) return null;

  if (data.type === "quiz_result") {
    if (!exactKeys(data, ["version", "type", "title", "items"])
      || !Array.isArray(data.items)
      || data.items.length < 1 || data.items.length > 60) return null;

    const items: QuizResultBlock["items"] = [];
    for (const entry of data.items) {
      if (!record(entry)
        || !exactKeys(entry, ["title", "status", "explanation"])
        || !text(entry.title, 120)
        || (entry.status !== "correct" && entry.status !== "partial" && entry.status !== "incorrect")
        || !optionalText(entry, "explanation", 320)) return null;
      items.push({
        title: entry.title,
        status: entry.status,
        ...("explanation" in entry ? { explanation: entry.explanation as string } : {}),
      });
    }
    return { version: 1, type: "quiz_result",
      ...("title" in data ? { title: data.title as string } : {}), items };
  }

  if (data.type === "metric_grid") {
    if (!exactKeys(data, ["version", "type", "title", "items"])
      || !Array.isArray(data.items)
      || data.items.length < 1 || data.items.length > 12) return null;

    const items: MetricGridBlock["items"] = [];
    for (const entry of data.items) {
      if (!record(entry)
        || !exactKeys(entry, ["label", "value", "note"])
        || !text(entry.label, 60)
        || !text(entry.value, 32)
        || !optionalText(entry, "note", 120)) return null;
      items.push({
        label: entry.label,
        value: entry.value,
        ...("note" in entry ? { note: entry.note as string } : {}),
      });
    }
    return { version: 1, type: "metric_grid",
      ...("title" in data ? { title: data.title as string } : {}), items };
  }


  if (data.type === "status_list") {
    if (!exactKeys(data, ["version", "type", "title", "items"])
      || !Array.isArray(data.items)
      || data.items.length < 1 || data.items.length > 40) return null;

    const items: StatusListBlock["items"] = [];
    for (const entry of data.items) {
      if (!record(entry)
        || !exactKeys(entry, ["title", "status", "detail"])
        || !text(entry.title, 120)
        || (entry.status !== "done" && entry.status !== "active"
          && entry.status !== "pending" && entry.status !== "blocked")
        || !optionalText(entry, "detail", 320)) return null;
      items.push({
        title: entry.title,
        status: entry.status,
        ...("detail" in entry ? { detail: entry.detail as string } : {}),
      });
    }
    return { version: 1, type: "status_list",
      ...("title" in data ? { title: data.title as string } : {}), items };
  }

  if (data.type === "timeline") {
    if (!exactKeys(data, ["version", "type", "title", "items"])
      || !Array.isArray(data.items)
      || data.items.length < 1 || data.items.length > 30) return null;

    const items: TimelineBlock["items"] = [];
    for (const entry of data.items) {
      if (!record(entry)
        || !exactKeys(entry, ["label", "title", "detail"])
        || !text(entry.label, 80)
        || !text(entry.title, 120)
        || !optionalText(entry, "detail", 320)) return null;
      items.push({
        label: entry.label,
        title: entry.title,
        ...("detail" in entry ? { detail: entry.detail as string } : {}),
      });
    }
    return { version: 1, type: "timeline",
      ...("title" in data ? { title: data.title as string } : {}), items };
  }

  return null;
}

export function summarizeQuiz(items: QuizResultBlock["items"]) {
  return {
    correct: items.filter((item) => item.status === "correct").length,
    partial: items.filter((item) => item.status === "partial").length,
    incorrect: items.filter((item) => item.status === "incorrect").length,
  };
}

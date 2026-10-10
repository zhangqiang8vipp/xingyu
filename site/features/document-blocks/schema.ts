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

export type ComparisonBlock = {
  version: 1;
  type: "comparison";
  title?: string;
  takeaway?: string;
  columns: Array<{ name: string; note?: string }>;
  rows: Array<{ label: string; values: string[] }>;
};

export type FlashcardsBlock = {
  version: 1;
  type: "flashcards";
  title?: string;
  items: Array<{ question: string; answer: string; hint?: string }>;
};

export type ChartBlock = {
  version: 1;
  type: "chart";
  title?: string;
  kind: "bar" | "line" | "pie";
  unit?: string;
  items: Array<{ label: string; value: number }>;
};

export type StepsBlock = {
  version: 1;
  type: "steps";
  title?: string;
  items: Array<{ title: string; description: string; command?: string }>;
};

export type SourcesBlock = {
  version: 1;
  type: "sources";
  title?: string;
  items: Array<{ label: string; url: string; note?: string }>;
};

export type XingyuBlock = QuizResultBlock | MetricGridBlock | StatusListBlock
  | TimelineBlock | ComparisonBlock | FlashcardsBlock | ChartBlock | StepsBlock | SourcesBlock;

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

/** Validate outbound links; the renderer never fetches them or follows redirects. */
function safeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 600 || value !== value.trim()
    || !/^https:\/\/[^\s\\]+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
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


  if (data.type === "comparison") {
    if (!exactKeys(data, ["version", "type", "title", "takeaway", "columns", "rows"])
      || !optionalText(data, "takeaway", 350)
      || !Array.isArray(data.columns) || data.columns.length < 2 || data.columns.length > 3
      || !Array.isArray(data.rows) || data.rows.length < 1 || data.rows.length > 12) return null;
    const columns: ComparisonBlock["columns"] = [];
    for (const entry of data.columns) {
      if (!record(entry) || !exactKeys(entry, ["name", "note"])
        || !text(entry.name, 55) || !optionalText(entry, "note", 120)) return null;
      columns.push({ name: entry.name, ...("note" in entry ? { note: entry.note as string } : {}) });
    }
    const rows: ComparisonBlock["rows"] = [];
    for (const entry of data.rows) {
      if (!record(entry) || !exactKeys(entry, ["label", "values"])
        || !text(entry.label, 65) || !Array.isArray(entry.values)
        || entry.values.length !== columns.length
        || !entry.values.every((v: unknown) => text(v, 200))) return null;
      rows.push({ label: entry.label, values: entry.values as string[] });
    }
    return { version: 1, type: "comparison",
      ...("title" in data ? { title: data.title as string } : {}),
      ...("takeaway" in data ? { takeaway: data.takeaway as string } : {}), columns, rows };
  }

  if (data.type === "flashcards") {
    if (!exactKeys(data, ["version", "type", "title", "items"])
      || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 30) return null;
    const items: FlashcardsBlock["items"] = [];
    for (const entry of data.items) {
      if (!record(entry) || !exactKeys(entry, ["question", "answer", "hint"])
        || !text(entry.question, 180) || !text(entry.answer, 750)
        || !optionalText(entry, "hint", 180)) return null;
      items.push({ question: entry.question, answer: entry.answer,
        ...("hint" in entry ? { hint: entry.hint as string } : {}) });
    }
    return { version: 1, type: "flashcards",
      ...("title" in data ? { title: data.title as string } : {}), items };
  }

  if (data.type === "chart") {
    if (!exactKeys(data, ["version", "type", "title", "kind", "unit", "items"])
      || (data.kind !== "bar" && data.kind !== "line" && data.kind !== "pie")
      || !optionalText(data, "unit", 24)
      || !Array.isArray(data.items) || data.items.length < 2
      || data.items.length > (data.kind === "pie" ? 8 : 12)) return null;
    const items: ChartBlock["items"] = [];
    const seenLabels = new Set<string>();
    for (const entry of data.items) {
      if (!record(entry) || !exactKeys(entry, ["label", "value"])
        || !text(entry.label, 40) || seenLabels.has(entry.label)
        || typeof entry.value !== "number" || !Number.isFinite(entry.value)
        || entry.value < 0 || entry.value > 1_000_000_000) return null;
      seenLabels.add(entry.label);
      items.push({ label: entry.label, value: entry.value });
    }
    if (data.kind === "pie" && items.every((entry) => entry.value === 0)) return null;
    return { version: 1, type: "chart",
      ...("title" in data ? { title: data.title as string } : {}),
      ...("unit" in data ? { unit: data.unit as string } : {}),
      kind: data.kind, items };
  }

  if (data.type === "steps") {
    if (!exactKeys(data, ["version", "type", "title", "items"])
      || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 15) return null;
    const items: StepsBlock["items"] = [];
    for (const entry of data.items) {
      if (!record(entry) || !exactKeys(entry, ["title", "description", "command"])
        || !text(entry.title, 100) || !text(entry.description, 900)
        || !optionalText(entry, "command", 600)) return null;
      items.push({ title: entry.title, description: entry.description,
        ...("command" in entry ? { command: entry.command as string } : {}) });
    }
    return { version: 1, type: "steps",
      ...("title" in data ? { title: data.title as string } : {}), items };
  }

  if (data.type === "sources") {
    if (!exactKeys(data, ["version", "type", "title", "items"])
      || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 15) return null;
    const items: SourcesBlock["items"] = [];
    for (const entry of data.items) {
      if (!record(entry) || !exactKeys(entry, ["label", "url", "note"])
        || !text(entry.label, 140) || !safeHttpsUrl(entry.url)
        || !optionalText(entry, "note", 360)) return null;
      items.push({ label: entry.label, url: entry.url,
        ...("note" in entry ? { note: entry.note as string } : {}) });
    }
    return { version: 1, type: "sources",
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

export const KNOWLEDGE_IMPORT_MAX_ITEMS = 100;
export const KNOWLEDGE_IMPORT_MAX_SLUG_LENGTH = 180;

export type KnowledgeImportErrorCode =
  | "invalid_item"
  | "invalid_name"
  | "unsupported_type"
  | "empty_content";

export type KnowledgeImportItem = {
  index: number;
  name: string;
  title: string;
  content: string;
  slug: string;
};

export class KnowledgeImportItemError extends Error {
  constructor(
    readonly code: KnowledgeImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeImportItemError";
  }
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeSlugCore(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createKnowledgeImportSlug(spaceId: number, title: string) {
  const prefix = `knowledge-${spaceId}-`;
  const hash = stableHash(title);
  const normalized = normalizeSlugCore(title);
  const core = normalized || `item-${hash}`;
  const candidate = `${prefix}${core}`;
  if (candidate.length <= KNOWLEDGE_IMPORT_MAX_SLUG_LENGTH) return candidate;

  const suffix = `-${hash}`;
  const room = Math.max(1, KNOWLEDGE_IMPORT_MAX_SLUG_LENGTH - prefix.length - suffix.length);
  const shortened = core.slice(0, room).replace(/-+$/g, "") || "item";
  return `${prefix}${shortened}${suffix}`;
}

export function mapKnowledgeImportItem(raw: unknown, index: number, spaceId: number): KnowledgeImportItem {
  const fallbackName = `第 ${index + 1} 项`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new KnowledgeImportItemError("invalid_item", `${fallbackName} 不是可导入的文本文件`);
  }

  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    throw new KnowledgeImportItemError("invalid_name", `${fallbackName} 缺少文件名`);
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new KnowledgeImportItemError("invalid_name", `${name} 的文件名无效，请保留文件名本身后重试`);
  }

  const match = /^(.*)\.(md|markdown|txt)$/i.exec(name);
  if (!match) {
    throw new KnowledgeImportItemError("unsupported_type", `${name} 不是支持的 .md、.markdown 或 .txt 文件`);
  }

  const title = match[1].trim();
  if (!title) {
    throw new KnowledgeImportItemError("invalid_name", `${name} 无法生成文章标题，请重命名文件后重试`);
  }

  if (typeof record.content !== "string") {
    throw new KnowledgeImportItemError("invalid_item", `${name} 的文本内容无法读取`);
  }
  const content = record.content;
  if (!content.trim()) {
    throw new KnowledgeImportItemError("empty_content", `${name} 是空文件，请补充内容后重试`);
  }

  return {
    index,
    name,
    title,
    content,
    slug: createKnowledgeImportSlug(spaceId, title),
  };
}

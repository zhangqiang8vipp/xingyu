import {
  KNOWLEDGE_IMPORT_MAX_ITEMS,
  KnowledgeImportItemError,
  mapKnowledgeImportItem,
} from "@/domain/knowledge-import";
import { createPostRecord, PostWriteError } from "./post-write";
import { getSpaceOverview } from "./spaces";

export type KnowledgeImportResult =
  | {
      index: number;
      name: string;
      status: "imported";
      post: { id: number; publicId: string; title: string; slug: string };
    }
  | {
      index: number;
      name: string;
      status: "error";
      error: {
        code: "invalid" | "duplicate" | "failed";
        message: string;
      };
    };

export class KnowledgeImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "KnowledgeImportError";
  }
}

function itemName(raw: unknown, index: number) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const name = (raw as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return `第 ${index + 1} 项`;
}

function failedResult(raw: unknown, index: number, error: unknown): KnowledgeImportResult {
  const name = itemName(raw, index);
  if (error instanceof KnowledgeImportItemError) {
    return {
      index,
      name,
      status: "error",
      error: { code: "invalid", message: error.message },
    };
  }

  if (error instanceof PostWriteError) {
    const duplicate = error.status === 409 && (error.message.includes("Slug") || error.message.includes("地址"));
    if (duplicate) {
      return {
        index,
        name,
        status: "error",
        error: {
          code: "duplicate",
          message: "同名知识已存在或该文件映射到已占用地址；本次未覆盖任何内容。请重命名文件后重试。",
        },
      };
    }
    return {
      index,
      name,
      status: "error",
      error: { code: "invalid", message: error.message },
    };
  }

  return {
    index,
    name,
    status: "error",
    error: {
      code: "failed",
      message: "导入未完成，请刷新空间确认当前状态后重试；已有文章不会被覆盖。",
    },
  };
}

export async function importKnowledgeItems(spaceId: number, rawItems: unknown) {
  if (!Number.isSafeInteger(spaceId) || spaceId < 1) {
    throw new KnowledgeImportError("知识空间不存在", 404);
  }
  if (!Array.isArray(rawItems)) {
    throw new KnowledgeImportError("请选择要导入的 Markdown 或文本文件");
  }
  if (rawItems.length < 1) {
    throw new KnowledgeImportError("至少选择 1 个 Markdown 或文本文件");
  }
  if (rawItems.length > KNOWLEDGE_IMPORT_MAX_ITEMS) {
    throw new KnowledgeImportError(`一次最多导入 ${KNOWLEDGE_IMPORT_MAX_ITEMS} 个文件，请分批重试`);
  }

  const target = await getSpaceOverview(spaceId);
  if (!target) throw new KnowledgeImportError("知识空间不存在", 404);

  const results: KnowledgeImportResult[] = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const raw = rawItems[index];
    try {
      const item = mapKnowledgeImportItem(raw, index, spaceId);
      const post = await createPostRecord({
        title: item.title,
        slug: item.slug,
        excerpt: "",
        content: item.content,
        categoryId: 1,
        spaceId,
        status: "draft",
        featured: false,
        publishedAt: null,
      });
      results.push({
        index,
        name: item.name,
        status: "imported",
        post: {
          id: post.id,
          publicId: post.publicId,
          title: post.title,
          slug: post.slug,
        },
      });
    } catch (error) {
      results.push(failedResult(raw, index, error));
    }
  }

  const imported = results.filter((result) => result.status === "imported").length;
  return {
    space: { id: target.id, name: target.name },
    summary: {
      total: results.length,
      imported,
      failed: results.length - imported,
    },
    results,
  };
}

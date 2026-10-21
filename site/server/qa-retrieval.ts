import { env } from "cloudflare:workers";
import { ensurePersonalWorkspace, workspaceGrant } from "@/db/workspace-access";
import { accessibleSpaceIds } from "@/db/space-acl";

export type AskScope = "public" | "mine" | "all";
export type AskIdentity = { userId: number } | null;
export type AskSource = {
  id: number;
  title: string;
  excerpt: string;
  snippet: string;
  visibility: "public" | "personal";
  url: string;
};

type Row = {
  id: number; publicId: string; title: string; slug: string;
  excerpt: string; content: string; updatedAt: string;
};

const STOP_WORDS = new Set([
  "这个", "那个", "网站", "请问", "请", "问", "哪些", "什么",
  "主要", "分享", "关于", "相关", "一下", "告诉", "我们", "可以",
  "是否", "如何", "怎么", "就是", "内容", "文章", "里面", "都有",
  "the", "with", "from", "this", "that", "which", "what", "where",
  "are", "was", "were", "has", "have", "does", "for", "and", "about",
  "can", "please", "site", "website", "posts", "articles",
]);

/** Search keywords are never interpreted as SQL or FTS syntax. */
export function askSearchTerms(question: string): string[] {
  const normalized = question.normalize("NFKC").slice(0, 240);
  const words = Array.from(new Intl.Segmenter("zh", { granularity: "word" }).segment(normalized))
    .filter(part => part.isWordLike)
    .map(part => part.segment.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}#+._-]/gu, ""))
    .filter(part => part.length >= 2 && part.length <= 45 && !STOP_WORDS.has(part));
  return Array.from(new Set(words)).slice(0, 6);
}

function snippetFrom(row: Row, terms: string[]) {
  const plain = row.content.replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*|>{}]/g, " ")
    .replace(/\s+/g, " ").trim();
  const lower = plain.toLocaleLowerCase("en-US");
  const hits = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const start = hits.length ? Math.max(0, Math.min(...hits) - 170) : 0;
  const fragment = plain.slice(start, start + 1050);
  return (start > 0 ? "…" : "") + fragment + (start + 1050 < plain.length ? "…" : "");
}

function score(row: Row, terms: string[]) {
  const title = row.title.toLocaleLowerCase("en-US");
  const excerpt = row.excerpt.toLocaleLowerCase("en-US");
  const body = row.content.toLocaleLowerCase("en-US");
  return terms.reduce((n, term) =>
    n + (title.includes(term) ? 8 : 0)
      + (excerpt.includes(term) ? 4 : 0)
      + (body.includes(term) ? 1 : 0), 0);
}

async function queryRows(where: string, args: unknown[], terms: string[]) {
  const ftsTerms = terms.filter(term => Array.from(term).length >= 3 && !term.includes('"'));
  const result = new Map<number, Row>();
  const select = "SELECT p.id,p.public_id AS publicId,p.title,p.slug,p.excerpt," +
    "substr(p.content,1,24000) AS content,p.updated_at AS updatedAt ";
  if (ftsTerms.length) {
    const fts = await env.DB.prepare(select +
      "FROM posts_fts JOIN posts p ON p.id=posts_fts.rowid WHERE " + where +
      " AND posts_fts MATCH ? ORDER BY bm25(posts_fts) LIMIT 20")
      .bind(...args, ftsTerms.map(term => '"' + term + '"').join(" OR "))
      .all<Row>();
    for (const item of fts.results ?? []) result.set(item.id, item);
  }
  // Short Chinese words (e.g. 技术, 经验) cannot be matched by trigram FTS5.
  // Also search title/excerpt/body to cover mixed-language phrasing.
  const patterns = terms.map(term => "%" + term.replace(/[\\%_]/g, char => "\\" + char) + "%");
  const clauses = patterns.map(() =>
    "(p.title LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')"
  ).join(" OR ");
  const like = await env.DB.prepare(select + "FROM posts p WHERE " + where +
    " AND (" + clauses + ") ORDER BY p.updated_at DESC,p.id DESC LIMIT 40")
    .bind(...args, ...patterns.flatMap(pattern => [pattern,pattern,pattern])).all<Row>();
  for (const item of like.results ?? []) result.set(item.id,item);
  return [...result.values()].sort((a,b) => score(b,terms)-score(a,terms) ||
    b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
}

export async function findAskSources(
  question: string, scope: AskScope, identity: AskIdentity, origin: string,
): Promise<AskSource[]> {
  if ((scope === "mine" || scope === "all") && !identity) throw new Error("ASK_LOGIN_REQUIRED");
  const terms = askSearchTerms(question);
  if (!terms.length) return [];
  const rows: Array<{ row: Row; visibility: "public" | "personal" }> = [];

  if (scope !== "mine") {
    const publicRows = await queryRows(
      "p.workspace_id=1 AND p.space_id IS NULL AND p.status='published'", [], terms,
    );
    rows.push(...publicRows.map(row => ({row,visibility: "public" as const})));
  }
  if (scope !== "public" && identity) {
    const workspaceId = identity.userId === 1 ? 1
      : await ensurePersonalWorkspace(identity.userId);
    await workspaceGrant(identity.userId,workspaceId);
    const accessible = await accessibleSpaceIds(identity.userId,workspaceId);
    const constraints = ["p.workspace_id=?"];
    const args: unknown[] = [workspaceId];
    if (identity.userId === 1) {
      constraints.push("p.space_id IS NOT NULL");
    } else {
      constraints.push("(p.author_id=? OR p.created_by=? OR (p.author_id IS NULL AND p.created_by IS NULL))");
      args.push(identity.userId,identity.userId);
    }
    if (accessible !== null) {
      if (!accessible.length) return rows.slice(0, 5).map(({row,visibility},i) => toSource(row,visibility,i,origin,terms));
      constraints.push("p.space_id IN (" + accessible.map(() => "?").join(",") + ")");
      args.push(...accessible);
    }
    const privateRows = await queryRows(constraints.join(" AND "),args,terms);
    rows.push(...privateRows.map(row => ({row,visibility:"personal" as const})));
  }
  return rows.sort((a,b) => score(b.row,terms)-score(a.row,terms) ||
    b.row.updatedAt.localeCompare(a.row.updatedAt))
    .slice(0,5).map(({row,visibility},i) => toSource(row,visibility,i,origin,terms));
}

function toSource(row: Row, visibility: "public" | "personal", index: number, origin: string, terms: string[]): AskSource {
  return {
    id:index+1,title:row.title,excerpt:row.excerpt.slice(0,280),
    snippet:snippetFrom(row,terms),visibility,
    url:visibility==="public"
      ? origin + "/posts/" + encodeURIComponent(row.publicId) + "/" + encodeURIComponent(row.slug)
      : "/admin?section=articles&edit=" + row.id,
  };
}

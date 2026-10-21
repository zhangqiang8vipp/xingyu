/**
 * Search planning for the knowledge assistant. Kept independent of D1 so short
 * Chinese queries can be regression-tested without a Cloudflare runtime.
 */
const STOP_WORDS = new Set([
  "这个", "那个", "网站", "请问", "请", "问", "哪些", "什么",
  "主要", "分享", "关于", "相关", "一下", "告诉", "我们", "可以",
  "是否", "如何", "怎么", "就是", "内容", "文章", "里面", "都有",
  "the", "with", "from", "this", "that", "which", "what", "where",
  "are", "was", "were", "has", "have", "does", "for", "and", "about",
  "can", "please", "site", "website", "posts", "articles",
]);

/** Never feed user input to FTS syntax. These are plain, normalized keywords. */
export function askSearchTerms(question: string): string[] {
  const normalized = question.normalize("NFKC").trim().slice(0, 240);
  const tokens = Array.from(new Intl.Segmenter("zh", { granularity: "word" }).segment(normalized))
    .filter(part => part.isWordLike)
    .map(part => part.segment.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}#+._-]/gu, ""))
    .filter(part => part.length >= 2 && part.length <= 45 && !STOP_WORDS.has(part));

  // Proper nouns of two Chinese characters ("温莎", "星屿") must never be
  // discarded because a language segmenter split them into single characters.
  const exact = normalized.toLocaleLowerCase("en-US");
  if (/^\p{Script=Han}{2,8}$/u.test(exact) && !STOP_WORDS.has(exact))
    tokens.unshift(exact);

  return Array.from(new Set(tokens)).slice(0, 8);
}

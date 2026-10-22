import { askSearchTerms } from "./qa-terms";

/**
 * A real question about a named topic must be searched, not sampled from
 * unrelated article categories. This list is intentionally generic vocabulary,
 * not a hard-coded catalogue of technologies or proper nouns.
 */
const OVERVIEW_WORDS = new Set([
  "站点","本站","博客","知识","知识库","网站","全站","作者","我的","我们",
  "技术","经验","技术经验","实践","相关","主要","主要是","分享","发表",
  "内容","文章","主题","分类","方面","领域","方向","话题","概览","介绍",
  "写了","写的","写","包括","包含","覆盖","都","所有","东西","有什么",
  "类型","总体","整体","有哪些","有哪","是否","什么","哪些",
]);

/** Sample representative articles only for genuinely broad site-overview questions.
 * The presence of any concrete searchable term, such as Cloudflare, D1, 温莎
 * or 性能优化, forces actual relevance retrieval instead of category sampling.
 */
export function isKnowledgeOverviewQuestion(question: string) {
  const normalized = question.normalize("NFKC").trim().toLowerCase();
  if (!/(?:网站|本站|博客|站点|知识库).{0,22}(?:主要|哪些|什么|有哪|话题|方向|分类|涉及|分享|内容|主题|经验|写了)/u.test(normalized))
    return false;
  if (/(如何|怎么|为什么|配置|部署|修复|报错|教程|指南)/u.test(normalized))
    return false;
  return askSearchTerms(normalized).every(term=>OVERVIEW_WORDS.has(term));
}

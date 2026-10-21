/** Broad questions need a representative sample, not a literal match on generic words. */
export function isKnowledgeOverviewQuestion(question: string) {
  const normalized = question.normalize("NFKC").trim().toLowerCase();
  return /(?:网站|本站|博客|站点|知识库).{0,22}(?:主要|哪些|什么|有哪|话题|方向|分类|涉及|分享|内容|主题|经验|写了)/u.test(normalized)
    && !/(如何|怎么|为什么|配置|部署|修复|报错|教程|指南)/u.test(normalized);
}

import Link from "next/link";
import { getCategories, getSiteSettings, listArchivePosts } from "@/db/queries";
import type { PageSearchParams } from "../content-utils";
import { CONTENT_LIMITS, copyrightText } from "@/domain/site/config";
import StableLink from "../StableLink";
import ArchiveExplorer from "./ArchiveExplorer";
import SiteNavigation from "@/features/navigation/SiteNavigation";
import ArchiveNavCenter from "./ArchiveNavCenter";

export const dynamic = "force-dynamic";

export default async function ArchivePage({ searchParams }: { searchParams: PageSearchParams }) {
  const search = await searchParams;
  const category = typeof search.category === "string" ? search.category : "all";
  const query = typeof search.q === "string" ? search.q.trim() : "";
  const [categories, result, settings] = await Promise.all([
    getCategories(),
    listArchivePosts({ category, query, limit: CONTENT_LIMITS.archiveBatch }),
    getSiteSettings(),
  ]);
  const selectedCategory = categories.find((item) => item.slug === category);

  const href = (next: { category?: string }) => {
    const params = new URLSearchParams();
    const nextCategory = next.category ?? category;
    if (nextCategory !== "all") params.set("category", nextCategory);
    if (query) params.set("q", query);
    return `/archive${params.size ? `?${params}` : ""}`;
  };

  return <main className="archive-page">
    <SiteNavigation brandName={settings.brandName} current="archive"><ArchiveNavCenter categories={categories} category={category} query={query} /></SiteNavigation>
    <section className="archive-hero">
      <p>ALL WRITING</p><h1>文章</h1><span>把时间交还给文章。按分类浏览，或搜索{settings.brandName}的全部内容。</span>
      <form className="archive-search" action="/archive" method="get"><input name="q" defaultValue={query} placeholder="搜索标题、摘要与正文" aria-label="搜索全部文章" />{category !== "all" && <input type="hidden" name="category" value={category} />}<button>搜索</button></form>
    </section>
    <section className="archive-shell" id="archive-list">
      <div className="category-tabs archive-tabs" id="archive-filter-source">
        <StableLink className={category === "all" ? "active" : ""} href={href({ category: "all" })}>全部</StableLink>
        {selectedCategory && <StableLink className="active archive-selected-category" href={href({ category:selectedCategory.slug })}><i style={{background:selectedCategory.color}} />{selectedCategory.name}</StableLink>}
        <details className="archive-category-menu" data-dismiss-outside>
          <summary><span>分类</span><b>{categories.length}</b><i>⌄</i></summary>
          <div>
            <header><span>浏览分类</span><b>{categories.length} 个</b></header>
            <nav>{categories.map((item)=><StableLink key={item.id} className={category === item.slug ? "active" : ""} href={href({ category:item.slug })}><i style={{background:item.color}} /><span>{item.name}</span>{category === item.slug && <b>✓</b>}</StableLink>)}</nav>
          </div>
        </details>
      </div>
      {query && <div className="archive-query"><span>搜索</span><b>“{query}”</b><StableLink href={category === "all" ? "/archive" : `/archive?category=${category}`}>清除</StableLink></div>}
      <ArchiveExplorer key={`${category}:${query}`} initialRows={result.rows} initialNextCursor={result.nextCursor} category={category} query={query} />
    </section>
    <footer><b>{settings.brandName}。</b><span>{copyrightText(settings.brandName,settings.footerText)}</span><Link href="/">返回首页</Link></footer>
  </main>;
}

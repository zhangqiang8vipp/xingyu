import Link from "next/link";
import type { CSSProperties } from "react";
import { getCategories, getContentPage, getSiteSettings } from "@/db/queries";
import type { PageSearchParams } from "../content-utils";
import { copyrightText } from "@/domain/site/config";
import NavTitleChrome from "@/features/navigation/NavTitleChrome";
import IslandSearch from "@/features/navigation/IslandSearch";
import AdminPreviewBridge from "../AdminPreviewBridge";
import SiteNavigation from "@/features/navigation/SiteNavigation";
import MarkdownRenderer from "@/features/markdown/MarkdownRenderer";

export const dynamic = "force-dynamic";

export default async function AboutPage({searchParams}:{searchParams:PageSearchParams}) {
  const search=await searchParams;
  const [settings,page,categories]=await Promise.all([getSiteSettings(),getContentPage("about"),getCategories()]);
  if(!page)return null;
  const split=splitTitle(page.title);
  return <main className="about-page">
    <SiteNavigation brandName={settings.brandName} current="about"><NavTitleChrome targetId="about-hero-title" lead={split.lead} tail={split.tail} returnLabel="返回关于页顶部" /><IslandSearch initialText={page.title} /></SiteNavigation>

    <section className="about-hero-page">
      <div className="about-hero-copy"><p data-preview-field="eyebrow">{page.eyebrow}</p><h1 id="about-hero-title"><i data-preview-field="titleLead">{split.lead}</i><span data-preview-field="titleTail">{split.tail}</span></h1><div className="about-intro"><i /><p data-preview-field="excerpt">{page.excerpt}</p></div></div>
      <figure className="about-portrait-large"><img data-preview-src="avatarUrl" src={settings.avatarUrl} alt={`${settings.authorName}头像`} /><figcaption><span data-preview-field="authorIdentity">{settings.authorName} · {settings.brandLatin}</span><small data-preview-field="tagline">{settings.tagline}</small></figcaption><i>✦</i></figure>
    </section>

    <section className="about-belief about-page-content"><div><p>PERSONAL NOTES</p><h2 data-preview-field="title">{page.title}</h2></div><div className="belief-copy markdown-body" data-preview-markdown="content"><MarkdownRenderer>{page.content}</MarkdownRenderer></div></section>

    <section className="about-topics"><header><p>CURRENT THEMES</p><h2>浏览文章分类</h2><span>分类由写作后台维护，会随着新的关注方向继续生长。</span></header><div>{categories.map((category,index)=><article key={category.id} style={{"--topic-color":category.color} as CSSProperties}><div><span>{String(index+1).padStart(2,"0")}</span><i /></div><small>{category.slug.toUpperCase()}</small><h3>{category.name}</h3><p>阅读“{category.name}”分类下已经发布的全部文章与持续更新。</p><Link href={`/archive?category=${category.slug}`}>阅读这一类文章 <b>↗</b></Link></article>)}</div></section>

    <section className="about-next"><div><p>KEEP EXPLORING</p><h2>继续从文章认识<span data-preview-field="authorName">{settings.authorName}</span>。</h2></div><Link className="primary-button" href="/archive">阅读全部文章 <span>→</span></Link></section>
    <footer><b><span data-preview-field="brandName">{settings.brandName}</span>。</b><span data-preview-field="footerCopyright">{copyrightText(settings.brandName,settings.footerText)}</span><Link href="/">返回首页</Link></footer>
    {search.adminPreview === "about" && <AdminPreviewBridge kind="about" />}
  </main>;
}

function splitTitle(title:string){const separator=Math.max(title.indexOf("，"),title.indexOf(","));return separator>=0?{lead:title.slice(0,separator+1),tail:title.slice(separator+1)}:{lead:title,tail:""};}

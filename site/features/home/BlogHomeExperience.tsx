"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { avatarSource, estimateReadingMinutesFromLength, formatLongDate } from "@/app/content-utils";
import ModalPostLink from "../reader/ModalPostLink";
import StableLink from "@/app/StableLink";
import { copyrightText } from "@/domain/site/config";

export type BlogCategory={id:number;name:string;slug:string;color:string};
export type BlogHomePost={
  id:number;
  publicId:string;
  title:string;
  slug:string;
  excerpt:string;
  contentLength?:number;
  status?:"draft"|"published";
  viewCount:number;
  publishedAt:string|null;
  updatedAt?:string;
  categoryName:string|null;
  categorySlug?:string|null;
  categoryColor:string|null;
  spaceId?:number|null;
  spacePath?:string|null;
};
export type BlogHomeSettings={
  brandName:string;
  brandLatin:string;
  tagline:string;
  heroLead:string;
  heroTail:string;
  description:string;
  homeSectionTitle:string;
  homeAboutTitle:string;
  homeAboutCopy:string;
  avatarUrl:string;
  authorName:string;
  footerText:string;
};

export default function BlogHomeExperience({
  settings,
  categories,
  posts,
  selectedCategory="all",
  mode="public",
  visibility="all",
  onCategoryChange,
  onVisibilityChange,
  onEdit,
  onWrite,
  onOpenArticles,
  onOpenSpaces,
}:{
  settings:BlogHomeSettings;
  categories:BlogCategory[];
  posts:BlogHomePost[];
  selectedCategory?:string;
  mode?:"public"|"admin";
  visibility?:"all"|"public"|"private";
  onCategoryChange?:(category:string)=>void;
  onVisibilityChange?:(visibility:"all"|"public"|"private")=>void;
  onEdit?:(postId:number)=>void;
  onWrite?:()=>void;
  onOpenArticles?:()=>void;
  onOpenSpaces?:()=>void;
}){
  const admin=mode==="admin";
  const heroLength=Math.max(Array.from(settings.heroLead).length,Array.from(settings.heroTail).length);
  const heroDensity=heroLength>15?" dense":heroLength>10?" compact":"";
  const selected=categories.find((item)=>item.slug===selectedCategory);
  const adminReaderContext={range:visibility,category:selectedCategory,status:"all",source:"browse"} as const;
  const [featured,...rest]=posts;

  const categoryControl=(item:BlogCategory|null)=>{
    const slug=item?.slug??"all";
    const active=selectedCategory===slug;
    const content=<>{item&&<i style={{background:item.color}}/>}{item?.name??"全部"}</>;
    return admin
      ?<button key={slug} type="button" className={active?"active":""} onClick={()=>onCategoryChange?.(slug)}>{content}</button>
      :<StableLink key={slug} className={active?"active":""} href={slug==="all"?"/":`/?category=${slug}`}>{content}</StableLink>;
  };

  const card=(post:BlogHomePost,index:number,featuredCard=false)=><div className={`shared-post-card${featuredCard?" featured":""}${admin?" admin-card":""}`} key={post.id}>
    <ModalPostLink readerScope={admin?"admin":"public"} adminReaderContext={admin?adminReaderContext:undefined} className={`post-card${featuredCard?" featured":index%3===1?" dark":""}`} publicId={post.publicId} slug={post.slug} onEdit={onEdit}>
      <div className="card-copy">
        <span className="post-category" style={{"--post-category-color":post.categoryColor??"#0071e3"} as CSSProperties}>{admin?(post.spaceId?post.spacePath||"知识空间":post.status==="draft"?"公开草稿":post.categoryName):post.categoryName}</span>
        <h3>{post.title}</h3><p>{post.excerpt}</p>
        <div className="post-meta"><time>{formatLongDate(post.publishedAt,post.status==="draft"?"尚未发布":"未发布")}</time><span>·</span><span>{featuredCard&&post.contentLength?`${estimateReadingMinutesFromLength(post.contentLength)} 分钟阅读`:`${post.viewCount.toLocaleString("zh-CN")} 阅读`}</span></div>
      </div>
      {featuredCard?<div className="card-art warm"><span>01</span></div>:<span className="card-arrow">↗</span>}
    </ModalPostLink>
    {admin&&<div className="admin-card-actions"><span>{post.spaceId?"私有知识":post.status==="draft"?"草稿":"已发布"}</span><button type="button" onClick={()=>onEdit?.(post.id)}>编辑 ↗</button></div>}
  </div>;

  return <>
    <section className={`hero${admin?" admin-shared-hero":""}`}>
      <div className="hero-glow" aria-hidden="true"/>
      <div className="hero-inner">
        {admin&&<div className="admin-browser-kicker"><span>MANAGEMENT VIEW</span><b>浏览真实的 {settings.brandName}</b></div>}
        <p className="eyebrow" data-preview-field="tagline">{settings.tagline}</p>
        <h1 id={admin?"admin-home-hero-title":"home-hero-title"} className={`hero-pyramid-title${heroDensity}`}><span className="hero-title-line hero-title-lead" data-preview-field="heroLead">{settings.heroLead}</span><span className="hero-title-line hero-title-tail" data-preview-field="heroTail">{settings.heroTail}</span></h1>
        <p className="hero-copy" data-preview-field="description">{settings.description}</p>
        {admin?<div className="admin-browser-actions"><button type="button" onClick={onWrite}>＋ 写文章</button><button type="button" onClick={onOpenSpaces}>浏览知识空间</button></div>:<a className="primary-button" href="#articles">开始阅读 <span>↓</span></a>}
      </div>
    </section>

    <section className={`article-section${admin?" admin-shared-articles":""}`} id={admin?"admin-articles":"articles"}>
      <div className="section-heading">
        <div><p>{admin?"ALL WRITING":"SELECTED WRITING"}</p><h2 data-preview-field="homeSectionTitle">{admin?"全部内容":settings.homeSectionTitle}</h2></div>
        {admin?<div className="admin-visibility-switch" aria-label="内容范围">{(["all","public","private"] as const).map((value)=><button type="button" className={visibility===value?"active":""} key={value} onClick={()=>onVisibilityChange?.(value)}>{value==="all"?"全部":value==="public"?"公开博客":"知识空间"}</button>)}</div>:<form className="search" action="/archive" method="get">{selectedCategory!=="all"&&<input type="hidden" name="category" value={selectedCategory}/>}<input name="q" placeholder="搜索全部文章" aria-label="搜索全部文章"/><button type="submit">搜索</button></form>}
      </div>

      <div className="category-tabs home-category-tabs" aria-label="文章分类">
        {categoryControl(null)}
        {selected&&selectedCategory!=="all"&&categoryControl(selected)}
        <details className="archive-category-menu home-category-menu" data-dismiss-outside>
          <summary><span>分类</span><b>{categories.length}</b><i>⌄</i></summary>
          <div><header><span>浏览分类</span><b>{categories.length} 个</b></header><nav>{categories.map((item)=>categoryControl(item))}</nav></div>
        </details>
      </div>

      {!posts.length?<div className="empty-state"><b>没有找到文章</b><p>{admin?"当前范围还没有内容，可以切换分类或开始写作。":"换一个关键词或分类试试看。"}</p></div>:<div className="post-grid">{featured&&card(featured,0,true)}{rest.map((post,index)=>card(post,index,false))}</div>}
      {posts.length>0&&<div className="archive-cta"><span>{admin?"这里使用与公开博客完全相同的阅读体验":"首页只保留精选与最新文章"}</span>{admin?<button type="button" onClick={onOpenArticles}>管理全部文章 <b>→</b></button>:<Link href={selectedCategory==="all"?"/archive":`/archive?category=${selectedCategory}`}>浏览全部文章 <b>→</b></Link>}</div>}
    </section>

    {!admin&&<><section className="about-section" id="about"><div className="about-card"><div className="author-portrait"><img data-preview-src="avatarUrl" src={avatarSource(settings.avatarUrl,"portrait")} width="170" height="170" loading="lazy" decoding="async" alt={`${settings.authorName}头像`}/><span><b data-preview-field="authorName">{settings.authorName}</b> · <b data-preview-field="brandLatin">{settings.brandLatin}</b></span></div><div><p className="small-label">ABOUT <span data-preview-field="brandLatin">{settings.brandLatin}</span></p><h2 data-preview-field="homeAboutTitle">{settings.homeAboutTitle}</h2><p data-preview-field="homeAboutCopy">{settings.homeAboutCopy}</p><Link className="about-more" href="/about" prefetch={false}>更多关于<span data-preview-field="authorName">{settings.authorName}</span> <span>→</span></Link></div></div></section><footer><b><span data-preview-field="brandName">{settings.brandName}</span>。</b><span data-preview-field="footerCopyright">{copyrightText(settings.brandName,settings.footerText)}</span><span data-preview-field="tagline">{settings.tagline}</span></footer></>}
  </>;
}

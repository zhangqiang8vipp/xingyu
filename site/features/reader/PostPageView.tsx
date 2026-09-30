import Link from "next/link";
import type { CSSProperties } from "react";
import { getNextAdminPost, getNextPublishedPost, getPreviousAdminPost, getPreviousPublishedPost, getSiteSettings, type AdminReaderPost, type getPostByPublicId } from "@/db/queries";
import SiteNavigation from "../navigation/SiteNavigation";
import IslandSearch from "../navigation/IslandSearch";
import AdminPreviewBridge from "@/app/AdminPreviewBridge";
import ArticleEndMark from "./ArticleEndMark";
import ModalPostLink from "./ModalPostLink";
import { avatarSource, formatLongDate } from "@/app/content-utils";
import PostReadingChrome from "./PostReadingChrome";
import PostTableOfContents from "./PostTableOfContents";
import PostSideNavigation from "./PostSideNavigation";
import PostViewTracker from "./PostViewTracker";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { adminReaderReturnHref, normalizeAdminReaderContext, type AdminReaderContext } from "@/domain/reader/admin-reader-context";

type PublicPost = NonNullable<Awaited<ReturnType<typeof getPostByPublicId>>>;
type ReadablePost=PublicPost|AdminReaderPost;

export default async function PostPageView({ post, adminPreview = false, readerScope="public", previewToken, previewExpiresAt, adminReaderContext }: { post: ReadablePost; adminPreview?: boolean;readerScope?:"public"|"admin"|"preview";previewToken?:string;previewExpiresAt?:number;adminReaderContext?:AdminReaderContext }) {
  const admin=readerScope==="admin";
  const sharedPreview=readerScope==="preview";
  const readerContext=normalizeAdminReaderContext(adminReaderContext);
  const articleIndexHref=admin?adminReaderReturnHref(readerContext):"/archive";
  const [previousPost, nextPost, settings] = await Promise.all([
    post.id < 0||sharedPreview ? Promise.resolve(null) : admin?getPreviousAdminPost("updatedAt" in post?post.updatedAt:new Date(0).toISOString(),post.id,readerContext):getPreviousPublishedPost(post.publishedAt,post.id),
    post.id < 0||sharedPreview ? Promise.resolve(null) : admin?getNextAdminPost("updatedAt" in post?post.updatedAt:new Date(0).toISOString(),post.id,readerContext):getNextPublishedPost(post.publishedAt,post.id),
    getSiteSettings(),
  ]);
  return <main className="post-page">
    {!adminPreview&&!admin&&!sharedPreview&&<PostViewTracker publicId={post.publicId}/>}
    <SiteNavigation brandName={settings.brandName} current="archive"><PostReadingChrome title={post.title} category={post.categoryName} color={post.categoryColor}/>{!sharedPreview&&<IslandSearch scope={admin?"admin":"public"} initialText={post.title} excludeSlug={post.slug}/>}</SiteNavigation>
    {admin&&<nav className="admin-reader-return" aria-label="管理阅读操作"><Link href={articleIndexHref}>← 返回管理端</Link><Link href={`/admin?edit=${post.id}`}>编辑文章 ↗</Link></nav>}
    {sharedPreview&&<div className="shared-preview-notice"><i/><b>受邀预览</b><span>只读 · 仅当前文章</span>{previewExpiresAt&&<time>有效至 {new Date(previewExpiresAt*1000).toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</time>}</div>}
    <header className="post-hero">
      <span className="post-category" data-preview-field="categoryName" data-preview-color="categoryColor" style={{color:post.categoryColor??undefined}}>{sharedPreview?`受邀预览 · ${"spacePath" in post&&post.spacePath?post.spacePath:"status" in post&&post.status==="draft"?"草稿":post.categoryName}`:admin&&"spaceId" in post&&post.spaceId?(post.spacePath||"知识空间"):admin&&"status" in post&&post.status==="draft"?"公开草稿":post.categoryName}</span>
      <h1 data-preview-field="title">{post.title}</h1><p data-preview-field="excerpt">{post.excerpt}</p>
      <div className="post-byline"><img className="mini-avatar" data-preview-src="avatarUrl" src={avatarSource(settings.avatarUrl,"small")} width="28" height="28" decoding="async" alt={settings.authorName} /><b data-preview-field="authorName">{settings.authorName}</b><i />
        <time data-preview-field="publishedLabel">{formatLongDate(post.publishedAt)}</time><i /><span>{post.viewCount.toLocaleString("zh-CN")} 阅读</span>
      </div>
    </header>
    {!sharedPreview&&<PostSideNavigation previousPost={previousPost} nextPost={nextPost} readerScope={admin?"admin":"public"} adminReaderContext={readerContext}/>}
    <div className="post-reading-layout">
      <article className="prose markdown-body" data-preview-markdown="content"><MarkdownRenderer previewToken={previewToken}>{post.content}</MarkdownRenderer><ArticleEndMark /></article>
      <PostTableOfContents key={post.publicId} articleKey={post.publicId} />
    </div>
    {sharedPreview?<section className="post-end shared-preview-end"><div className="post-end-heading"><small>PRIVATE PREVIEW</small><h2>本次预览到这里。</h2><span>此链接只开放当前文章，不会进入其他私密内容。</span></div></section>:<section className="post-end">
      <div className="post-end-heading"><small>KEEP READING</small><h2>继续阅读</h2><span>在相邻的文字之间，继续往前。</span></div>
      <div className="post-neighbors">
        {previousPost ? <ModalPostLink readerScope={readerScope} adminReaderContext={readerContext} className="post-neighbor previous" publicId={previousPost.publicId} slug={previousPost.slug} style={{ "--neighbor-color":previousPost.categoryColor ?? "#0071e3" } as CSSProperties}>
          <div className="neighbor-direction"><i>←</i><span>上一篇</span></div><small><i />{previousPost.categoryName}</small><h3>{previousPost.title}</h3><p>{previousPost.excerpt}</p><footer><time>{formatLongDate(previousPost.publishedAt)}</time><b>阅读文章 ↗</b></footer>
        </ModalPostLink> : <div className="post-neighbor unavailable"><div className="neighbor-direction"><i>←</i><span>上一篇</span></div><h3>这里是最新一篇</h3><p>暂时没有更新的文章了。</p><footer><Link href={articleIndexHref}>{admin?"返回管理端":"查看全部文章"}</Link></footer></div>}
        {nextPost ? <ModalPostLink readerScope={readerScope} adminReaderContext={readerContext} className="post-neighbor next" publicId={nextPost.publicId} slug={nextPost.slug} style={{ "--neighbor-color":nextPost.categoryColor ?? "#0071e3" } as CSSProperties}>
          <div className="neighbor-direction"><span>下一篇</span><i>→</i></div><small><i />{nextPost.categoryName}</small><h3>{nextPost.title}</h3><p>{nextPost.excerpt}</p><footer><time>{formatLongDate(nextPost.publishedAt)}</time><b>阅读文章 ↗</b></footer>
        </ModalPostLink> : <div className="post-neighbor unavailable next"><div className="neighbor-direction"><span>下一篇</span><i>→</i></div><h3>已经读到时间起点</h3><p>可以回到文章页，从其他分类继续探索。</p><footer><Link href={articleIndexHref}>{admin?"返回管理端":"查看全部文章"}</Link></footer></div>}
      </div>
    </section>}
    {adminPreview && <AdminPreviewBridge kind="article" />}
  </main>;
}

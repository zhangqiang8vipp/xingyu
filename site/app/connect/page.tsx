import Link from "next/link";
import { getContentPage, getSiteSettings } from "@/db/queries";
import type { PageSearchParams } from "../content-utils";
import { copyrightText } from "@/domain/site/config";
import NavTitleChrome from "@/features/navigation/NavTitleChrome";
import IslandSearch from "@/features/navigation/IslandSearch";
import AdminPreviewBridge from "../AdminPreviewBridge";
import SiteNavigation from "@/features/navigation/SiteNavigation";
import MarkdownRenderer from "@/features/markdown/MarkdownRenderer";

export const dynamic = "force-dynamic";

export default async function ConnectPage({ searchParams }: { searchParams: PageSearchParams }) {
  const search = await searchParams;
  const [settings, page] = await Promise.all([getSiteSettings(), getContentPage("connect")]);
  if (!page) return null;
  const split = splitTitle(page.title);

  return <main className="about-page connect-page">
    <SiteNavigation brandName={settings.brandName} current="connect">
      <NavTitleChrome targetId="connect-hero-title" lead={split.lead} tail={split.tail} returnLabel="返回接入页顶部" />
      <IslandSearch initialText={page.title} />
    </SiteNavigation>

    <section className="about-hero-page connect-hero-page">
      <div className="about-hero-copy">
        <p data-preview-field="eyebrow">{page.eyebrow}</p>
        <h1 id="connect-hero-title"><i data-preview-field="titleLead">{split.lead}</i><span data-preview-field="titleTail">{split.tail}</span></h1>
        <div className="about-intro"><i /><p data-preview-field="excerpt">{page.excerpt}</p></div>
      </div>
      <aside className="connect-endpoint-card">
        <header><span><i /> ONLINE</span><small>STREAMABLE HTTP</small></header>
        <div><small>REMOTE MCP ENDPOINT</small><code>zhangwansen.click/mcp</code></div>
        <ol><li><b>01</b><span>安全令牌留在本机</span></li><li><b>02</b><span>读取默认开放</span></li><li><b>03</b><span>写入与发布分级确认</span></li></ol>
      </aside>
    </section>

    <section className="about-belief connect-guide">
      <div><p>CODEX SETUP</p><h2>一条连接，保留完整的控制权。</h2><span>页面正文由星屿内容库维护，也可以通过 MCP 安全更新。</span></div>
      <div className="belief-copy markdown-body" data-preview-markdown="content"><MarkdownRenderer>{page.content}</MarkdownRenderer></div>
    </section>

    <section className="connect-permissions">
      <header><p>PERMISSION MODEL</p><h2>读取、写入、公开，三层边界。</h2></header>
      <div>
        <article><span>01</span><i className="read" /><h3>读取</h3><p>分类、搜索、文章和页面读取可以直接完成，不改变线上内容。</p><small>AUTO APPROVE</small></article>
        <article><span>02</span><i className="write" /><h3>写入</h3><p>创建草稿、修改文章或页面时，先展示变更摘要，再等待确认。</p><small>CONFIRM WRITE</small></article>
        <article><span>03</span><i className="publish" /><h3>公开</h3><p>发布、撤回和公开部署独立授权，不从普通编辑操作中顺带执行。</p><small>IMPORTANT ACTION</small></article>
      </div>
    </section>

    <section className="about-next"><div><p>START WRITING</p><h2>让 AI 写得更快，<br />让决定仍然属于你。</h2></div><Link className="primary-button" href="/archive">浏览现有文章 <span>→</span></Link></section>
    <footer><b><span data-preview-field="brandName">{settings.brandName}</span>。</b><span data-preview-field="footerCopyright">{copyrightText(settings.brandName, settings.footerText)}</span><Link href="/">返回首页</Link></footer>
    {search.adminPreview === "connect" && <AdminPreviewBridge kind="connect" />}
  </main>;
}

function splitTitle(title: string) {
  const separator = Math.max(title.indexOf("，"), title.indexOf(","));
  return separator >= 0 ? { lead: title.slice(0, separator + 1), tail: title.slice(separator + 1) } : { lead: title, tail: "" };
}

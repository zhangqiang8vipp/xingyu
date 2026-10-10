import Link from "next/link";
import { getContentPage, getSiteSettings } from "@/db/queries";
import { copyrightText } from "@/domain/site/config";
import type { PageSearchParams } from "../content-utils";
import SiteNavigation from "@/features/navigation/SiteNavigation";
import NavTitleChrome from "@/features/navigation/NavTitleChrome";
import IslandSearch from "@/features/navigation/IslandSearch";
import MarkdownRenderer from "@/features/markdown/MarkdownRenderer";
import AdminPreviewBridge from "../AdminPreviewBridge";
import "./connect-marketing.css";

export const dynamic = "force-dynamic";

const endpoint = "https://zhangwansen.click/mcp";

export default async function ConnectPage({ searchParams }: { searchParams: PageSearchParams }) {
  const search = await searchParams;
  const [settings, page] = await Promise.all([getSiteSettings(), getContentPage("connect")]);
  if (!page) return null;

  // Until existing public copy is edited in content_pages, avoid rendering the
  // historical single-Token/Codex-only hero over the new dual-auth experience.
  // Custom titles and excerpts in the content library remain fully editable.
  const legacyTitle = ["让 AI Agent，直接写进星屿。", "让 Codex，直接写进星屿。"].includes(page.title);
  const title = legacyTitle ? "把星屿，连接到你的 AI。" : page.title;
  const split = splitTitle(title);
  const legacyExcerpt = page.excerpt.startsWith("通过一条受控的");
  const excerpt = legacyExcerpt
    ? "无论你的 AI 客户端支持 OAuth，还是需要手动填写 Token，都可以连接属于自己的星屿工作区。权限由你决定，连接由你管理。"
    : page.excerpt;
  const legacyGuide = /保存本机鉴权令牌|在 Codex 中连接星屿|Antigravity|XINGYU_BLOG_MCP_TOKEN/.test(page.content);
  const renderGuide = !legacyGuide && Boolean(page.content.trim());

  return <main className="about-page connect-page xy-marketing-page">
    <SiteNavigation brandName={settings.brandName} current="connect">
      <NavTitleChrome targetId="connect-hero-title" lead={split.lead} tail={split.tail} returnLabel="返回接入页顶部" />
      <IslandSearch initialText={title} />
    </SiteNavigation>

    <section className="xy-market-hero">
      <div className="xy-market-hero-copy">
        <p className="xy-market-eyebrow" data-preview-field="eyebrow">XINGYU / MCP CONNECT</p>
        <h1 id="connect-hero-title">
          <span data-preview-field="titleLead">{split.lead}</span>
          <span data-preview-field="titleTail">{split.tail}</span>
        </h1>
        <p className="xy-market-lede" data-preview-field="excerpt">{excerpt}</p>
        <div className="xy-market-hero-actions">
          <a className="xy-market-button" href="#connection-methods">了解接入方式 <span>↗</span></a>
          <span>同一个 MCP 服务 · 两种授权方式</span>
        </div>
      </div>
      <aside className="xy-market-endpoint" aria-label="星屿 MCP 服务说明">
        <div className="xy-market-endpoint-top"><strong><i /> REMOTE MCP</strong><span>STREAMABLE HTTP</span></div>
        <div className="xy-market-endpoint-center">
          <small>YOUR MCP ENDPOINT</small>
          <code>{endpoint}</code>
        </div>
        <div className="xy-market-flow"><span>AI 客户端</span><b>→</b><span>OAuth / PAT</span><b>→</b><span>我的空间</span></div>
        <p>账号级授权 · 工作区隔离 · 每个凭据均可管理</p>
      </aside>
    </section>

    <section id="connection-methods" className="xy-market-section">
      <div className="xy-market-section-head">
        <div><p>01 / PICK YOUR METHOD</p><h2>选一种适合你的接入方式。</h2></div>
        <span>不必二选一。你可以在不同客户端分别使用 OAuth 和个人 Token。</span>
      </div>
      <div className="xy-market-method-grid">
        <article className="xy-market-method">
          <div className="xy-market-method-icon">⚿</div>
          <div><h3>个人访问令牌 <small>适合手动配置</small></h3><p>登录后为每个客户端创建专属 Token，自定义读取、写作、发布权限及有效期，也支持永久有效。</p></div>
        </article>
        <article className="xy-market-method">
          <div className="xy-market-method-icon">◎</div>
          <div><h3>OAuth 自动授权</h3><p>由支持 OAuth 的客户端打开星屿账号授权页，确认权限后直接连接，无须手动复制 Token。</p></div>
        </article>
      </div>

      <div className="xy-market-guide-grid">
        <article className="xy-market-guide-card">
          <header><small>PERSONAL ACCESS TOKEN</small><h3>为每个 AI，准备一把独立的钥匙。</h3><p>创建、续用和撤销，都属于登录后的「AI 连接」管理功能。</p></header>
          <div className="xy-market-faux-token">
            <div className="xy-market-faux-token-icon">⚿</div>
            <div><strong>个人 Token 示例</strong><code>xy_pat_••••••••8f42</code><p>读取 · 草稿 <span>·</span> 永久有效</p></div>
            <small>示意</small>
          </div>
          <ol className="xy-market-steps">
            <li><b>01</b><span>登录星屿，进入「AI 连接」创建个人 Token。</span></li>
            <li><b>02</b><span>选择权限及有效期，创建时保存一次性展示的完整密钥。</span></li>
            <li><b>03</b><span>在需要手动配置的 AI 客户端填入 MCP 地址及 Bearer Token。</span></li>
          </ol>
          <div className="xy-market-code">
            <small>HTTP HEADER · 示例</small>
            <code>Authorization: Bearer &lt;YOUR_PERSONAL_TOKEN&gt;</code>
          </div>
          <Link href="/ai-connections" className="xy-market-link">前往 AI 连接管理 <span>↗</span></Link>
        </article>
        <article className="xy-market-guide-card">
          <header><small>OAUTH 2.0 · PKCE</small><h3>能自动授权，就不需要手动密钥。</h3><p>OAuth 和 PAT 共享同一套用户身份、权限与工作区隔离逻辑。</p></header>
          <div className="xy-market-consent">
            <div className="xy-market-consent-heading"><span>✳</span><div><strong>星屿授权</strong><small>账号授权流程示意</small></div></div>
            <div><span className="xy-market-check">✓</span><strong>读取有权限的文章与空间</strong></div>
            <div><span className="xy-market-check">✓</span><strong>创建与修改草稿</strong></div>
            <div><span className="xy-market-uncheck">○</span><strong>发布与撤回由你决定</strong></div>
          </div>
          <ol className="xy-market-steps">
            <li><b>01</b><span>在支持 OAuth 的 AI 客户端添加星屿远程 MCP 地址。</span></li>
            <li><b>02</b><span>跳转至星屿，登录自己的账号并确认请求的权限。</span></li>
            <li><b>03</b><span>连接后使用工作区工具，随时在「AI 连接」撤销授权。</span></li>
          </ol>
          <p className="xy-market-guide-note">是否能自动打开授权页，取决于客户端的 MCP OAuth 支持及回调配置。</p>
          <Link href="/ai-connections" className="xy-market-link">查看我的 AI 连接 <span>↗</span></Link>
        </article>
      </div>

      <div className="xy-market-client-strip">
        <span>常见客户端</span><strong>ChatGPT</strong><strong>Grok</strong><strong>Cursor</strong><strong>Claude Desktop</strong><strong>自定义 Agent</strong>
        <small>实际接入方式以客户端当前能力为准</small>
      </div>
    </section>

    <section className="xy-market-section xy-market-permissions">
      <div className="xy-market-section-head">
        <div><p>02 / PERMISSION MODEL</p><h2>两种接入，相同的权限边界。</h2></div>
        <span>获得 Token 不等于获得全部管理权。每次操作都受账号、Scope 与实时工作区 ACL 约束。</span>
      </div>
      <div className="xy-market-permission-grid">
        <article><span>⌕</span><h3>读取 · READ</h3><p>读取有权限的文章、知识空间与附件，不会改变内容。</p><small>XINGYU.READ</small></article>
        <article><span>✎</span><h3>写作 · DRAFT</h3><p>创建和修改草稿，保留版本与变更记录，不自动公开。</p><small>XINGYU.DRAFT</small></article>
        <article><span>↗</span><h3>发布 · PUBLISH</h3><p>发布与撤回属于独立敏感权限，需明确授予并确认。</p><small>XINGYU.PUBLISH</small></article>
      </div>
    </section>

    <section className="xy-market-section xy-market-faq">
      <div className="xy-market-section-head">
        <div><p>03 / HELP</p><h2>常见问题</h2></div>
        <span>这里介绍接入方法。真实密钥和授权记录只在登录后的「AI 连接」管理。</span>
      </div>
      <div className="xy-market-faq-list">
        <details><summary>OAuth 和个人 Token 可以同时使用吗？</summary><p>可以。同一账号可以同时授权多个 OAuth 客户端，也能为不同设备生成多条个人 Token。它们最终进入同一个 MCP 服务。</p></details>
        <details><summary>个人 Token 能设置永久有效吗？</summary><p>可以。永久表示没有预设到期时间，但仍可以单独撤销；账号停用或权限被收回时，该 Token 也无法继续访问受保护资源。</p></details>
        <details><summary>为什么不用以前的全站共享 Token？</summary><p>共享密钥无法正确隔离多个用户。现在每个 Token 归真实账号所有，只保存哈希，并且独立设置权限与撤销。</p></details>
        <details><summary>为什么客户端不能直接使用 OAuth？</summary><p>不同客户端支持的 MCP 传输与 OAuth 配置能力并不一样。对于不支持自动授权的客户端，使用个人 PAT 手动接入。</p></details>
        <details><summary>我有工作区权限，Token 就能随意访问吗？</summary><p>不能。只有账号、Token Scope、工作区角色以及空间 ACL 同时允许，才能读取或修改对应内容。</p></details>
      </div>
    </section>

    {(renderGuide || search.adminPreview === "connect") && <details className="xy-market-extra">
      <summary>更多技术说明与使用建议</summary>
      <div className="markdown-body" data-preview-markdown="content">
        {renderGuide ? <MarkdownRenderer>{page.content}</MarkdownRenderer> : <p>详细接入说明正在整理。请先参照上方流程，登录后到「AI 连接」管理凭据。</p>}
      </div>
    </details>}

    <section className="xy-market-bottom">
      <div><small>START CONNECTING</small><h2>让 AI 帮你记录，<br />让决定始终属于你。</h2><p>你的账号、你的空间、你的连接。</p></div>
      <Link href="/ai-connections" className="xy-market-button">进入 AI 连接 <span>↗</span></Link>
    </section>
    <footer className="xy-market-footer">
      <b><span data-preview-field="brandName">{settings.brandName}</span>。</b>
      <span data-preview-field="footerCopyright">{copyrightText(settings.brandName, settings.footerText)}</span>
      <Link href="/">返回首页</Link>
    </footer>
    {search.adminPreview === "connect" && <AdminPreviewBridge kind="connect" />}
  </main>;
}

function splitTitle(value: string) {
  const index = value.indexOf("，") >= 0 ? value.indexOf("，") : value.indexOf(",");
  return index < 0
    ? { lead: value, tail: "" }
    : { lead: value.slice(0, index + 1), tail: value.slice(index + 1) };
}

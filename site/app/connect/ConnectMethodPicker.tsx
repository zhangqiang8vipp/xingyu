"use client";

import Link from "next/link";
import { useState } from "react";

type Method = "pat" | "oauth";

export default function ConnectMethodPicker() {
  const [method, setMethod] = useState<Method>("pat");

  function choose(next: Method) {
    setMethod(next);
    const target = document.getElementById(next === "pat" ? "pat-guide" : "oauth-guide");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }

  return <>
    <div className="xy-market-method-grid" role="group" aria-label="接入方式">
      <button type="button" className={method === "pat" ? "xy-market-method is-selected" : "xy-market-method"}
        aria-pressed={method === "pat"} aria-controls="pat-guide" onClick={() => choose("pat")}>
        <div className="xy-market-method-icon">⚿</div>
        <div>
          <span className="xy-market-method-title">个人访问令牌 <small>适合手动配置</small></span>
          <p>登录后为每个客户端创建专属 Token，自定义读取、写作、发布权限及有效期，也支持永久有效。</p>
        </div>
      </button>
      <button type="button" className={method === "oauth" ? "xy-market-method is-selected" : "xy-market-method"}
        aria-pressed={method === "oauth"} aria-controls="oauth-guide" onClick={() => choose("oauth")}>
        <div className="xy-market-method-icon">◎</div>
        <div>
          <span className="xy-market-method-title">OAuth 自动授权</span>
          <p>由支持 OAuth 的客户端打开星屿账号授权页，确认权限后直接连接，无须手动复制 Token。</p>
        </div>
      </button>
    </div>

    <div className="xy-market-guide-grid">
      <article id="pat-guide" className={method === "pat" ? "xy-market-guide-card is-current" : "xy-market-guide-card"}>
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
      <article id="oauth-guide" className={method === "oauth" ? "xy-market-guide-card is-current" : "xy-market-guide-card"}>
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
  </>;
}

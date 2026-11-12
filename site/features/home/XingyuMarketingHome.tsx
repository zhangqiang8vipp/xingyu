"use client";

import Link from "next/link";
import { useState } from "react";
import AxisMark from "@/features/navigation/AxisMark";
import type { BlogHomePost } from "./BlogHomeExperience";
import "./xingyu-marketing.css";

type Scene = "write" | "review" | "agent";
const tabs: ReadonlyArray<{ value: Scene; name: string }> = [
  { value: "write", name: "记录" },
  { value: "review", name: "共创" },
  { value: "agent", name: "MCP" },
];
const scenes: Record<Scene, {
  first: string; second: string; last: string; note: string; version: string;
  title: string; summary: string;
  steps: ReadonlyArray<{ title: string; description: string; code?: string }>;
}> = {
  write: {
    first: "发布前确认当前 Worker 版本、环境绑定与 D1 迁移状态。",
    second: "记录操作原因、变更范围和验证结果，帮助下一位同事理解背景。",
    last: "知识从一次真实工作开始，而不是从一棵空白的文件夹树开始。",
    note: "草稿可以持续完善，确认后再对适当的人开放。",
    version: "V1 · 初始记录",
    title: "一次记录的开始",
    summary: "从个人记录出发，逐渐形成团队可以使用的知识。",
    steps: [
      { title: "创建知识草稿", description: "记录操作步骤、背景与风险，不必先设计复杂目录。" },
      { title: "保留来源与版本", description: "重要修改能回到它产生时的上下文。" },
    ],
  },
  review: {
    first: "发布前核查 Worker 版本、环境绑定、D1 迁移状态与回滚路径。",
    second: "评审人补充生产环境的故障恢复检查，建议保留执行证据。",
    last: "知识吸收更多人的实际经验，而非停留在一个人的笔记里。",
    note: "修订保留历史；并发冲突需要明确审阅和合并。",
    version: "V2 · 团队修订",
    title: "共同完善，而非覆盖",
    summary: "让知识的变化有来源、有过程，也有责任边界。",
    steps: [
      { title: "成员提出补充", description: "增加生产回滚的验证步骤和排查经验。" },
      { title: "保留原始版本", description: "记录修订和冲突提案，由有权限的成员确认。" },
    ],
  },
  agent: {
    first: "Agent 检查 Worker 版本、迁移记录以及回滚与验证步骤。",
    second: "结合已有规范识别缺失的检查项，并提交修订建议。",
    last: "人和 AI 使用同一份知识，而不是维护两套内容。",
    note: "Agent 的修改建议仍遵循知识空间权限和版本控制。",
    version: "V3 · AI 修订提案",
    title: "AI 能参与，但不越权",
    summary: "连接外部 Agent，不强迫每个人都在网页里聊天。",
    steps: [
      { title: "MCP · 读取授权内容", description: "Agent 只接收当前身份能够访问的文档。", code: 'get_document({ id: "..." })' },
      { title: "MCP · 提出修订", description: "提交建议与版本信息；发生冲突进入人工审阅。", code: "propose_revision({ version: 2 })" },
    ],
  },
};

function KnowledgeDemo() {
  const [scene, setScene] = useState<Scene>("write");
  const data = scenes[scene];
  return <section className="xy-mkt-wrap" id="experience" aria-label="XINGYU 知识协作交互演示">
    <div className="xy-mkt-device"><div className="xy-mkt-device-inner">
      <header className="xy-mkt-device-top">
        <div className="xy-mkt-device-brand">
          <span className="xy-mkt-brand-mark"><AxisMark /></span>
          <span>XINGYU</span><span className="xy-mkt-device-path">/ Engineering / Knowledge</span>
        </div>
        <div className="xy-mkt-device-presence" aria-label="协作者示意">
          <span className="xy-mkt-presence-dot">知</span><span className="xy-mkt-presence-dot">同</span><span className="xy-mkt-presence-dot">AI</span>
        </div>
      </header>
      <div className="xy-mkt-device-body">
        <article className="xy-mkt-document">
          <div className="xy-mkt-bread"><span>Engineering</span><span>/</span><b>基础设施与发布</b></div>
          <h2>生产部署与回滚规范</h2>
          <p className="xy-mkt-doc-sub">可记录 · 可共同修订 · 可通过 MCP 在授权范围内使用</p>
          <div className="xy-mkt-doc-rule" />
          <h3>01 / 发布前核对</h3>
          <p className="xy-mkt-doc-copy"><span className="xy-mkt-highlight">{data.first}</span></p>
          <h3>02 / 变更与验证</h3>
          <p className="xy-mkt-doc-copy">{data.second}</p>
          <p className="xy-mkt-doc-copy">{data.last}</p>
          <div className="xy-mkt-note">{data.note}</div>
          <div className="xy-mkt-doc-meta"><span className="xy-mkt-doc-status">● 版本已记录</span><span>{data.version}</span><span>知识空间权限生效</span></div>
        </article>
        <aside className="xy-mkt-context">
          <span className="xy-mkt-context-kicker">ONE KNOWLEDGE · MANY CONTRIBUTORS</span>
          <h3>{data.title}</h3><p className="xy-mkt-context-intro">{data.summary}</p>
          <div className="xy-mkt-mode-tabs" role="group" aria-label="切换知识协作示例">
            {tabs.map(item=><button key={item.value} type="button" aria-pressed={scene===item.value} onClick={()=>setScene(item.value)}>{item.name}</button>)}
          </div>
          <div className="xy-mkt-flow" aria-live="polite">
            {data.steps.map((step,index)=><div className="xy-mkt-flow-item" key={scene+"-"+index}>
              <strong>{step.title}</strong><p>{step.description}</p>
              {step.code?<div className="xy-mkt-flow-code">{step.code}</div>:null}
            </div>)}
          </div>
          <p className="xy-mkt-demo-foot">根据 XINGYU 现有协作、版本和 MCP 能力制作的交互示例，并非实时生产数据。</p>
        </aside>
      </div>
    </div></div>
    <p className="xy-mkt-device-caption">INTERACTIVE PRODUCT SCENARIO · 点击「记录 / 共创 / MCP」切换</p>
  </section>;
}

export default function XingyuMarketingHome({brandName,posts}:{brandName:string;posts:BlogHomePost[]}) {
  const published=posts.filter(post=>post.status!=="draft").slice(0,3);
  return <div className="xy-mkt">
    <section className="xy-mkt-hero xy-mkt-wrap" aria-labelledby="home-hero-title">
      <p className="xy-mkt-kicker"><i aria-hidden="true"/> XINGYU / OPEN KNOWLEDGE</p>
      <h1 id="home-hero-title"><span>知识，不止被保存。</span><span>更应该被共同创造。</span></h1>
      <p className="xy-mkt-intro">从个人记录到组织共创，从公开传播到 AI Agent 通过 MCP 协作。让知识有版本、有权限、有来处，也能在每一次使用中继续完善。</p>
      <div className="xy-mkt-actions">
        <Link className="xy-mkt-primary" href="/register">开始使用 <span aria-hidden="true">↗</span></Link>
        <a className="xy-mkt-text-link" href="#experience">看看它如何工作 <span aria-hidden="true">↓</span></a>
      </div>
    </section>
    <KnowledgeDemo/>
    <section className="xy-mkt-section xy-mkt-wrap" aria-labelledby="xy-mkt-principles">
      <div className="xy-mkt-section-tag">BUILT FOR KNOWLEDGE IN MOTION</div>
      <h2 id="xy-mkt-principles" className="xy-mkt-section-title">不只是写下一份文档。<br/>让知识拥有下一步。</h2>
      <p className="xy-mkt-section-desc">XINGYU 的基础是一套不断被使用的知识体系。无论是一人记录、团队讨论，还是 Agent 协作，变化都发生在同一份可追溯的内容中。</p>
      <div className="xy-mkt-steps">
        <div className="xy-mkt-step"><span className="xy-mkt-step-number">01 / CAPTURE</span><h3>从任何一个想法开始</h3><p>保存资料、记录方法和经验。个人、团队与公开内容由原有权限体系清晰区分。</p></div>
        <div className="xy-mkt-step"><span className="xy-mkt-step-number">02 / COLLABORATE</span><h3>让理解不断接近真实</h3><p>邀请成员一起完善内容。修订、历史版本与冲突处理，让协作有迹可循。</p></div>
        <div className="xy-mkt-step"><span className="xy-mkt-step-number">03 / CONNECT</span><h3>让 AI 使用同一份知识</h3><p>通过 MCP 将经授权的知识交给外部 Agent，查询、使用与提出建议，而不是复制粘贴另一套文档。</p></div>
      </div>
    </section>
    <section className="xy-mkt-public xy-mkt-wrap" aria-labelledby="xy-mkt-public-title">
      <div className="xy-mkt-section-head">
        <div><div className="xy-mkt-section-tag">OPEN KNOWLEDGE</div><h2 id="xy-mkt-public-title" className="xy-mkt-section-title">已经公开的知识。</h2></div>
        <Link className="xy-mkt-text-link" href="/archive">探索全部公开内容 <span aria-hidden="true">↗</span></Link>
      </div>
      <div className="xy-mkt-public-posts">
        {published.length?published.map(post=><Link key={post.publicId} className="xy-mkt-post" href={"/posts/"+encodeURIComponent(post.publicId)+"/"+encodeURIComponent(post.slug)}>
          <span className="xy-mkt-post-type">{post.categoryName||"公开知识"}</span>
          <span className="xy-mkt-post-main"><b>{post.title}</b><small>{post.excerpt||"打开阅读完整内容"}</small></span>
          <span className="xy-mkt-post-arrow" aria-hidden="true">↗</span>
        </Link>):<p className="xy-mkt-empty">公开知识正在建设中。你也可以从自己的第一份记录开始。</p>}
      </div>
    </section>
    <section className="xy-mkt-finish"><div className="xy-mkt-wrap">
      <div className="xy-mkt-section-tag">START WITH KNOWLEDGE</div>
      <h2>知识的下一步，<br/>由我们一起决定。</h2>
      <p>为个人、组织与智能体而建。今天从一份知识开始，未来不设边界。</p>
      <Link className="xy-mkt-primary" href="/register">进入 {brandName} <span aria-hidden="true">↗</span></Link>
      <footer className="xy-mkt-footer">
        <span>© {new Date().getFullYear()} {brandName} · XINGYU</span>
        <div><Link href="/about">关于</Link><span>　·　</span><Link href="/connect">连接</Link><span>　·　</span><Link href="/archive">公开知识</Link></div>
      </footer>
    </div></section>
  </div>;
}

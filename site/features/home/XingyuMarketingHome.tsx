"use client";

import Link from "next/link";
import { useId, useState } from "react";
import AxisMark from "@/features/navigation/AxisMark";
import type { BlogHomePost } from "./BlogHomeExperience";
import "./xingyu-marketing.css";

type ExperienceMode = "reading" | "questions" | "exam" | "ai";
type AiAction = "summarize" | "review" | "practice";

const experiences: ReadonlyArray<{
  id: ExperienceMode; number: string; name: string; english: string;
  heading: string; description: string; footnote: string;
}> = [
  {
    id: "reading", number: "01", name: "阅读", english: "READ",
    heading: "认真阅读。自然延伸。",
    description: "沉浸理解一份知识，遇到疑问就继续追问。不需要在几个不同的系统之间来回切换。",
    footnote: "真实产品已支持文章阅读、阅读进度与多种阅读偏好。",
  },
  {
    id: "questions", number: "02", name: "问题", english: "QUESTION",
    heading: "好的知识，容得下问题。",
    description: "围绕知识提出疑问、讨论不同理解，也让答案继续被修订。一个问题可以带你回到原始内容。",
    footnote: "此处是可操作的问答交互示例；实际知识问答请进入问答页面。",
  },
  {
    id: "exam", number: "03", name: "考试", english: "EXAM",
    heading: "学过了，也应该能验证。",
    description: "从具体知识出发，回答问题、获得解析、发现理解上的空白。题库与考试可以随着知识一起成长。",
    footnote: "这里是模拟考试流程，不记录成绩；完整考试与题库管理仍需独立建设。",
  },
  {
    id: "ai", number: "04", name: "AI", english: "INTELLIGENCE",
    heading: "让 AI 真正理解知识。",
    description: "辅助总结、检查风险、引导练习。通过既有的权限和 MCP 连接外部 Agent，而不是再造一份知识。",
    footnote: "下方 AI 输出为交互示例，不会向模型发起请求；真实问答入口仍可使用。",
  },
];

const qna = [
  {
    question: "为什么数据库迁移前要先验证回滚路径？",
    answer: "因为迁移失败的风险不仅在于执行过程中报错，也在于新版本发布后才发现数据或应用不兼容。提前验证回滚路径，可以明确哪些变更可逆、哪些需要补偿步骤，以及恢复服务需要满足什么条件。",
    followup: "想继续想想：哪些数据库结构变更实际上不可逆？",
  },
  {
    question: "一份团队规范过时了，应该直接覆盖旧内容吗？",
    answer: "不建议直接覆盖。更合理的过程是提出修订、说明原因，保留修改前后的历史，并由有权限的成员确认。这样其他人才能理解规范为何变化。",
    followup: "可以进一步讨论：什么类型的修改需要多人审阅？",
  },
  {
    question: "AI Agent 修改知识时，如何避免误覆盖？",
    answer: "应保留身份、授权范围和被修改内容的版本信息。Agent 可以提出修改建议，但并发冲突、受保护的内容与最终发布都需要遵循原有的权限和审核规则。",
    followup: "还可以问：当人和 Agent 同时编辑时，冲突如何呈现？",
  },
] as const;

const answers = [
  { label: "只要能重新运行迁移 SQL，就算有回滚方案。", correct: false },
  { label: "回滚只能处理前端发布，数据库不需要回滚。", correct: false },
  { label: "事先确认恢复路径、数据兼容性以及不可逆的变更。", correct: true },
  { label: "部署成功后再考虑恢复策略也来得及。", correct: false },
] as const;

const aiActions: ReadonlyArray<{ id: AiAction; label: string; title: string; lines: ReadonlyArray<string> }> = [
  {
    id: "summarize", label: "提炼要点", title: "基于当前知识，整理成三点",
    lines: ["发布前：核对版本、数据库状态和环境绑定。", "变更中：记录操作、执行依据与验证结果。", "发布后：验证核心路径，确认回滚条件仍然有效。"],
  },
  {
    id: "review", label: "检查风险", title: "发现需要进一步确认的地方",
    lines: ["是否明确了不可逆的数据库变更？", "是否有足够的恢复演练与执行证据？", "如果多个成员同时修改规范，是否保留版本冲突信息？"],
  },
  {
    id: "practice", label: "生成练习", title: "围绕这份知识，构造练习方向",
    lines: ["判断题：迁移成功就意味着不再需要回滚预案。", "情境题：上线后出现数据不兼容，该如何处理？", "实践题：设计包含验收步骤的数据库变更清单。"],
  },
];

function ReadScene({goTo}:{goTo:(mode:ExperienceMode)=>void}) {
  return <article className="xy-mkt-stage-reader" aria-label="阅读体验演示">
    <div className="xy-mkt-stage-overline"><span>ENGINEERING / DATABASE</span><span>知识阅读示例</span></div>
    <h3>一次安全的数据库迁移，<br/>应该从哪里开始？</h3>
    <div className="xy-mkt-reading-meta">基础设施 · 6 分钟阅读 <span aria-hidden="true">·</span> 共同完善的知识</div>
    <div className="xy-mkt-reading-rule" />
    <p>迁移不仅是将数据库结构从一个版本更新到另一个版本，更是对系统可恢复性的检验。任何看似简单的操作，都应该回答一个问题：</p>
    <blockquote>如果此刻出现问题，我们是否清楚如何恢复？</blockquote>
    <p>因此，真正可靠的方案需要在执行之前，确认变更范围、数据兼容性、回滚路径与验证步骤。</p>
    <p>知识不是读完就结束。读到这里，你可以继续提问，也可以用一道题检验理解，或请 AI 帮助梳理风险。</p>
    <div className="xy-mkt-scene-actions">
      <button type="button" onClick={()=>goTo("questions")}>围绕这段提出问题 <span>↗</span></button>
      <button type="button" onClick={()=>goTo("exam")}>试一道考试题 <span>↗</span></button>
      <button type="button" onClick={()=>goTo("ai")}>AI 辅助理解 <span>↗</span></button>
    </div>
  </article>;
}

function QuestionsScene({goTo}:{goTo:(mode:ExperienceMode)=>void}) {
  const [active,setActive]=useState(0);
  const current=qna[active];
  return <section className="xy-mkt-stage-questions" aria-label="知识问题演示">
    <div className="xy-mkt-stage-overline"><span>KNOWLEDGE / DISCUSSION</span><span>问题与答案示例</span></div>
    <h3>从一个问题，<br/>走进一整片知识。</h3>
    <div className="xy-mkt-question-picker" role="group" aria-label="选择需要探索的问题">
      {qna.map((item,index)=><button key={item.question} className={index===active?"selected":""}
        aria-pressed={index===active} type="button" onClick={()=>setActive(index)}>
        <span className="xy-mkt-question-no">0{index+1}</span>{item.question}
        <span aria-hidden="true" className="xy-mkt-question-arrow">↗</span>
      </button>)}
    </div>
    <div className="xy-mkt-answer-area" aria-live="polite">
      <div className="xy-mkt-answer-top"><span className="xy-mkt-status-pip" />讨论中的一种解答</div>
      <p>{current.answer}</p>
      <div className="xy-mkt-answer-next">{current.followup}</div>
    </div>
    <div className="xy-mkt-scene-actions">
      <button type="button" onClick={()=>goTo("reading")}>回到知识原文 <span>↗</span></button>
      <Link href="/ask">进入真实知识问答 <span>↗</span></Link>
    </div>
  </section>;
}

function ExamScene({goTo}:{goTo:(mode:ExperienceMode)=>void}) {
  const [selected,setSelected]=useState<number|null>(null);
  const [submitted,setSubmitted]=useState(false);
  const groupId=useId();
  const correct=selected!==null && answers[selected].correct;
  const reset=()=>{setSelected(null);setSubmitted(false);};
  return <section className="xy-mkt-stage-exam" aria-label="考试流程交互演示">
    <div className="xy-mkt-stage-overline"><span>KNOWLEDGE / EXAM</span><span>模拟试题 · 不记录成绩</span></div>
    <div className="xy-mkt-exam-progress"><span>01 / 01</span><span>单选题</span></div>
    <div className="xy-mkt-exam-meter"><span /></div>
    <h3>下列哪项最能体现安全的<br/>数据库迁移流程？</h3>
    <fieldset disabled={submitted} className="xy-mkt-answer-options">
      <legend className="xy-mkt-sr-only">选择你的答案</legend>
      {answers.map((option,index)=><label key={option.label}
        className={"xy-mkt-answer-option"+(selected===index?" is-selected":"")+(submitted&&option.correct?" is-correct":"")+(submitted&&selected===index&&!option.correct?" is-incorrect":"")}>
        <input type="radio" name={groupId} checked={selected===index}
          onChange={()=>setSelected(index)} />
        <span className="xy-mkt-option-letter">{String.fromCharCode(65+index)}</span>
        <span>{option.label}</span>
        <span className="xy-mkt-option-indicator" aria-hidden="true">{submitted&&option.correct?"✓":""}</span>
      </label>)}
    </fieldset>
    {submitted?<div className={"xy-mkt-exam-feedback"+(correct?" is-correct":"")} role="status">
      <strong>{correct?"答对了。理解很扎实。":"还可以再想一想。"}</strong>
      <p>关键在于提前确认恢复路径、兼容性及不可逆步骤。考试不仅要告诉你对错，还应该帮你找到需要重新阅读的知识。</p>
      <div className="xy-mkt-exam-buttons"><button type="button" onClick={reset}>再试一次</button><button type="button" onClick={()=>goTo("reading")}>返回知识原文 ↗</button></div>
    </div>:<div className="xy-mkt-exam-submit"><span>选择答案后查看解析</span><button type="button" disabled={selected===null} onClick={()=>setSubmitted(true)}>提交答案 <span>→</span></button></div>}
  </section>;
}

function AiScene({goTo}:{goTo:(mode:ExperienceMode)=>void}) {
  const [action,setAction]=useState<AiAction>("summarize");
  const current=aiActions.find(item=>item.id===action)??aiActions[0];
  return <section className="xy-mkt-stage-ai" aria-label="AI 辅助知识演示">
    <div className="xy-mkt-stage-overline"><span>KNOWLEDGE / INTELLIGENCE</span><span>基于知识的示例输出</span></div>
    <h3>AI 不另起一个知识库。<br/>而是理解你正在看的内容。</h3>
    <p className="xy-mkt-ai-intro">选择一个任务，看看 AI 可以如何围绕同一篇知识工作。下面是预置的演示结果，不会提交数据到真实模型。</p>
    <div className="xy-mkt-ai-actions" role="group" aria-label="选择 AI 知识辅助任务">
      {aiActions.map(item=><button key={item.id} type="button" aria-pressed={action===item.id} onClick={()=>setAction(item.id)}>{item.label}</button>)}
    </div>
    <div className="xy-mkt-ai-response" aria-live="polite">
      <div className="xy-mkt-ai-response-label"><span className="xy-mkt-ai-spark">✳</span> AXIS / AI ASSIST <span>示例结果</span></div>
      <h4>{current.title}</h4>
      <ol>{current.lines.map(line=><li key={line}>{line}</li>)}</ol>
      <div className="xy-mkt-ai-source">基于：生产部署与回滚规范 · 知识示例</div>
    </div>
    <div className="xy-mkt-scene-actions">
      <Link href="/ask">使用真实知识 AI 问答 <span>↗</span></Link>
      <button type="button" onClick={()=>goTo("questions")}>继续追问 <span>↗</span></button>
    </div>
    <p className="xy-mkt-ai-connection">外部 Agent 可通过 MCP 在授权范围内连接知识；它是 AI 能力的接入方式，而不是另一种产品模式。</p>
  </section>;
}

function ExperienceShowcase() {
  const [mode,setMode]=useState<ExperienceMode>("reading");
  const current=experiences.find(item=>item.id===mode)??experiences[0];
  return <section className="xy-mkt-wrap xy-mkt-experience" id="experience" aria-labelledby="xy-mkt-experience-title">
    <div className="xy-mkt-experience-heading">
      <div><span className="xy-mkt-section-tag">THE EXPERIENCE</span><h2 id="xy-mkt-experience-title">一份知识，四种体验。</h2></div>
      <p>不是四套割裂的系统。阅读、问题、考试和 AI，发生在同一份持续共创的知识上。</p>
    </div>
    <div className="xy-mkt-product-frame">
      <div className="xy-mkt-product-bar">
        <div className="xy-mkt-product-brand"><AxisMark /><span>XINGYU</span><span className="xy-mkt-product-slash">/</span><span>EXPERIENCE</span></div>
        <span className="xy-mkt-product-indicator"><i /> PRODUCT PREVIEW</span>
      </div>
      <div className="xy-mkt-mode-tabs" role="tablist" aria-label="四种知识体验">
        {experiences.map(item=><button type="button" role="tab"
          key={item.id} id={"xy-mkt-tab-"+item.id} aria-selected={mode===item.id}
          aria-controls="xy-mkt-mode-panel" onClick={()=>setMode(item.id)}>
          <span>{item.number}</span><strong>{item.name}</strong><small>{item.english}</small>
        </button>)}
      </div>
      <div className="xy-mkt-product-content">
        <div className="xy-mkt-scene-intro">
          <div className="xy-mkt-scene-count"><span>{current.number} / 04</span><span>KNOWLEDGE EXPERIENCE</span></div>
          <h3>{current.heading}</h3>
          <p>{current.description}</p>
          <div className="xy-mkt-scene-intro-foot"><span className="xy-mkt-progress-line"><span style={{width:(Number(current.number)*25)+"%"}} /></span><span>{current.footnote}</span></div>
        </div>
        <div id="xy-mkt-mode-panel" role="tabpanel" aria-labelledby={"xy-mkt-tab-"+mode} className="xy-mkt-live-panel">
          {mode==="reading"?<ReadScene goTo={setMode}/>:null}
          {mode==="questions"?<QuestionsScene goTo={setMode}/>:null}
          {mode==="exam"?<ExamScene goTo={setMode}/>:null}
          {mode==="ai"?<AiScene goTo={setMode}/>:null}
        </div>
      </div>
      <div className="xy-mkt-product-footer"><span>INTENTIONAL BY DESIGN · KNOWLEDGE IS THE FOUNDATION</span><span>交互示例 · 非真实用户数据</span></div>
    </div>
  </section>;
}

export default function XingyuMarketingHome({brandName,posts}:{brandName:string;posts:BlogHomePost[]}) {
  const published=posts.filter(post=>post.status!=="draft").slice(0,3);
  return <div className="xy-mkt">
    <section className="xy-mkt-hero xy-mkt-wrap" aria-labelledby="home-hero-title">
      <p className="xy-mkt-kicker"><i aria-hidden="true"/> XINGYU <span className="xy-mkt-kicker-divider">/</span> THE KNOWLEDGE EXPERIENCE</p>
      <h1 id="home-hero-title"><span>知识，从来不该</span><span>停在被保存的那一刻。</span></h1>
      <p className="xy-mkt-intro">阅读、提问、考试、AI。让每一份知识被真正理解、持续验证，并由个人与组织共同完善。</p>
      <div className="xy-mkt-actions">
        <Link className="xy-mkt-primary" href="/register">进入 XINGYU <span aria-hidden="true">↗</span></Link>
        <a className="xy-mkt-text-link" href="#experience">体验四种模式 <span aria-hidden="true">↓</span></a>
      </div>
      <div className="xy-mkt-hero-bottom"><span>PERSONAL <b>·</b> PUBLIC <b>·</b> ORGANIZATION</span><span>SCROLL TO EXPLORE <span aria-hidden="true">↓</span></span></div>
    </section>
    <ExperienceShowcase/>
    <section className="xy-mkt-story xy-mkt-wrap" aria-labelledby="xy-mkt-story-title">
      <span className="xy-mkt-section-tag">A LIVING SYSTEM</span>
      <div className="xy-mkt-story-grid">
        <h2 id="xy-mkt-story-title">真正有生命力的知识，<br/>从来不是一个人的终稿。</h2>
        <div className="xy-mkt-story-copy">
          <p>有人记录，有人提出不同的问题，有人补充真实经验。人们通过考试验证理解，AI 在授权范围内参与分析与协作。</p>
          <p>个人、公开内容和组织知识共同存在。权限、版本与贡献记录，是这套体验可信赖的基础。</p>
          <Link href="/connect" className="xy-mkt-text-link">了解知识与 AI 的连接方式 <span aria-hidden="true">↗</span></Link>
        </div>
      </div>
      <div className="xy-mkt-story-index" aria-label="知识体验的四条主线">
        {experiences.map(item=><div key={item.id}><span>{item.number}</span><strong>{item.name}</strong><small>{item.english}</small></div>)}
      </div>
    </section>
    <section className="xy-mkt-public xy-mkt-wrap" aria-labelledby="xy-mkt-public-title">
      <div className="xy-mkt-section-head">
        <div><span className="xy-mkt-section-tag">OPEN KNOWLEDGE</span><h2 id="xy-mkt-public-title">正在被分享的知识。</h2></div>
        <Link className="xy-mkt-text-link" href="/archive">探索公开内容 <span aria-hidden="true">↗</span></Link>
      </div>
      <div className="xy-mkt-public-posts">
        {published.length?published.map(post=><Link key={post.publicId} className="xy-mkt-post" href={"/posts/"+encodeURIComponent(post.publicId)+"/"+encodeURIComponent(post.slug)}>
          <span className="xy-mkt-post-type">{post.categoryName||"公开知识"}</span>
          <span className="xy-mkt-post-main"><b>{post.title}</b><small>{post.excerpt||"打开阅读完整内容"}</small></span>
          <span className="xy-mkt-post-arrow" aria-hidden="true">↗</span>
        </Link>):<p className="xy-mkt-empty">公开知识正在建设中。从你的第一份记录开始，也是一种可能。</p>}
      </div>
    </section>
    <section className="xy-mkt-finish"><div className="xy-mkt-wrap">
      <span className="xy-mkt-section-tag">XINGYU / KNOWLEDGE IN MOTION</span>
      <h2>让知识，继续发生。</h2>
      <p>今天从一份知识开始。阅读、追问、检验、协作，让每一次理解都成为下一次进步的起点。</p>
      <Link className="xy-mkt-primary" href="/register">开始使用 <span aria-hidden="true">↗</span></Link>
      <footer className="xy-mkt-footer"><span>© {new Date().getFullYear()} {brandName} · XINGYU</span>
        <div><Link href="/about">关于</Link><span>　·　</span><Link href="/connect">连接</Link><span>　·　</span><Link href="/archive">公开知识</Link></div>
      </footer>
    </div></section>
  </div>;
}

"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type AskScope = "public" | "mine" | "all";
type Mode = "answer" | "sources";
type Source = {
  id: number; title: string; excerpt: string; snippet: string;
  visibility: "public" | "personal"; url: string;
};
type AskResult = {
  answer: string; sources: Source[]; model: string | null; degraded: boolean;
  diagnostic?: { code: string; status: number | null; incidentId: string };
};
type Turn = {
  id: number; question: string; mode: Mode;
  pending: boolean; result?: AskResult; error?: string;
};

const SUGGESTIONS = [
  "这个网站主要分享哪些技术经验？",
  "有哪些 Cloudflare 和 AI 实践？",
  "分享过哪些设计与开发经验？",
];

function TrustedAnswer({ answer, sources }: { answer: string; sources: Source[] }) {
  const byId = new Map(sources.map(source => [source.id, source]));
  // A model can cite only the source numbers returned by our server. It never controls a link URL.
  const safeMarkdown = answer.replace(/\[(\d{1,3})\]/g, (original, number: string) =>
    byId.has(Number(number)) ? "[" + number + "](cite:" + number + ")" : original);
  return <div className="xy-ai-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]}
      urlTransform={url => /^cite:\d{1,3}$/.test(url) ? url : ""}
      components={{
        a: ({ href, children }) => {
          const id = /^cite:(\d{1,3})$/.exec(href ?? "");
          const source = id ? byId.get(Number(id[1])) : null;
          return source
            ? <a className="xy-ai-citation" href={source.url}
                target={source.visibility === "public" ? "_blank" : undefined}
                rel="noopener noreferrer" aria-label={"查看引用：" + source.title}>{children}</a>
            : <span>{children}</span>;
        },
        img: () => null,
      }}
    >{safeMarkdown}</ReactMarkdown>
  </div>;
}

export default function AskChat({
  authenticated, defaultScope = "public", variant = "page",
}: {
  authenticated: boolean; defaultScope?: AskScope; variant?: "page" | "panel";
}) {
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<AskScope>(authenticated ? defaultScope : "public");
  const [privateConsent, setPrivateConsent] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [composerError, setComposerError] = useState("");
  const sequence = useRef(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const effectiveScope = authenticated ? scope : "public";

  useEffect(() => {
    if (turns.length) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  function reset() {
    generation.current += 1;
    setTurns([]);
    setQuestion("");
    setComposerError("");
  }

  async function ask(mode: Mode, suggested?: string) {
    const value = (suggested ?? question).trim();
    if (value.length < 2 || value.length > 240) {
      setComposerError("请输入 2 到 240 个字符的问题（支持中文短词）");
      return;
    }
    if (inFlight.current) return;
    if (effectiveScope !== "public" && !authenticated) {
      setComposerError("请先登录后再检索私人知识");
      return;
    }
    if (effectiveScope !== "public" && mode === "answer" && !privateConsent) {
      setComposerError("请先勾选私人资料发送给模型的明确同意");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setComposerError("");
    setQuestion("");
    const id = ++sequence.current;
    const version = generation.current;
    setTurns(previous => [...previous, { id, question: value, mode, pending: true }]);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          question: value, scope: effectiveScope, mode,
          confirmedExternalProcessing: effectiveScope === "public" || privateConsent,
        }),
      });
      const data = await response.json() as Partial<AskResult> & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "问答服务暂时不可用");
      if (!Array.isArray(data.sources) || typeof data.answer !== "string")
        throw new Error("检索服务返回格式异常，请稍后重试");
      if (generation.current === version) setTurns(previous => previous.map(turn =>
        turn.id === id ? {
          ...turn, pending: false,
          result: { answer: data.answer!, sources: data.sources!,
            degraded: Boolean(data.degraded), model: data.model ?? null,
            diagnostic: data.diagnostic },
        } : turn));
    } catch (error) {
      if (generation.current === version) setTurns(previous => previous.map(turn =>
        turn.id === id
          ? { ...turn, pending: false, error: error instanceof Error ? error.message : "网络出现问题，请重试" }
          : turn));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask("answer");
  }

  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask("answer");
    }
  }

  return <section className={"xy-ai-chat xy-ai-chat--" + variant} aria-label="星屿知识问答">
    <div className="xy-ai-chat-top">
      <div className="xy-ai-chat-title">
        <span className="xy-ai-status" aria-hidden="true" />
        <span>基于星屿真实知识库</span>
      </div>
      {turns.length ? <button type="button" className="xy-ai-reset" onClick={reset}
        aria-label="清空当前问答并开始新对话">＋ 新对话</button> : <small>有来源 · 可核对</small>}
    </div>

    <div className="xy-ai-thread" role="log" aria-live="polite" aria-relevant="additions text">
      {!turns.length ? <div className="xy-ai-welcome">
        <span className="xy-ai-welcome-mark" aria-hidden="true">✦</span>
        <h2>有什么想了解的？</h2>
        <p>搜索本站公开文章，或在登录后检索你有权访问的私人知识。每条答案都可以返回原文核对。</p>
        <div className="xy-ai-suggestions">
          <span>可以试试</span>
          {SUGGESTIONS.map(example => <button type="button" key={example}
            onClick={() => void ask("answer", example)} disabled={busy}>
            {example} <span aria-hidden="true">↗</span>
          </button>)}
        </div>
      </div> : null}

      {turns.map(turn => <div className="xy-ai-turn" key={turn.id}>
        <div className="xy-ai-user-message"><p>{turn.question}</p></div>
        <div className="xy-ai-assistant-message">
          <span className="xy-ai-message-avatar" aria-hidden="true">✦</span>
          <div className="xy-ai-message-content">
            {turn.pending ? <div className="xy-ai-thinking" role="status">
              <span className="xy-ai-thinking-dots" aria-hidden="true"><i/><i/><i/></span>
              正在查找知识库内容…
            </div> : turn.error ? <div className="xy-ai-turn-error" role="alert">
              {turn.error}
              <button type="button" disabled={busy}
                onClick={() => void ask(turn.mode, turn.question)}>重试</button>
            </div> : turn.result ? <>
              <div className="xy-ai-reply-label">
                {turn.result.degraded ? "模型暂不可用 · 已提供真实来源"
                  : turn.result.model ? "知识库 AI 回答" : "原文检索结果"}
              </div>
              <TrustedAnswer answer={turn.result.answer} sources={turn.result.sources}/>
              {turn.result.degraded && turn.result.diagnostic ? <p className="xy-ai-no-sources"
                aria-label="模型错误诊断">
                错误类别：{turn.result.diagnostic.code}
                {turn.result.diagnostic.status !== null ? " · HTTP " + turn.result.diagnostic.status : ""}
                {" · 诊断编号：" + turn.result.diagnostic.incidentId}
              </p> : null}
              {turn.result.sources.length ? <div className="xy-ai-sources">
                <p>参考来源 <span>{turn.result.sources.length} 篇</span></p>
                {turn.result.sources.map(source => <a key={source.id}
                  className="xy-ai-source" href={source.url}
                  target={source.visibility === "public" ? "_blank" : undefined}
                  rel="noopener noreferrer">
                  <span className="xy-ai-source-number">[{source.id}]</span>
                  <span className="xy-ai-source-content">
                    <strong>{source.title}</strong>
                    <small>{source.snippet.slice(0, 140) || source.excerpt.slice(0, 140)}</small>
                  </span>
                  <span className="xy-ai-source-arrow" aria-hidden="true">↗</span>
                </a>)}
              </div> : <p className="xy-ai-no-sources">
                当前知识范围内没有匹配的原文。试试更完整的名称、同义词，或登录后切换知识范围。
              </p>}
            </> : null}
          </div>
        </div>
      </div>)}
      <div ref={bottomRef} />
    </div>

    <div className="xy-ai-composer">
      <div className="xy-ai-scopes" role="group" aria-label="知识来源范围">
        <button type="button" className={effectiveScope === "public" ? "selected" : ""}
          aria-pressed={effectiveScope === "public"} onClick={() => { setScope("public"); setComposerError(""); }}>
          公开文章
        </button>
        {authenticated ? <>
          <button type="button" className={effectiveScope === "mine" ? "selected" : ""}
            aria-pressed={effectiveScope === "mine"} onClick={() => { setScope("mine"); setComposerError(""); }}>
            我的知识
          </button>
          <button type="button" className={effectiveScope === "all" ? "selected" : ""}
            aria-pressed={effectiveScope === "all"} onClick={() => { setScope("all"); setComposerError(""); }}>
            全部授权
          </button>
        </> : <Link href="/login?return_to=%2Fadmin" className="xy-ai-signin">登录后查私人知识 ↗</Link>}
      </div>
      <form onSubmit={submit} className="xy-ai-form">
        <label htmlFor={inputId} className="xy-ai-sr-only">向星屿提问</label>
        <textarea id={inputId} value={question} onChange={event => {
          setQuestion(event.target.value);
          if (composerError) setComposerError("");
        }} onKeyDown={keyboard} placeholder="问问星屿…"
          maxLength={240} rows={2} disabled={busy}
          aria-label="向星屿提问，Enter 发送，Shift+Enter 换行" />
        <div className="xy-ai-composer-actions">
          <span>{question.length} / 240</span>
          <div>
            <button type="button" className="xy-ai-only-search" disabled={busy || question.trim().length < 2}
              onClick={() => void ask("sources")}>仅检索</button>
            <button type="submit" className="xy-ai-send" disabled={busy || question.trim().length < 2}
              aria-label="发送问题并生成回答">{busy ? "检索中…" : "发送"} <span aria-hidden="true">↑</span></button>
          </div>
        </div>
      </form>
      {effectiveScope !== "public" ? <label className="xy-ai-consent">
        <input type="checkbox" checked={privateConsent} onChange={event => setPrivateConsent(event.target.checked)} />
        <span>我同意本次问题及匹配的私人文章片段发送给 OpenRouter 与其模型提供方；未勾选时可选择「仅检索」。</span>
      </label> : null}
      {composerError ? <p className="xy-ai-composer-error" role="alert">{composerError}</p> : null}
      <small className="xy-ai-footnote">只根据真实文章回答 · 不保存长期对话记忆</small>
    </div>
  </section>;
}

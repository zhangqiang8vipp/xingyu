"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

type Scope="public"|"mine"|"all";
type Source={
  id:number;title:string;excerpt:string;snippet:string;
  visibility:"public"|"personal";url:string;
};
type AskResult={
  answer:string;sources:Source[];model:string|null;degraded:boolean;
};
const EXAMPLE_QUESTIONS=[
  "这个网站主要分享哪些技术经验？",
  "有哪些关于 AI 和知识库的文章？",
  "文章中提到了哪些设计实践？",
];

function AnswerText({answer,sources}:{answer:string;sources:Source[]}) {
  const parts=answer.split(/(\[\d{1,3}\])/g);
  return <div className="xy-ask-answer-body">{parts.map((part,index)=>{
    const match=/^\[(\d{1,3})\]$/.exec(part);
    const source=match?sources.find(item=>item.id===Number(match[1])):null;
    return source
      ?<a key={index} className="xy-ask-citation" href={source.url}
          target="_blank" rel="noopener noreferrer" aria-label={"查看来源 "+source.title}>{part}</a>
      :<span key={index}>{part}</span>;
  })}</div>;
}

export default function AskClient({authenticated,defaultScope}:{authenticated:boolean;defaultScope:Scope}) {
  const [question,setQuestion]=useState("");
  const [scope,setScope]=useState<Scope>(authenticated?defaultScope:"public");
  const [privateConsent,setPrivateConsent]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState<AskResult|null>(null);
  const [asked,setAsked]=useState("");

  async function ask(mode:"answer"|"sources") {
    const query=question.trim();
    if(query.length<3||query.length>240)return setError("请输入 3 到 240 字的问题");
    if(scope!=="public"&&!authenticated)return setError("请先登录才能搜索私人知识");
    if(scope!=="public"&&mode==="answer"&&!privateConsent)
      return setError("使用模型回答私人知识前，请先确认下方的数据处理提示");
    setLoading(true);setError("");setResult(null);setAsked(query);
    try{
      const response=await fetch("/api/ask",{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          question:query,scope,mode,
          confirmedExternalProcessing:scope==="public"||privateConsent,
        }),
        cache:"no-store",
      });
      const data=await response.json() as AskResult&{error?:string};
      if(!response.ok)throw new Error(data.error??"问答服务暂时不可用");
      setResult(data);
    }catch(error) {
      setError(error instanceof Error?error.message:"问答服务暂时不可用");
    }finally{setLoading(false);}
  }
  function onSubmit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    void ask("answer");
  }

  return <div className="xy-ask-surface">
    <div className="xy-ask-intro">
      <p className="xy-ask-eyebrow">XINGYU / KNOWLEDGE ASSISTANT</p>
      <h1>问问星屿<span>✦</span></h1>
      <p>向知识库提问，获取基于真实文章的回答，并查看原文出处。</p>
    </div>

    <section className="xy-ask-card" aria-label="知识问答">
      <div className="xy-ask-card-head">
        <div><span className="xy-ask-pulse"/>基于知识库检索</div>
        <small>OpenRouter · openrouter/free</small>
      </div>
      <div className="xy-ask-scope" role="group" aria-label="知识来源范围">
        <button type="button" aria-pressed={scope==="public"} className={scope==="public"?"active":""}
          onClick={()=>{setScope("public");setError("");}}>公开文章</button>
        {authenticated?<button type="button" aria-pressed={scope==="mine"} className={scope==="mine"?"active":""}
          onClick={()=>{setScope("mine");setError("");}}>我的私人知识</button>:null}
        {authenticated?<button type="button" aria-pressed={scope==="all"} className={scope==="all"?"active":""}
          onClick={()=>{setScope("all");setError("");}}>全部可访问知识</button>:null}
        {!authenticated?<Link href="/login?return_to=%2Fask%3Fscope%3Dmine">登录后问私人知识 ↗</Link>:null}
      </div>
      <form onSubmit={onSubmit}>
        <label className="xy-ask-input-label" htmlFor="xy-ask-question">你想了解什么？</label>
        <textarea id="xy-ask-question" value={question} onChange={event=>setQuestion(event.target.value)}
          placeholder="例如：这个网站主要分享哪些技术经验？" rows={3} maxLength={240} disabled={loading}/>
        <div className="xy-ask-input-footer">
          <span>{question.length} / 240</span>
          <div>
            <button type="button" disabled={loading} className="xy-ask-search-only"
              onClick={()=>void ask("sources")}>仅检索原文</button>
            <button type="submit" disabled={loading||question.trim().length<3} className="xy-ask-submit">
              {loading?"正在查找…":"生成回答 →"}
            </button>
          </div>
        </div>
        {scope!=="public"?<label className="xy-ask-privacy-checkbox">
          <input type="checkbox" checked={privateConsent}
            onChange={event=>setPrivateConsent(event.target.checked)}/>
          <span>我同意将本次问题与匹配的私人文章片段发送给 OpenRouter 生成答案。不会自动保存对话，也不会修改知识库。</span>
        </label>:null}
      </form>
      {!asked && !result?<div className="xy-ask-examples">
        <small>试着问问</small>
        <div>{EXAMPLE_QUESTIONS.map(example=><button key={example} type="button"
          onClick={()=>setQuestion(example)}>{example}<span>↗</span></button>)}</div>
      </div>:null}
      {error?<p className="xy-ask-error" role="alert">{error}</p>:null}
      {loading?<div className="xy-ask-busy" role="status"><span/><span/><span/>正在检索文章并生成回答…</div>:null}
      {result?<div className="xy-ask-response" aria-live="polite">
        <div className="xy-ask-question"><small>你的问题</small><p>{asked}</p></div>
        <div className="xy-ask-answer">
          <small>{result.degraded?"模型暂时不可用 · 已降级为原文检索":result.model?"知识库回答 · "+result.model:"知识库检索"}</small>
          <AnswerText answer={result.answer} sources={result.sources}/>
        </div>
        <div className="xy-ask-sources">
          <div className="xy-ask-sources-heading">可核对的原文 <span>{result.sources.length} 篇</span></div>
          {result.sources.length?result.sources.map(source=><a key={source.id}
            href={source.url} target="_blank" rel="noopener noreferrer" className="xy-ask-source">
            <span className="xy-ask-source-index">[{source.id}]</span>
            <span className="xy-ask-source-detail">
              <strong>{source.title}</strong>
              <em>{source.snippet.slice(0,190)}</em>
            </span>
            <span className="xy-ask-source-arrow">↗</span>
          </a>):<p className="xy-ask-empty">没有找到匹配的文章，AI 不会编造不存在的来源。</p>}
        </div>
      </div>:null}
    </section>
    <p className="xy-ask-disclaimer">回答仅根据检索到的文章片段生成，可能有遗漏；请以原文为准。免费模型存在额度和可用性限制。</p>
    {authenticated?<Link href="/admin" className="xy-ask-back">← 返回知识库后台</Link>:null}
  </div>;
}

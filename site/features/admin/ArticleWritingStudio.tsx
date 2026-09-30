"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import VditorEditor from "./VditorEditor";
import { formatLongDate } from "@/app/content-utils";

type Mode="code"|"split"|"reading";
export type ArticleDraft={id?:number;publicId?:string;version?:number;title:string;slug?:string;excerpt:string;content:string;publishedAt?:string|null;status?:"draft"|"published";spaceId?:number|null;spacePath?:string};
/** Keeps Markdown source and the real frontstage iframe on one reading progress. */
export function useSplitScrollSync(rootRef:RefObject<HTMLElement|null>,enabled=true){
  useEffect(()=>{
    if(!enabled)return;
    const root=rootRef.current;
    if(!root)return;
    let source:HTMLElement|null=null;
    let frameWindow:Window|null=null;
    let resetSource=false;
    let resetFrame=false;
    const ratio=(top:number,total:number,visible:number)=>Math.max(0,Math.min(1,total>visible?top/(total-visible):0));
    const release=(target:"source"|"frame")=>window.requestAnimationFrame(()=>{if(target==="source")resetSource=false;else resetFrame=false});
    const onSourceScroll=()=>{
      if(!source||!frameWindow)return;
      if(resetSource){resetSource=false;return}
      const documentElement=frameWindow.document.documentElement;
      const body=frameWindow.document.body;
      const top=ratio(source.scrollTop,source.scrollHeight,source.clientHeight);
      const max=Math.max(documentElement.scrollHeight,body.scrollHeight)-frameWindow.innerHeight;
      resetFrame=true;
      frameWindow.scrollTo(0,Math.max(0,Math.round(top*max)));
      release("frame");
    };
    const onFrameScroll=()=>{
      if(!source||!frameWindow)return;
      if(resetFrame){resetFrame=false;return}
      const documentElement=frameWindow.document.documentElement;
      const body=frameWindow.document.body;
      const top=ratio(frameWindow.scrollY,Math.max(documentElement.scrollHeight,body.scrollHeight),frameWindow.innerHeight);
      resetSource=true;
      source.scrollTop=Math.round(top*Math.max(0,source.scrollHeight-source.clientHeight));
      release("source");
    };
    const detachFrame=()=>{frameWindow?.removeEventListener("scroll",onFrameScroll);frameWindow=null};
    const attachFrame=()=>{
      detachFrame();
      const frame=root.querySelector<HTMLIFrameElement>(".writing-frontstage-frame");
      if(!frame?.contentWindow)return;
      frameWindow=frame.contentWindow;
      frameWindow.addEventListener("scroll",onFrameScroll,{passive:true});
    };
    const attachSource=()=>{
      const next=root.querySelector<HTMLElement>(".vditor-sv");
      if(!next||next===source)return;
      source?.removeEventListener("scroll",onSourceScroll);
      source=next;
      source.addEventListener("scroll",onSourceScroll,{passive:true});
    };
    const frame=root.querySelector<HTMLIFrameElement>(".writing-frontstage-frame");
    frame?.addEventListener("load",attachFrame);
    attachSource();
    attachFrame();
    const observer=new MutationObserver(attachSource);
    observer.observe(root,{childList:true,subtree:true});
    return()=>{observer.disconnect();source?.removeEventListener("scroll",onSourceScroll);frame?.removeEventListener("load",attachFrame);detachFrame()};
  },[enabled,rootRef]);
}
export default function ArticleWritingStudio({draft,categoryName,categoryColor,authorName,avatarUrl,initialMode="split",onChange,onPostVersionChange,onClose}:{draft:ArticleDraft;categoryName:string;categoryColor:string;authorName:string;avatarUrl:string;initialMode?:Mode;onChange:(content:string)=>void;onPostVersionChange?:(version:number)=>void;onClose:()=>void}){
  const [mode,setMode]=useState<Mode>(initialMode);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose()};window.addEventListener("keydown",close);const overflow=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{window.removeEventListener("keydown",close);document.body.style.overflow=overflow}},[onClose]);
  useEffect(()=>{
    if(mode!=="split")return;
    const root=document.querySelector<HTMLElement>(".writing-studio");
    if(!root)return;
    let source:HTMLElement|null=null;
    let frameWindow:Window|null=null;
    let resetSource=false;
    let resetFrame=false;
    const ratio=(top:number,total:number,visible:number)=>Math.max(0,Math.min(1,total>visible?top/(total-visible):0));
    const release=(target:"source"|"frame")=>window.requestAnimationFrame(()=>{if(target==="source")resetSource=false;else resetFrame=false});
    const onSourceScroll=()=>{
      if(!source||!frameWindow)return;
      if(resetSource){resetSource=false;return}
      const documentElement=frameWindow.document.documentElement;
      const body=frameWindow.document.body;
      const top=ratio(source.scrollTop,source.scrollHeight,source.clientHeight);
      const max=Math.max(documentElement.scrollHeight,body.scrollHeight)-frameWindow.innerHeight;
      resetFrame=true;
      frameWindow.scrollTo(0,Math.max(0,Math.round(top*max)));
      release("frame");
    };
    const onFrameScroll=()=>{
      if(!source||!frameWindow)return;
      if(resetFrame){resetFrame=false;return}
      const documentElement=frameWindow.document.documentElement;
      const body=frameWindow.document.body;
      const top=ratio(frameWindow.scrollY,Math.max(documentElement.scrollHeight,body.scrollHeight),frameWindow.innerHeight);
      resetSource=true;
      source.scrollTop=Math.round(top*Math.max(0,source.scrollHeight-source.clientHeight));
      release("source");
    };
    const detachFrame=()=>{frameWindow?.removeEventListener("scroll",onFrameScroll);frameWindow=null};
    const attachFrame=()=>{
      detachFrame();
      const frame=root.querySelector<HTMLIFrameElement>(".writing-frontstage-frame");
      if(!frame?.contentWindow)return;
      frameWindow=frame.contentWindow;
      frameWindow.addEventListener("scroll",onFrameScroll,{passive:true});
    };
    const attachSource=()=>{
      const next=root.querySelector<HTMLElement>(".writing-source .vditor-sv");
      if(!next||next===source)return;
      source?.removeEventListener("scroll",onSourceScroll);
      source=next;
      source.addEventListener("scroll",onSourceScroll,{passive:true});
    };
    const frame=root.querySelector<HTMLIFrameElement>(".writing-frontstage-frame");
    frame?.addEventListener("load",attachFrame);
    attachSource();
    attachFrame();
    const observer=new MutationObserver(attachSource);
    observer.observe(root,{childList:true,subtree:true});
    return()=>{observer.disconnect();source?.removeEventListener("scroll",onSourceScroll);frame?.removeEventListener("load",attachFrame);detachFrame()};
  },[mode]);
  return <div className={`writing-studio mode-${mode}`} role="dialog" aria-modal="true" aria-label="沉浸式文章写作">
    <header><div className="writing-studio-brand"><i style={{background:categoryColor}}/><span>实时写作</span><b>{draft.title||"未命名文章"}</b></div><div className="writing-mode-switch" aria-label="写作方式"><button className={mode==="code"?"active":""} onClick={()=>setMode("code")}>源码</button><button className={mode==="split"?"active":""} onClick={()=>setMode("split")}>分屏</button><button className={mode==="reading"?"active":""} onClick={()=>setMode("reading")}>阅读</button></div><div className="writing-studio-actions"><span>内容实时保留在编辑表单</span><button onClick={onClose}>完成</button></div></header>
    <main>{mode!=="reading"&&<section className="writing-source"><div><span>MARKDOWN SOURCE</span><small>输入 / 使用指令 · Ctrl+V 粘贴图片</small></div><VditorEditor value={draft.content} onChange={onChange} previewMode="editor" autoFocus attachments postId={draft.id} postVersion={draft.version} onPostVersionChange={onPostVersionChange}/></section>}{mode!=="code"&&<ArticleFrontstage key={draft.publicId ?? draft.id ?? "new-draft"} draft={draft} categoryName={categoryName} categoryColor={categoryColor} authorName={authorName} avatarUrl={avatarUrl}/>}</main>
  </div>;
}

/** Shared by the compact editor and the immersive studio: never fork public preview markup. */
export function ArticleFrontstage({draft,categoryName,categoryColor,authorName,avatarUrl}:{draft:ArticleDraft;categoryName:string;categoryColor:string;authorName:string;avatarUrl:string}){
  const frame=useRef<HTMLIFrameElement>(null);
  const payload=useMemo(()=>({...draft,title:draft.title||"未命名文章",excerpt:draft.excerpt||"文章摘要会显示在这里。",content:draft.content||"从左侧开始写作，正文会在这里实时呈现。",categoryName,categoryColor,authorName,avatarUrl,publishedLabel:formatLongDate(draft.publishedAt,"预览日期")}),[draft,categoryName,categoryColor,authorName,avatarUrl]);
  const sync=useCallback(()=>frame.current?.contentWindow?.postMessage({type:"xingyu:admin-preview",kind:"article",payload},window.location.origin),[payload]);
  useEffect(()=>{const ready=(event:MessageEvent)=>{if(event.origin===window.location.origin&&event.data?.type==="xingyu:admin-preview-ready"&&event.data?.kind==="article")sync()};window.addEventListener("message",ready);sync();return()=>window.removeEventListener("message",ready)},[sync]);
  // A separate URL per draft prevents the browser from preserving a previous
  // iframe document when an editor switches directly from one article to another.
  const identity=draft.publicId ?? draft.id ?? "new-draft";
  const source=`/admin/article-preview?draft=${encodeURIComponent(String(identity))}`;
  const syncFromTop=useCallback(()=>{
    // Browsers can restore an iframe's old scroll position for the same draft URL.
    // Reset only on frame load, never on every keystroke, so writers can inspect
    // lower sections without the preview jumping away.
    frame.current?.contentWindow?.scrollTo(0,0);
    sync();
  },[sync]);
  return <section className="writing-render"><iframe ref={frame} className="writing-frontstage-frame" src={source} title="真实文章前台预览" onLoad={syncFromTop}/></section>;
}

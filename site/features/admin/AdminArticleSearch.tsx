"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { readApiJson } from "@/app/api-response";

export type AdminSearchPost = {
  id:number;
  publicId:string;
  title:string;
  slug:string;
  excerpt:string;
  status:"draft"|"published";
  categoryName:string|null;
  categoryColor:string|null;
  updatedAt:string;
  spaceId:number|null;
  spacePath:string|null;
  visibility?:"personal"|"public";
};

export default function AdminArticleSearch({
  articleCount,
  onBrowse,
  disabled=false,
  isPersonalAccount=false,
}:{
  articleCount:number;
  onBrowse:(postId:number,publicId?:string)=>void;
  disabled?:boolean;
  isPersonalAccount?:boolean;
}){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [scope,setScope]=useState<"all"|"public"|"private">("all");
  const [error,setError]=useState(false);
  const dialogId=useId();
  const triggerRef=useRef<HTMLButtonElement>(null);
  const [rows,setRows]=useState<AdminSearchPost[]>([]);
  const [loading,setLoading]=useState(false);
  const [activeIndex,setActiveIndex]=useState(0);
  const rootRef=useRef<HTMLDivElement>(null);
  const inputRef=useRef<HTMLInputElement>(null);
  const listRef=useRef<HTMLDivElement>(null);
  const beginSearch=useCallback(()=>{
    if(disabled)return;
    setQuery("");
    setScope("all");
    setError(false);
    setRows([]);
    setActiveIndex(0);
    setOpen(true);
  },[disabled]);

  useEffect(()=>{
    const shortcut=(event:KeyboardEvent)=>{
      if(!disabled&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){
        event.preventDefault();
        if(open)setOpen(false);
        else beginSearch();
      }
    };
    window.addEventListener("keydown",shortcut);
    return()=>window.removeEventListener("keydown",shortcut);
  },[beginSearch,disabled,open]);

  useEffect(()=>{
    if(!open||disabled)return;
    const timer=window.setTimeout(()=>inputRef.current?.focus(),0);
    const closeOnEscape=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        setOpen(false);
        window.requestAnimationFrame(()=>triggerRef.current?.focus());
      }
    };
    const closeOnOutside=(event:PointerEvent)=>{
      if(!rootRef.current?.contains(event.target as Node))setOpen(false);
    };
    window.addEventListener("keydown",closeOnEscape);
    window.addEventListener("pointerdown",closeOnOutside);
    return()=>{
      window.clearTimeout(timer);
      window.removeEventListener("keydown",closeOnEscape);
      window.removeEventListener("pointerdown",closeOnOutside);
    };
  },[disabled,open]);

  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setLoading(true);
      try{
        setError(false);
        if (isPersonalAccount) {
          // Use one server-paginated, permission-scoped query. Avoid merging
          // two independent lists which can silently hide newer entries.
          const type=scope==="public"?"public":scope==="private"?"mine":"all";
          const params=new URLSearchParams({type,limit:"20",q:query});
          const response=await fetch(`/api/knowledge/posts?${params}`,{
            signal:controller.signal,cache:"no-store"
          });
          if(!response.ok)throw new Error("search unavailable");
          const data=await readApiJson<{posts:Record<string,unknown>[]}>(response);
          setRows((data.posts??[]).map((post)=>{
            const visibility=post.visibility==="public"?"public" as const:"personal" as const;
            return {
              id:Number(post.id),publicId:String(post.publicId),title:String(post.title),
              slug:String(post.slug??""),excerpt:String(post.excerpt??""),
              status:visibility==="public"?"published" as const:"draft" as const,
              categoryName:typeof post.categoryName==="string"?post.categoryName:null,
              categoryColor:typeof post.categoryColor==="string"?post.categoryColor:null,
              updatedAt:String(post.updatedAt??""),
              spaceId:visibility==="public"?null:Number(post.spaceId??0)||null,
              spacePath:visibility==="public"?null:"个人知识空间",
              visibility,
            };
          }));
        } else {
          const params=new URLSearchParams({scope,q:query,pageSize:"20",status:"all",category:"all"});
          const response=await fetch(`/api/posts?${params}`,{signal:controller.signal,cache:"no-store"});
          if(!response.ok)throw new Error("search unavailable");
          const data=await readApiJson<{rows:AdminSearchPost[]}>(response);
          setRows(data.rows??[]);
        }
        setActiveIndex(0);
      }catch(error){
        if(!(error instanceof DOMException&&error.name==="AbortError")){setRows([]);setError(true);}
      }finally{
        if(!controller.signal.aborted)setLoading(false);
      }
    },query?120:0);
    return()=>{window.clearTimeout(timer);controller.abort()};
  },[open,query,scope,isPersonalAccount]);

  useEffect(()=>{
    listRef.current?.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`)
      ?.scrollIntoView({block:"nearest"});
  },[activeIndex]);

  const close=()=>{
    setOpen(false);
    window.requestAnimationFrame(()=>triggerRef.current?.focus());
  };
  const browse=(postId:number,publicId?:string)=>{
    close();
    onBrowse(postId,publicId);
  };
  const onKeyDown=(event:React.KeyboardEvent<HTMLInputElement>)=>{
    if(event.key==="Escape"){event.preventDefault();close();return}
    if(event.key==="ArrowDown"){
      event.preventDefault();
      if(!rows.length)return;
      setActiveIndex((value)=>Math.min(rows.length-1,value+1));
      return;
    }
    if(event.key==="ArrowUp"){
      event.preventDefault();
      if(!rows.length)return;
      setActiveIndex((value)=>Math.max(0,value-1));
      return;
    }
    if(event.key==="Enter"&&rows[activeIndex]){
      event.preventDefault();
      browse(rows[activeIndex].id,rows[activeIndex].publicId);
    }
  };

  return <div ref={rootRef} className={`admin-article-search${open?" active":""}`}>
    {!open&&<button ref={triggerRef} className="admin-article-search-trigger" type="button" disabled={disabled} onClick={beginSearch} aria-label="搜索全部文章" aria-expanded={open} aria-controls={dialogId}>
      <i>⌕</i><span>搜索全部文章</span><kbd>⌘K</kbd>
    </button>}
    {open&&!disabled&&
      <section id={dialogId} className="admin-article-search-dialog" role="dialog" aria-label="搜索全部文章">
        <header>
          <i>⌕</i>
          <input ref={inputRef} value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="搜索标题、摘要、正文或 Slug" aria-label="搜索全部文章"/>
          {query&&<button type="button" onClick={()=>setQuery("")} aria-label="清空搜索">×</button>}
          <kbd>ESC</kbd>
        </header>
        <div className="axis-search-scopes" role="group" aria-label="搜索范围">
          {([["all","全部内容"],["public","公开文章"],["private","知识空间"]] as const).map(([key,label])=>
            <button key={key} type="button" aria-pressed={scope===key} className={scope===key?"active":undefined} onClick={()=>setScope(key)}>{label}</button>
          )}
        </div>
        <div className="admin-article-search-meta">
          <span>{query?`搜索“${query}”`:"最近编辑"}</span>
          <b>{loading?"检索中":`${rows.length} 个结果`}</b>
        </div>
        <div className="admin-article-search-results" ref={listRef} role="listbox" aria-label="文章搜索结果" aria-busy={loading}>
          {rows.map((post,index)=><button
            type="button"
            role="option"
            aria-selected={index===activeIndex}
            data-search-index={index}
            className={index===activeIndex?"active":""}
            key={post.id}
            onMouseEnter={()=>setActiveIndex(index)}
            onClick={()=>browse(post.id,post.publicId)}
          >
            <i style={{background:post.categoryColor??"#8e8e93"}}/>
            <span>
              <b>{post.title}</b>
              <small>{post.spaceId?(post.spacePath||"私有知识空间"):`公开博客 · ${post.categoryName??"未分类"}`}</small>
            </span>
            <em>{post.status==="published"?(post.spaceId?"内容完成":"已发布"):"草稿"}</em>
            <strong>浏览 ↗</strong>
          </button>)}
          {!loading&&!rows.length&&<div className="admin-article-search-empty" role="status"><i>◇</i><b>{error?"搜索暂时不可用":"没有找到相关文章"}</b><span>{error?"网络可能不稳定，请重试或稍后再查。":"换一个关键词或搜索范围试试。"}</span>{error?<button type="button" onClick={()=>setQuery((current)=>current+" ")}>重试搜索</button>:null}</div>}
          {loading&&!rows.length&&<div className="admin-article-search-loading"><i/><i/><i/><span>正在检索全部文章</span></div>}
        </div>
        <footer>
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择　<kbd>Enter</kbd> 正式浏览</span>
          <span>可访问内容 {articleCount.toLocaleString()} 篇 · 最多展示 20 条</span>
        </footer>
      </section>
    }
  </div>;
}

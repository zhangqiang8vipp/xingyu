"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArticleFrontstage, type ArticleDraft } from "./ArticleWritingStudio";

type CollabDocument={publicId:string;title:string;content:string;spaceId:number;spaceName:string};
type Props={
  publicId?:string;
  draft?:ArticleDraft;
  spaceName:string;
  authorName:string;
  avatarUrl:string;
  onClose:()=>void;
  escapeCloses?:boolean;
};

/**
 * One preview for every knowledge-space document: the exact ArticleFrontstage
 * iframe already used by the standard article editor and writing studio.
 * It renders PostPageView, not a separate collaboration-flavored Markdown UI.
 */
export default function AdminDocumentPreviewDialog({
  publicId,draft,spaceName,authorName,avatarUrl,onClose,escapeCloses=true,
}:Props){
  const [loaded,setLoaded]=useState<ArticleDraft|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(Boolean(publicId&&!draft));
  useEffect(()=>{
    if(draft||!publicId)return;
    const controller=new AbortController();
    void (async()=>{
      try{
        const response=await fetch("/api/space-collaboration/documents/"+encodeURIComponent(publicId),{
          cache:"no-store",credentials:"same-origin",signal:controller.signal,
        });
        const data=await response.json() as {document?:CollabDocument;error?:string};
        if(!response.ok||!data.document)throw new Error(data.error??"文档无法打开");
        if(controller.signal.aborted)return;
        setLoaded({
          publicId:data.document.publicId,title:data.document.title,content:data.document.content,
          excerpt:"",publishedAt:null,status:"draft",spaceId:data.document.spaceId,
          spacePath:data.document.spaceName,
        });
      }catch(cause){
        if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"文档暂时无法预览");
      }finally{if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>controller.abort();
  },[draft,publicId]);

  useEffect(()=>{
    if(!escapeCloses)return;
    const dismiss=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    window.addEventListener("keydown",dismiss);
    return()=>window.removeEventListener("keydown",dismiss);
  },[escapeCloses,onClose]);
  useEffect(()=>{
    const old=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{document.body.style.overflow=old;};
  },[]);

  const active=draft??loaded;
  if(typeof document==="undefined")return null;
  return createPortal(
    <div className="writing-studio mode-reading space-document-frontstage" role="dialog" aria-modal="true" aria-label="真实文章前台预览">
      <header>
        <div className="writing-studio-brand"><i style={{background:"#0A84FF"}}/>
          <span>真实前台预览</span><b>{active?.title??"知识空间文档"}</b></div>
        <div className="writing-studio-actions"><span>与普通文章使用同一套预览</span>
          <button type="button" onClick={onClose}>完成</button></div>
      </header>
      <main>{active?<ArticleFrontstage key={active.publicId??"knowledge-draft"}
        draft={active} categoryName={active.spacePath??spaceName} categoryColor="#0A84FF"
        authorName={authorName} avatarUrl={avatarUrl}/>:
        <div className="space-document-preview-status" role={error?"alert":"status"}>
          {loading?"正在读取知识空间文档…":error||"文档暂时无法预览"}
        </div>}</main>
    </div>,
    document.body,
  );
}

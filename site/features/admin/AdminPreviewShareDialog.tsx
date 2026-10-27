"use client";

import { useEffect, useState } from "react";
import { readApiJson } from "@/app/api-response";

type PreviewLink={id:number;expiresAt:number;createdAt:string;revokedAt:string|null;lastViewedAt:string|null;viewCount:number;active:boolean};

export default function AdminPreviewShareDialog({post,onClose,apiPath}:{post:{id:number;title:string};onClose:()=>void;apiPath?:string}){
  const endpoint=apiPath??`/api/posts/${post.id}/preview-links`;
  const [links,setLinks]=useState<PreviewLink[]>([]);
  const [lifetime,setLifetime]=useState(7*24*60*60);
  const [generatedUrl,setGeneratedUrl]=useState("");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const [working,setWorking]=useState(false);

  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      const response=await fetch(endpoint,{cache:"no-store",signal:controller.signal});
      const data=await readApiJson<{links:PreviewLink[]}>(response);
      if(controller.signal.aborted)return;
      if(response.ok)setLinks(data.links??[]);else setMessage(data.error??"读取预览链接失败");
      setLoading(false);
    })().catch((error:unknown)=>{
      if(controller.signal.aborted)return;
      setMessage(error instanceof Error?error.message:"读取预览链接失败");
      setLoading(false);
    });
    return()=>controller.abort();
  },[endpoint]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose()};
    window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);
  },[onClose]);

  async function create(){
    setWorking(true);setMessage("");setGeneratedUrl("");
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lifetimeSeconds:lifetime})});
    const data=await readApiJson<{url:string;link:PreviewLink}>(response);
    if(response.ok){setGeneratedUrl(data.url);setLinks((current)=>[data.link,...current]);setMessage("新链接已生成。原始令牌只在本次窗口中显示，请立即复制。")}
    else setMessage(data.error??"预览链接生成失败");
    setWorking(false);
  }

  async function copy(){
    if(!generatedUrl)return;
    await navigator.clipboard.writeText(generatedUrl);
    setMessage("预览链接已复制，可以发送给受邀读者。关闭窗口后不会再显示该令牌。");
  }

  async function revoke(previewId:number){
    const response=await fetch(endpoint,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({previewId})});
    if(response.ok){setLinks((current)=>current.map((link)=>link.id===previewId?{...link,active:false,revokedAt:new Date().toISOString()}:link));setMessage("链接已撤销，继续访问会立即失效。")}
    else setMessage("链接撤销失败，请稍后再试");
  }

  return <div className="preview-share-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}>
    <section className="preview-share-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-share-title">
      <header><div><small>PRIVATE PREVIEW</small><h2 id="preview-share-title">邀请预览</h2><p>《{post.title}》</p></div><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="preview-share-security"><i>◇</i><div><b>单篇、只读、可撤销</b><span>受邀者无法进入后台、搜索私密文章或浏览相邻内容。</span></div></div>
      <div className="preview-share-create"><label>有效期限<select value={lifetime} onChange={(event)=>setLifetime(Number(event.target.value))}><option value={24*60*60}>24 小时</option><option value={7*24*60*60}>7 天</option><option value={30*24*60*60}>30 天</option></select></label><button type="button" onClick={()=>void create()} disabled={working}>{working?"正在生成…":"生成新链接"}</button></div>
      {generatedUrl&&<div className="preview-share-result"><div><small>仅显示一次</small><code>{generatedUrl}</code></div><button type="button" onClick={()=>void copy()}>复制链接</button></div>}
      {message&&<p className="preview-share-message">{message}</p>}
      <div className="preview-share-list"><div><b>链接记录</b><span>{links.filter((link)=>link.active).length} 个有效</span></div>{loading?<p>正在读取…</p>:links.length?links.map((link)=><article key={link.id} className={link.active?"active":"inactive"}><i/><div><b>{link.active?"可访问":"已失效"}</b><span>有效至 {formatDate(link.expiresAt*1000)} · 已打开 {link.viewCount} 次</span>{link.lastViewedAt&&<small>最近访问 {formatDate(link.lastViewedAt)}</small>}</div>{link.active&&<button type="button" onClick={()=>void revoke(link.id)}>撤销</button>}</article>):<p>还没有生成过预览链接。</p>}</div>
      <footer><span>令牌不会以明文保存在服务器中。</span><button type="button" onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}

function formatDate(value:string|number){
  return new Date(value).toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
}

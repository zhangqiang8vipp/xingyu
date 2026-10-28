"use client";

import { useCallback, useEffect, useState } from "react";
import BlogHomeExperience, { type BlogHomePost } from "../home/BlogHomeExperience";
import { readApiJson } from "@/app/api-response";
import type { SiteSettingsForm } from "./AdminSettingsPanel";
import type { AdminCategory, AdminStats } from "./admin-types";
import type { AdminBrowseVisibility } from "@/domain/admin/location";

export type { AdminBrowseVisibility } from "@/domain/admin/location";

export default function AdminBrowsePanel({
  settings,
  categories,
  stats,
  category,
  visibility,
  onCategoryChange,
  onVisibilityChange,
  onEdit,
  onWrite,
  onOpenArticles,
  onOpenSpaces,
  isPersonalAccount=false,
}:{
  settings:SiteSettingsForm;
  categories:AdminCategory[];
  stats:AdminStats;
  category:string;
  visibility:AdminBrowseVisibility;
  onCategoryChange:(category:string)=>void;
  onVisibilityChange:(visibility:AdminBrowseVisibility)=>void;
  onEdit:(postId:number)=>void;
  onWrite:()=>void;
  onOpenArticles:()=>void;
  onOpenSpaces:(spaceId?:number)=>void;
  isPersonalAccount?:boolean;
}){
  const [posts,setPosts]=useState<BlogHomePost[]>([]);
  const [loading,setLoading]=useState(true);
  const [health,setHealth]=useState<{schema:{code:string;database:string|null};audit:Record<string,number>;ownerPresent:boolean;queue:{pendingCleanup:number};generatedAt:string}|null>(null);
  const [healthError,setHealthError]=useState(false);
  const [checking,setChecking]=useState(false);
  const checkHealth=useCallback(async(signal?:AbortSignal)=>{
    setChecking(true);
    try{
      const response=await fetch("/api/admin/diagnostics",{cache:"no-store",signal});
      if(!response.ok)throw new Error("diagnostics unavailable");
      const data=await readApiJson<NonNullable<typeof health>>(response);
      if(!signal?.aborted){setHealth(data);setHealthError(false);}
    }catch{if(!signal?.aborted)setHealthError(true);}
    finally{if(!signal?.aborted)setChecking(false);}
  },[]);
  useEffect(()=>{
    if(isPersonalAccount)return;
    const controller=new AbortController();
    const task=window.setTimeout(()=>void checkHealth(controller.signal),0);
    return()=>{window.clearTimeout(task);controller.abort();};
  },[checkHealth,isPersonalAccount]);
  const integrityIssues=health?Object.values(health.audit).reduce((sum,n)=>sum+n,0):0;
  const healthy=health&&integrityIssues===0&&health.schema.code===health.schema.database&&health.ownerPresent;


  const load=useCallback(async(signal:AbortSignal)=>{
    setLoading(true);
    try{
      if (isPersonalAccount) {
        const kinds = visibility === "all" ? ["mine", "public"] : [visibility === "private" ? "mine" : "public"];
        const responses = await Promise.all(kinds.map((kind) => fetch(`/api/knowledge/posts?type=${kind}&limit=50`, { signal, cache: "no-store" })));
        if (responses.some((response) => !response.ok)) throw new Error("browse failed");
        const payloads = await Promise.all(responses.map((response) => readApiJson<{posts:Record<string,unknown>[]}>(response)));
        const rows = payloads.flatMap((payload, index) => (payload.posts ?? []).map((post) => {
          const isPublic = kinds[index] === "public";
          return {
            id: Number(post.id), publicId: String(post.publicId), title: String(post.title), slug: String(post.slug),
            excerpt: String(post.excerpt ?? ""), contentLength: typeof post.content === "string" ? post.content.length : undefined,
            status: isPublic ? "published" as const : "draft" as const, viewCount: Number(post.viewCount ?? 0),
            publishedAt: isPublic && typeof post.publishedAt === "string" ? post.publishedAt : null,
            updatedAt: String(post.updatedAt ?? post.publishedAt ?? ""), categoryName: typeof post.categoryName === "string" ? post.categoryName : (isPublic ? "公开文章" : "个人文章"),
            categorySlug: typeof post.categorySlug === "string" ? post.categorySlug : null,
            categoryColor: typeof post.categoryColor === "string" ? post.categoryColor : "#8E8E93",
            spaceId: isPublic ? null : Number(post.spaceId ?? 0), spacePath: isPublic ? null : "个人知识空间",
            visibility: isPublic ? "public" as const : "personal" as const, canEdit: !isPublic,
          };
        }));
        const filtered = rows.filter((post) => category === "all" || post.categorySlug === category);
        setPosts(filtered.slice(0, Math.min(18, Math.max(8, settings.homePostLimit))));
      } else {
        const params=new URLSearchParams({
          scope:visibility,
          pageSize:String(Math.min(18,Math.max(8,settings.homePostLimit))),
          status:"all",
          category,
        });
        const response=await fetch(`/api/posts?${params}`,{signal});
        if(!response.ok)throw new Error("browse failed");
        setPosts((await readApiJson<{rows:BlogHomePost[]}>(response)).rows??[]);
      }
    }catch(error){
      if(!(error instanceof DOMException&&error.name==="AbortError"))setPosts([]);
    }finally{
      if(!signal.aborted)setLoading(false);
    }
  },[category,settings.homePostLimit,visibility,isPersonalAccount]);

  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(()=>void load(controller.signal),80);
    return()=>{window.clearTimeout(timer);controller.abort()};
  },[load]);

  return <section className="admin-main admin-browse admin-public-browser">
    <div className="admin-browser-context">
      <div><i/><span>{isPersonalAccount?"个人内容浏览":"管理员浏览"}</span><b>{isPersonalAccount?stats.total:stats.total+stats.privateArticles} 篇内容</b></div>
      <p>{isPersonalAccount?"沿用原有浏览界面；个人文章仅自己可编辑，公开文章可直接阅读。":"这里与公开博客共用首页、卡片和完整阅读器；草稿与知识空间仅管理员可见。"}</p>
    </div>
    {!isPersonalAccount&&<section className="admin-runtime-summary" aria-label="站点运行摘要" style={{display:"grid",gap:10,margin:"12px 0 20px",padding:16,border:"1px solid var(--admin-line)",borderRadius:18}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}><strong>站点运行摘要</strong><button type="button" disabled={checking} onClick={()=>void checkHealth()}>{checking?"检查中…":"重新检查"}</button></div>
      <div style={{display:"flex",gap:18,flexWrap:"wrap"}}><span>公开文章 <b>{stats.published}</b></span><span>草稿 <b>{stats.drafts}</b></span><span>私有文章 <b>{stats.privateArticles}</b></span><span>累计阅读 <b>{stats.views}</b></span></div>
      <p role="status" style={{margin:0}}>{healthError?"健康检查不可用，请重试或查看服务端日志":!health?"正在检查数据库完整性…":healthy?"数据库关系与版本检查正常":`需要关注：${integrityIssues} 项关系异常${health.schema.code!==health.schema.database?"；数据库版本不一致":""}${!health.ownerPresent?"；站点所有者缺失":""}`}</p>
      {health&&<small>待清理附件 {health.queue.pendingCleanup} · 检查于 {new Date(health.generatedAt).toLocaleString("zh-CN")}</small>}
    </section>}
    {loading&&!posts.length?<div className="admin-public-browser-loading"><i/><i/><i/><span>正在打开真实博客视图</span></div>:<BlogHomeExperience
      mode="admin"
      settings={settings}
      categories={categories}
      posts={posts}
      selectedCategory={category}
      visibility={visibility}
      personalAccount={isPersonalAccount}
      onCategoryChange={onCategoryChange}
      onVisibilityChange={onVisibilityChange}
      onEdit={onEdit}
      onWrite={onWrite}
      onOpenArticles={onOpenArticles}
      onOpenSpaces={()=>onOpenSpaces()}
    />}
  </section>;
}

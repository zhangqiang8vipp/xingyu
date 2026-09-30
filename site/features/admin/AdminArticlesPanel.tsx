"use client";

import type { AdminCategory, AdminPost, AdminStats } from "./admin-types";

export default function AdminArticlesPanel({
  brandName,
  stats,
  posts,
  categories,
  loading,
  message,
  query,
  category,
  status,
  batch,
  hasPrevious,
  hasNext,
  onQueryChange,
  onCategoryChange,
  onStatusChange,
  onNew,
  onBrowse,
  onShare,
  onEdit,
  onRemove,
  onPrevious,
  onNext,
}:{
  brandName:string;
  stats:AdminStats;
  posts:AdminPost[];
  categories:AdminCategory[];
  loading:boolean;
  message:string;
  query:string;
  category:string;
  status:string;
  batch:number;
  hasPrevious:boolean;
  hasNext:boolean;
  onQueryChange:(value:string)=>void;
  onCategoryChange:(value:string)=>void;
  onStatusChange:(value:string)=>void;
  onNew:()=>void;
  onBrowse:(postId:number)=>void;
  onShare:(post:{id:number;title:string})=>void;
  onEdit:(postId:number)=>void;
  onRemove:(post:AdminPost)=>void;
  onPrevious:()=>void;
  onNext:()=>void;
}){
  return <section className="admin-main">
    <header className="admin-header"><div><p>CONTENT</p><h1>文章管理</h1><span>管理、筛选并发布{brandName}的全部内容。</span></div><button className="new-button" onClick={onNew}>＋ 新建文章</button></header>
    {message&&<p className="form-message" role="alert">{message}</p>}
    <div className="stats admin-real-stats"><div><span>全部文章</span><b>{stats.total.toLocaleString()}</b></div><div><span>已发布</span><b>{stats.published.toLocaleString()}</b></div><div><span>草稿</span><b>{stats.drafts.toLocaleString()}</b></div><div><span>总阅读量</span><b>{stats.views.toLocaleString()}</b></div></div>
    <div className="table-tools">
      <div className="admin-search"><span>⌕</span><input value={query} onChange={(event)=>onQueryChange(event.target.value)} placeholder="全文搜索标题、摘要或正文"/></div>
      <select value={category} onChange={(event)=>onCategoryChange(event.target.value)}><option value="all">全部分类</option>{categories.map((item)=><option key={item.id} value={item.slug}>{item.name}</option>)}</select>
      <select value={status} onChange={(event)=>onStatusChange(event.target.value)}><option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option></select>
    </div>
    <div className="table-wrap">
      <table><thead><tr><th>文章</th><th>分类</th><th>状态</th><th>浏览</th><th>发布时间</th><th>操作</th></tr></thead>
        <tbody>{loading?<tr><td colSpan={6} className="table-empty">正在读取文章…</td></tr>:posts.length===0?<tr><td colSpan={6} className="table-empty">没有符合条件的文章</td></tr>:posts.map((post)=><tr key={post.id}>
          <td data-label="文章"><div className="title-cell"><span>{post.id}</span><div><b>{post.title}</b><small>/{post.slug}</small></div></div></td>
          <td data-label="分类">{post.categoryName}</td>
          <td data-label="状态"><i className={`status ${post.status}`}/>{post.status==="published"?"已发布":"草稿"}</td>
          <td data-label="浏览">{post.viewCount.toLocaleString()}</td>
          <td data-label="发布">{post.publishedAt?new Date(post.publishedAt).toLocaleDateString("zh-CN"):"—"}</td>
          <td data-label="操作"><div className="row-actions"><button onClick={()=>onBrowse(post.id)}>浏览</button><button onClick={()=>onShare(post)}>分享预览</button><button onClick={()=>onEdit(post.id)}>编辑</button><button className="danger" onClick={()=>onRemove(post)}>删除</button></div></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="table-footer"><span>游标分页 · 第 {batch} 批{posts.length?` · 当前 ${posts.length} 篇`:""}</span><div><button disabled={!hasPrevious} onClick={onPrevious}>←</button><button disabled={!hasNext} onClick={onNext}>→</button></div></div>
  </section>;
}

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
  isPersonalAccount = false,
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
  isPersonalAccount?:boolean;
}){
  const filtered=Boolean(query.trim()||category!=="all"||status!=="all");
  const resetFilters=()=>{
    onQueryChange("");
    onCategoryChange("all");
    onStatusChange("all");
  };
  return <section className="admin-main axis-admin-list-page">
    <header className="admin-header"><div><p>CONTENT</p><h1>文章管理</h1><span>{isPersonalAccount ? "沿用统一的文章管理界面；只显示自己的文章和公开文章。" : `管理、筛选并发布${brandName}的全部内容。`}</span></div><button className="new-button" onClick={onNew}>＋ 新建文章</button></header>
    {message&&<p className="form-message" role="status">{message}</p>}
    <div className="stats admin-real-stats"><div><span>全部文章</span><b>{stats.total.toLocaleString()}</b></div><div><span>已发布</span><b>{stats.published.toLocaleString()}</b></div><div><span>草稿</span><b>{stats.drafts.toLocaleString()}</b></div><div><span>总阅读量</span><b>{stats.views.toLocaleString()}</b></div></div>
    <div className="table-tools">
      <div className="admin-search"><span>⌕</span><input value={query} onChange={(event)=>onQueryChange(event.target.value)} placeholder="全文搜索标题、摘要或正文" aria-label="搜索文章标题、摘要或正文"/></div>
      <select aria-label="按分类筛选文章" value={category} onChange={(event)=>onCategoryChange(event.target.value)}><option value="all">全部分类</option>{categories.map((item)=><option key={item.id} value={item.slug}>{item.name}</option>)}</select>
      <select aria-label="按发布状态筛选文章" value={status} onChange={(event)=>onStatusChange(event.target.value)}><option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option></select>
      {filtered&&<button className="axis-filter-clear" type="button" onClick={resetFilters} aria-label="清除所有文章筛选">清除筛选 ×</button>}
    </div>
    <p className="axis-table-context" role="status" aria-live="polite">
      {loading?"正在筛选文章…":filtered?`当前条件下找到 ${posts.length} 篇文章（本批）`:`当前显示 ${posts.length} 篇文章`}
    </p>
    <div className="table-wrap">
      <table aria-label="文章列表"><thead><tr><th>文章</th><th>分类</th><th>状态</th><th>浏览</th><th>发布时间</th><th>操作</th></tr></thead>
        <tbody>{loading?<tr><td colSpan={6} className="table-empty">正在读取文章…</td></tr>:posts.length===0?<tr><td colSpan={6} className="table-empty">{filtered?"没有找到匹配文章，试试清除筛选":"还没有文章，使用右上角「新建文章」开始创作"}</td></tr>:posts.map((post)=><tr key={post.id}>
          <td data-label="文章"><div className="title-cell"><span>{post.id}</span><div><b>{post.title}</b><small>/{post.slug}</small></div></div></td>
          <td data-label="分类">{post.categoryName}</td>
          <td data-label="状态"><i className={`status ${post.status}`}/>{isPersonalAccount ? (post.visibility === "public" ? "公开文章" : "个人文章") : post.status==="published"?"已发布":"草稿"}</td>
          <td data-label="浏览">{post.viewCount.toLocaleString()}</td>
          <td data-label="发布">{post.publishedAt?new Date(post.publishedAt).toLocaleDateString("zh-CN"):"—"}</td>
          <td data-label="操作"><div className="row-actions"><button type="button" aria-label={"浏览《"+post.title+"》"} onClick={()=>onBrowse(post.id)}>浏览</button>{!isPersonalAccount && <button type="button" aria-label={"分享《"+post.title+"》的预览"} onClick={()=>onShare(post)}>分享预览</button>}{(!isPersonalAccount || post.canEdit) && <><button type="button" aria-label={"编辑《"+post.title+"》"} onClick={()=>onEdit(post.id)}>编辑</button><button className="danger" type="button" aria-label={"删除《"+post.title+"》"} onClick={()=>onRemove(post)}>删除</button></>}</div></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="table-footer"><span>游标分页 · 第 {batch} 批{posts.length?` · 当前 ${posts.length} 篇`:""}</span><div><button type="button" aria-label="上一批文章" disabled={!hasPrevious} onClick={onPrevious}>←</button><button type="button" aria-label="下一批文章" disabled={!hasNext} onClick={onNext}>→</button></div></div>
  </section>;
}

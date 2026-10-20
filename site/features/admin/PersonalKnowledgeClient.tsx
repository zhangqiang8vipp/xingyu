"use client";

import { useCallback, useEffect, useState, type FormEvent, type ChangeEvent } from "react";
import { readApiJson } from "@/app/api-response";
import AdminSidebar from "./AdminSidebar";
import type { AdminCategory, AdminPost, AdminStats, ArticleForm } from "./admin-types";
import type { SiteSettingsForm } from "./AdminSettingsPanel";
import "@/app/admin/admin.css";

type PostItem = AdminPost & {
  content?: string;
  visibility?: "personal" | "public";
  canEdit?: boolean;
  publicUrl?: string;
};
type FileItem = {
  id:string; filename:string; contentType:string; size:number; createdAt:string;
  articlePublicId:string; articleTitle:string; articleSlug:string;
  visibility:"personal"|"public"; url:string;
};
type ApiPayload = {
  error?:string; posts?:PostItem[]; files?:FileItem[]; post?:PostItem;
  workspaceId?:number; nextCursor?:string|null; hasMore?:boolean;
  stats?:{total:number;published:number;drafts:number;views:number};
  categories?:AdminCategory[];
};
type Section = "browse" | "articles";
const emptyStats:AdminStats={total:0,published:0,drafts:0,views:0,privateArticles:0};
const emptyForm=(categoryId:number):ArticleForm=>({
  title:"",slug:"",excerpt:"",content:"",categoryId,spaceId:null,sortOrder:0,
  status:"draft",featured:false,publishedAt:null
});
async function api(path:string,init?:RequestInit):Promise<ApiPayload>{
  const response=await fetch(path,{credentials:"same-origin",cache:"no-store",...init});
  const data=await response.json().catch(()=>({})) as ApiPayload;
  if(!response.ok)throw new Error(data.error||"请求失败");
  return data;
}
function formatBytes(size:number){
  if(size<1024)return size+" B";
  if(size<1024*1024)return (size/1024).toFixed(1)+" KB";
  return (size/(1024*1024)).toFixed(1)+" MB";
}

export default function PersonalKnowledgeClient({userName,settings}:{userName:string;settings:SiteSettingsForm}){
  const [section,setSection]=useState<Section>("articles");
  const [tab,setTab]=useState<"mine"|"public"|"files">("mine");
  const [query,setQuery]=useState("");
  const [appliedQuery,setAppliedQuery]=useState("");
  const [mine,setMine]=useState<PostItem[]>([]);
  const [publicPosts,setPublicPosts]=useState<PostItem[]>([]);
  const [files,setFiles]=useState<FileItem[]>([]);
  const [categories,setCategories]=useState<AdminCategory[]>([]);
  const [workspaceId,setWorkspaceId]=useState<number|null>(null);
  const [stats,setStats]=useState<AdminStats>(emptyStats);
  const [cursor,setCursor]=useState<string|null>(null);
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [form,setForm]=useState<ArticleForm|null>(null);
  const [editingPost,setEditingPost]=useState<PostItem|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const q=encodeURIComponent(appliedQuery);
      const [mineData,publicData,fileData]=await Promise.all([
        api("/api/knowledge/posts?type=mine&limit=50&q="+q+(cursor?"&cursor="+encodeURIComponent(cursor):"")),
        api("/api/knowledge/posts?type=public&limit=50&q="+q),
        api("/api/knowledge/files?limit=100&q="+q)
      ]);
      setMine(mineData.posts??[]);
      setPublicPosts(publicData.posts??[]);
      setFiles(fileData.files??[]);
      setWorkspaceId(mineData.workspaceId??null);
      setCategories(mineData.categories??[]);
      setNextCursor(mineData.nextCursor??null);
      if(mineData.stats)setStats({...mineData.stats,privateArticles:0});
    }catch(error){setMessage(error instanceof Error?error.message:"内容加载失败");}
    finally{setLoading(false);}
  },[appliedQuery,cursor]);

  useEffect(()=>{void load();},[load]);

  async function openPost(item:PostItem){
    setBusy(true);setMessage("");
    try{
      const data=await api("/api/knowledge/posts/"+encodeURIComponent(item.publicId));
      if(!data.post)throw new Error("文章不存在或无权访问");
      setEditingPost(data.post);
      setForm({
        id:data.post.id,publicId:data.post.publicId,version:data.post.version,
        title:data.post.title,slug:data.post.slug,excerpt:data.post.excerpt??"",
        content:data.post.content??"",categoryId:data.post.categoryId??categories[0]?.id??1,
        spaceId:data.post.spaceId??null,sortOrder:data.post.sortOrder??0,
        status:data.post.status,featured:Boolean(data.post.featured),publishedAt:data.post.publishedAt??null
      });
    }catch(error){setMessage(error instanceof Error?error.message:"文章读取失败");}
    finally{setBusy(false);}
  }
  function newDraft(){
    setEditingPost(null);
    setForm(emptyForm(categories[0]?.id??1));
    setMessage("");
    setSection("articles");
    setTab("mine");
  }
  function closeEditor(){setForm(null);setEditingPost(null);setMessage("");}

  async function save(event:FormEvent){
    event.preventDefault();
    if(!form||!form.title.trim()){setMessage("请输入文章标题");return;}
    setBusy(true);setMessage("");
    try{
      const payload={
        title:form.title,slug:form.slug,excerpt:form.excerpt,content_markdown:form.content,
        category:categories.find(item=>item.id===form.categoryId)?.slug,
        status:form.status,featured:form.featured,sort_order:form.sortOrder,
        published_at:form.publishedAt,expected_version:form.version
      };
      const data=editingPost
        ? await api("/api/knowledge/posts/"+encodeURIComponent(editingPost.publicId),{
            method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
          })
        : await api("/api/knowledge/posts",{
            method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
          });
      if(!data.post)throw new Error("保存结果无法读取");
      setMessage(form.status==="published"?"已保存。个人文章仍只在你的个人区域可见。":"草稿已保存，仅你自己可见。");
      setForm(null);setEditingPost(null);
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"保存失败");}
    finally{setBusy(false);}
  }
  async function remove(post:PostItem){
    if(!window.confirm("确定删除《"+post.title+"》吗？此操作不可撤销。"))return;
    try{
      const fresh=await api("/api/knowledge/posts/"+encodeURIComponent(post.publicId));
      const version=fresh.post?.version??post.version;
      await api("/api/knowledge/posts/"+encodeURIComponent(post.publicId),{
        method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_version:version})
      });
      if(editingPost?.publicId===post.publicId)closeEditor();
      setMessage("文章已删除");
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:"删除失败");}
  }
  async function upload(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value="";
    if(!file)return;
    if(!workspaceId||!form?.id||!editingPost){setMessage("请先保存文章，再上传附件");return;}
    setBusy(true);
    try{
      const body=new FormData();body.set("file",file);body.set("post_identifier",editingPost.publicId);
      const response=await fetch("/api/workspaces/"+workspaceId+"/attachments",{method:"POST",credentials:"same-origin",body});
      const data=await response.json().catch(()=>({})) as {error?:string;attachment?:{filename:string;content_type:string;url:string}};
      if(!response.ok||!data.attachment)throw new Error(data.error||"附件上传失败");
      const a=data.attachment;
      const snippet=a.content_type.startsWith("image/")?"!["+a.filename+"]("+a.url+")":"["+a.filename+"]("+a.url+")";
      setForm(current=>current?{...current,content:current.content+(current.content&&!current.content.endsWith("\n")?"\n":"")+"\n"+snippet+"\n"}:current);
      setMessage("附件已上传，保存文章后正文引用才会生效。");
    }catch(error){setMessage(error instanceof Error?error.message:"附件上传失败");}
    finally{setBusy(false);}
  }
  async function signOut(){
    setBusy(true);
    try{
      const response=await fetch("/api/identity/logout",{method:"POST",credentials:"same-origin"});
      if(!response.ok)throw new Error("退出失败，请重试");
      window.location.replace("/login?return_to=%2Fadmin");
    }catch(error){setMessage(error instanceof Error?error.message:"退出失败");}
    finally{setBusy(false);}
  }

  const currentPosts=tab==="mine"?mine:publicPosts;
  const onSidebarSection=(next:string)=>{if(next==="browse"||next==="articles"){setSection(next);if(next==="browse")setTab("public");else setTab("mine");setForm(null);}};
  return <main className="admin-shell">
    <AdminSidebar brandName={settings.brandName} avatarUrl={settings.avatarUrl} authorName={settings.authorName}
      userName={userName} section={section} stats={stats} categoryCount={categories.length}
      collapsed={false} isPersonal onSectionChange={onSidebarSection} onToggle={()=>{}} onSignOut={()=>void signOut()}/>
    <div className="admin-workspace">
      <div className="admin-workspace-bar"><div className="admin-article-search-trigger personal-search"><i>⌕</i><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){setCursor(null);setAppliedQuery(query.trim());}}} placeholder="搜索我的文章与公开内容"/></div></div>
      <section className="admin-main">
        <header className="admin-header">
          <div><p>{section==="browse"?"READING":"PERSONAL CONTENT"}</p><h1>{section==="browse"?"浏览公开文章":"文章管理"}</h1><span>{section==="browse"?"阅读站点已发布的公开内容。":"管理你自己的文章。个人内容与站点内容相互隔离。"}</span></div>
          {section==="articles"&&<button className="new-button" type="button" onClick={newDraft}>＋ 新建文章</button>}
        </header>
        {message&&<p className="form-message" role="status">{message}</p>}
        {section==="articles"&&<>
          <div className="stats admin-real-stats"><div><span>我的文章</span><b>{stats.total.toLocaleString()}</b></div><div><span>已完成</span><b>{stats.published.toLocaleString()}</b></div><div><span>草稿</span><b>{stats.drafts.toLocaleString()}</b></div><div><span>阅读量</span><b>{stats.views.toLocaleString()}</b></div></div>
          <div className="table-tools">
            <div className="admin-search"><span>⌕</span><input value={appliedQuery} onChange={e=>{setAppliedQuery(e.target.value);setCursor(null);}} placeholder="筛选标题、摘要或 Slug"/></div>
            <div className="personal-tabs"><button className={tab==="mine"?"active":""} onClick={()=>setTab("mine")}>我的文章</button><button className={tab==="public"?"active":""} onClick={()=>setTab("public")}>公开文章</button><button className={tab==="files"?"active":""} onClick={()=>setTab("files")}>文件</button></div>
          </div>
          <div className="table-wrap"><table><thead><tr><th>文章 / 文件</th><th>分类 / 来源</th><th>状态</th><th>更新 / 大小</th><th>操作</th></tr></thead>
            <tbody>{loading?<tr><td colSpan={5} className="table-empty">正在读取内容…</td></tr>:tab==="files"?(files.length?files.map(file=><tr key={file.id}><td><div className="title-cell"><div><b>{file.filename}</b><small>{file.articleTitle}</small></div></div></td><td>{file.visibility==="public"?"公开文件":"我的文件"}</td><td>附件</td><td>{formatBytes(file.size)}</td><td><div className="row-actions"><a href={file.url} target="_blank" rel="noreferrer">打开</a></div></td></tr>):<tr><td colSpan={5} className="table-empty">没有附件</td></tr>):(currentPosts.length?currentPosts.map(post=><tr key={post.publicId}><td><div className="title-cell"><span>{post.id}</span><div><b>{post.title}</b><small>/{post.slug}</small></div></div></td><td>{post.categoryName??"文章"}</td><td><i className={"status "+post.status}/>{tab==="public"?"公开文章":post.status==="published"?"已完成":"草稿"}</td><td>{new Date(post.updatedAt).toLocaleDateString("zh-CN")}</td><td><div className="row-actions">{tab==="mine"?<><button onClick={()=>void openPost(post)}>编辑</button><button className="danger" onClick={()=>void remove(post)}>删除</button></>:<a href={post.publicUrl??("/posts/"+post.publicId+"/"+post.slug)} target="_blank" rel="noreferrer">阅读 ↗</a>}</div></td></tr>):<tr><td colSpan={5} className="table-empty">{tab==="mine"?"还没有文章，点击右上角新建。":"暂时没有公开文章。"}</td></tr>)}</tbody>
          </table></div>
          {tab==="mine"&&<div className="table-footer"><span>个人文章按更新时间排序</span><div><button disabled={!cursor} onClick={()=>setCursor(null)}>回到第一页</button><button disabled={!nextCursor||loading} onClick={()=>setCursor(nextCursor)}>下一页 →</button></div></div>}
        </>}
        {section==="browse"&&<div className="personal-public-grid">{loading?<p>正在读取公开文章…</p>:publicPosts.length?publicPosts.map(post=><article className="personal-public-card" key={post.publicId}><small>{post.categoryName??"公开文章"}</small><h2>{post.title}</h2><p>{post.excerpt}</p><a href={post.publicUrl??("/posts/"+post.publicId+"/"+post.slug)}>阅读文章 ↗</a></article>):<p className="table-empty">暂时没有公开文章。</p>}</div>}
      </section>
    </div>
    {form&&<div className="editor-backdrop" onMouseDown={e=>e.target===e.currentTarget&&closeEditor()}>
      <form className="editor-panel personal-editor-panel" onSubmit={e=>void save(e)}>
        <header className="editor-header"><div><small>{editingPost?"EDITING · PERSONAL ARTICLE":"COMPOSE · PERSONAL ARTICLE"}</small><h2>{editingPost?"编辑文章":"写一篇新文章"}</h2><p>文章只属于当前账号，不会修改站点首页或其他用户的数据。</p></div><div className="editor-header-actions"><span className={"editor-state "+form.status}>{form.status==="published"?"已完成":"草稿"}</span><button type="button" aria-label="关闭编辑器" onClick={closeEditor}>×</button></div></header>
        <div className="editor-form-body">
          <section className="editor-section"><div className="editor-section-title"><span>01</span><div><b>文章信息</b><small>标题、链接、分类与摘要</small></div></div>
            <label className="title-field">文章标题<input required maxLength={200} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="输入文章标题"/></label>
            <div className="form-row"><label>Slug<input value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})} placeholder="文章地址标识"/></label><label>分类<select value={form.categoryId} onChange={e=>setForm({...form,categoryId:Number(e.target.value)})}>{categories.map(cat=><option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label></div>
            <label>摘要<textarea rows={3} maxLength={1000} value={form.excerpt} onChange={e=>setForm({...form,excerpt:e.target.value})} placeholder="简短介绍文章内容"/></label>
          </section>
          <section className="editor-section"><div className="editor-section-title"><span>02</span><div><b>正文内容</b><small>支持 Markdown</small></div></div><textarea className="personal-markdown-editor" rows={18} maxLength={750000} value={form.content} onChange={e=>setForm({...form,content:e.target.value})} placeholder="从这里开始写作，支持 Markdown。"/></section>
          <section className="editor-section"><div className="editor-section-title"><span>03</span><div><b>保存设置</b><small>仅影响你的个人文章</small></div></div>
            <div className="form-row"><label>状态<select value={form.status} onChange={e=>setForm({...form,status:e.target.value as ArticleForm["status"]})}><option value="draft">保存为草稿</option><option value="published">标记为已完成</option></select></label><label>更新时间说明<input disabled value="个人内容不会发布到公开首页"/></label></div>
            {editingPost&&<label className="avatar-upload">上传附件<input type="file" onChange={e=>void upload(e)} disabled={busy}/><span>先保存文章后可上传附件</span></label>}
          </section>
          {message&&<p className="form-message" role="alert">{message}</p>}
        </div>
        <footer className="editor-footer"><span>个人数据隔离已启用</span><div><button type="button" onClick={closeEditor}>取消</button><button className="save-button" disabled={busy}>{busy?"正在保存…":form.status==="published"?"保存完成内容":"保存草稿"}<i>→</i></button></div></footer>
      </form>
    </div>}
  </main>;
}

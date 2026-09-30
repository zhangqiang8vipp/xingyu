"use client";

import { type Dispatch, type FormEvent, type RefObject, type SetStateAction, useState } from "react";
import { postPath } from "@/app/post-path";
import type { SiteSettingsForm } from "./AdminSettingsPanel";
import AdminSpacePicker from "./AdminSpacePicker";
import { ArticleFrontstage } from "./ArticleWritingStudio";
import VditorEditor from "./VditorEditor";
import type { AdminCategory, ArticleForm } from "./admin-types";

type SpaceChoice={id:number;name:string;path?:Array<{id:number;name:string}>};

function slugPreview(value:string){
  return value.trim().toLowerCase().replace(/\s+/g,"-").replace(/[^\p{L}\p{N}-]+/gu,"").replace(/-+/g,"-")||"your-article";
}

function toLocalDateTime(value?:string|null){
  if(!value)return "";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}

export default function AdminArticleEditor({
  form,
  category,
  categories,
  settings,
  message,
  previewRef,
  onChange,
  onChangeSpace,
  onClose,
  onOpenStudio,
  onSharePreview,
  onSave,
}:{
  form:ArticleForm;
  category?:AdminCategory;
  categories:AdminCategory[];
  settings:SiteSettingsForm;
  message:string;
  previewRef:RefObject<HTMLDivElement|null>;
  onChange:Dispatch<SetStateAction<ArticleForm|null>>;
  onChangeSpace:(choice:SpaceChoice|null)=>void;
  onClose:()=>void;
  onOpenStudio:(mode:"split"|"reading")=>void;
  onSharePreview?:()=>void;
  onSave:()=>Promise<void>;
}){
  const [slugCopied,setSlugCopied]=useState(false);
  function submit(event:FormEvent){
    event.preventDefault();
    void onSave();
  }

  return <div className="editor-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}>
    <form className="editor-panel" onSubmit={submit} onKeyDown={(event)=>{if((event.metaKey||event.ctrlKey)&&event.key==="Enter")event.currentTarget.requestSubmit()}}>
      <header className="editor-header">
        <div><small>{form.id?`EDITING · ARTICLE ${form.id}`:"COMPOSE · NEW ARTICLE"}</small><h2>{form.id?"编辑文章":"写一篇新文章"}</h2><p>编辑内容、检查链接，然后发布到{settings.brandName}。</p></div>
        <div className="editor-header-actions"><button className="editor-preview-button" type="button" onClick={()=>onOpenStudio("reading")}>即时预览 <b>↗</b></button>{form.id&&onSharePreview&&<button className="editor-share-button" type="button" onClick={onSharePreview}>邀请预览 <b>◇</b></button>}<span className={`editor-state ${form.status}`}>{form.status==="published"?(form.spaceId?"内容完成":"已发布"):"草稿"}</span><button type="button" aria-label="关闭编辑器" onClick={onClose}>×</button></div>
      </header>

      <div className="editor-form-body">
        <section className="editor-section metadata-section">
          <div className="editor-section-title"><span>01</span><div><b>文章信息</b><small>标题、链接与首页摘要</small></div></div>
          <label className="title-field">文章标题<input required value={form.title} onChange={(event)=>onChange({...form,title:event.target.value})} placeholder="输入一个清晰、有吸引力的标题"/></label>
          <div className="form-row"><label>Slug<input value={form.slug} onChange={(event)=>{onChange({...form,slug:event.target.value});setSlugCopied(false)}} placeholder="留空将根据标题自动生成"/></label><label>分类<select value={form.categoryId} onChange={(event)=>onChange({...form,categoryId:Number(event.target.value)})}>{categories.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          <label className="space-field">归属位置<AdminSpacePicker value={form.spaceId} path={form.spacePath} onChange={onChangeSpace}/></label>
          <div className="slug-preview">
            <div className="slug-icon">↗</div>
            <div className="slug-copy"><small>{form.spaceId?"私有知识文章 · 仅管理员与 MCP 可检索":"文章访问地址 · 永久 ID"}</small><p>{form.spaceId?<><span>知识空间</span><i>/</i><b>{form.spacePath||"已选空间"}</b></>:<><span>{settings.brandName}</span><i>/</i><span>posts</span><i>/</i>{form.publicId&&<><span>{form.publicId.slice(0,8)}…</span><i>/</i></>}<b>{slugPreview(form.slug||form.title)}</b></>}</p></div>
            <span className="slug-category" style={{color:category?.color}}>{form.spaceId?"私有":category?.name??"随笔"}</span>
            {!form.spaceId&&<button type="button" onClick={async()=>{const slug=slugPreview(form.slug||form.title);const path=form.publicId?postPath({publicId:form.publicId,slug}):`/posts/${slug}`;await navigator.clipboard.writeText(`${window.location.origin}${path}`);setSlugCopied(true)}}>{slugCopied?"已复制":"复制链接"}</button>}
          </div>
          <label>文章摘要<textarea rows={3} value={form.excerpt} onChange={(event)=>onChange({...form,excerpt:event.target.value})} placeholder="用一两句话告诉读者这篇文章讲什么"/></label>
        </section>

        <section className="editor-section writing-section">
          <div className="editor-section-title"><span>02</span><div><b>正文内容</b><small>专注写作，右侧同步预览</small></div><button className="writing-launch" type="button" onClick={()=>onOpenStudio("split")}><i>↗</i> 打开沉浸写作</button></div>
          <div className="md-field"><div className="md-field-head"><span>Markdown</span><span className="paste-status">输入 / 查看指令 · Ctrl+V 粘贴图片 · 右侧实时预览</span></div><div ref={previewRef} className="article-editor-workspace">
            <VditorEditor value={form.content} onChange={(content)=>onChange((current)=>current?{...current,content}:current)} previewMode="editor" attachments postId={form.id} postVersion={form.version} onPostVersionChange={(version)=>onChange((current)=>current?{...current,version}:current)}/>
            <div className="article-editor-preview"><div className="article-editor-preview-label"><i/>真实前台预览 <span>未保存内容实时同步</span></div><ArticleFrontstage draft={form} categoryName={category?.name??"随笔"} categoryColor={category?.color??"#8E8E93"} authorName={settings.authorName} avatarUrl={settings.avatarUrl}/></div>
          </div></div>
        </section>

        <section className="editor-section publish-section">
          <div className="editor-section-title"><span>03</span><div><b>发布设置</b><small>决定文章如何出现在前台</small></div></div>
          <div className="form-row"><label>{form.spaceId?"内容状态":"发布状态"}<select value={form.status} onChange={(event)=>onChange({...form,status:event.target.value as ArticleForm["status"]})}><option value="draft">保存为草稿</option><option value="published">{form.spaceId?"标记为内容完成":"立即发布"}</option></select></label><label>发布时间<input type="datetime-local" value={toLocalDateTime(form.publishedAt)} onChange={(event)=>onChange({...form,publishedAt:event.target.value?new Date(event.target.value).toISOString():null})}/></label></div>
          {form.spaceId&&<label>浏览顺序（仅与本空间直属文章比较，数字越小越靠前）<input type="number" step="1" value={form.sortOrder??0} onChange={(event)=>onChange({...form,sortOrder:Number(event.target.value)})}/></label>}
          {!form.spaceId&&<label className="check"><input type="checkbox" checked={form.featured} onChange={(event)=>onChange({...form,featured:event.target.checked})}/><span><b>设为精选文章</b><small>优先展示在首页首张大卡片</small></span></label>}
        </section>
        {message&&<p className="form-message">{message}</p>}
      </div>

      <footer className="editor-footer"><span>⌘ Enter 快速保存</span><div><button type="button" onClick={onClose}>取消</button><button className="save-button" type="submit">{form.spaceId?(form.status==="published"?"保存完成内容":"保存空间草稿"):form.status==="published"?"保存并发布":"保存草稿"}<i>→</i></button></div></footer>
    </form>
  </div>;
}

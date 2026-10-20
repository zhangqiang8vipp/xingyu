"use client";

import { FormEvent, useState } from "react";
import VditorEditor from "./VditorEditor";
import type { SiteSettingsForm } from "./AdminSettingsPanel";
import { ContentPageLivePreview } from "./AdminLivePreview";
import { readApiJson } from "@/app/api-response";

export type EditablePage = { slug:string; eyebrow:string; title:string; excerpt:string; content:string };

export default function AdminPageEditor({ initial, settings, kind, label, readOnly = false }: { initial:EditablePage; settings:SiteSettingsForm; kind:"about"|"connect"; label:string; readOnly?: boolean }) {
  const [form,setForm]=useState(initial); const [saving,setSaving]=useState(false); const [message,setMessage]=useState("");
  const [preview,setPreview]=useState(false);
  async function save(event:FormEvent){event.preventDefault();if(readOnly)return;setSaving(true);setMessage("");const response=await fetch(`/api/pages/${form.slug}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});const data=await readApiJson<{page:EditablePage}>(response);setSaving(false);if(!response.ok)return setMessage(data.error??"保存失败");setForm(data.page);setMessage("页面已发布，前台刷新后立即生效");}
  return <><section className="admin-main admin-config-main">
    <header className="admin-header"><div><p>{kind==="about"?"ABOUT EXPERIENCE":"AI CONNECTION"}</p><h1>{label}设置</h1><span>使用与文章相同的 Markdown 工作流维护独立页面。</span></div><button className="config-preview-link" type="button" onClick={()=>setPreview(true)}>即时预览 <b>↗</b></button></header>
    <form className="config-form page-config-form" onSubmit={save}><fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <section className="editor-section"><div className="editor-section-title"><span>01</span><div><b>页面封面</b><small>标题与简介沿用前台排版比例</small></div></div>
        <label>眉题<input value={form.eyebrow} onChange={e=>setForm({...form,eyebrow:e.target.value})} /></label>
        <label className="title-field">页面标题<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} /></label>
        <label>开场简介<textarea rows={4} value={form.excerpt} onChange={e=>setForm({...form,excerpt:e.target.value})} /></label>
        <div className="about-admin-preview"><div><small>{form.eyebrow}</small><b>{form.title}</b><p>{form.excerpt}</p></div><img src={settings.avatarUrl} alt={`${settings.authorName}头像`} /></div>
      </section>
      <section className="editor-section writing-section"><div className="editor-section-title"><span>02</span><div><b>页面正文</b><small>Markdown 编辑与实时预览</small></div><em>VDITOR · MARKDOWN</em></div>{readOnly?<pre className="page-readonly-markdown" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",minHeight:420,maxHeight:720,overflow:"auto",padding:16,borderRadius:12,border:"1px solid rgba(127,127,127,.25)"}}>{form.content}</pre>:<VditorEditor value={form.content} onChange={(content)=>setForm((current)=>({...current,content}))} />}</section>
      </fieldset>{readOnly&&<p className="form-message">站点页面仅管理员可以修改；当前账号可查看原版页面内容。</p>}<footer className="config-footer"><span>{message||(readOnly?"只读查看 · 页面内容由管理员维护":"正文样式与真实前台页面保持一致")}</span><button disabled={saving||readOnly} className="save-button">{saving?"正在保存…":`保存${label}页面`}<i>→</i></button></footer>
    </form>
  </section>{preview&&<ContentPageLivePreview page={form} settings={settings} kind={kind} onClose={()=>setPreview(false)}/>}</>;
}

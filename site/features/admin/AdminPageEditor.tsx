"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import VditorEditor from "./VditorEditor";
import type { SiteSettingsForm } from "./AdminSettingsPanel";
import { ContentPageLivePreview } from "./AdminLivePreview";
import { readApiJson } from "@/app/api-response";
import { useUnsavedAdminForm } from "./useUnsavedAdminForm";

export type EditablePage = { slug:string; eyebrow:string; title:string; excerpt:string; content:string };

export default function AdminPageEditor({ initial, settings, kind, label, readOnly = false }: { initial:EditablePage; settings:SiteSettingsForm; kind:"about"|"connect"; label:string; readOnly?: boolean }) {
  const [form,setForm]=useState(initial);
  const [saved,setSaved]=useState(initial);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const dirty=JSON.stringify(form)!==JSON.stringify(saved);
  useUnsavedAdminForm(dirty);
  const [preview,setPreview]=useState(false);
  const formRef=useRef<HTMLFormElement>(null);

  useEffect(()=>{
    const onSaveShortcut=(event:KeyboardEvent)=>{
      if(!(event.metaKey||event.ctrlKey)||event.key.toLowerCase()!=="s"
        ||event.altKey||event.shiftKey)return;
      event.preventDefault();
      if(!readOnly&&!saving&&dirty)formRef.current?.requestSubmit();
    };
    window.addEventListener("keydown",onSaveShortcut);
    return()=>window.removeEventListener("keydown",onSaveShortcut);
  },[readOnly,saving,dirty]);
  async function save(event:FormEvent) {
    event.preventDefault();
    if(readOnly||saving||!dirty)return;
    setSaving(true);
    setMessage("");
    try {
      const response=await fetch(`/api/pages/${form.slug}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(form),
      });
      const data=await readApiJson<{page:EditablePage}>(response);
      if(!response.ok||!data.page) {
        setMessage(data.error??"保存失败，修改仍保留在页面中");
        return;
      }
      setSaved(data.page);
      setForm(data.page);
      setMessage("页面已保存 · 前台刷新后生效");
    } catch {
      setMessage("网络异常，编辑内容仍保留，请重试保存");
    } finally {
      setSaving(false);
    }
  }
  return <><section className="admin-main admin-config-main">
    <header className="admin-header"><div><p>{kind==="about"?"ABOUT EXPERIENCE":"AI CONNECTION"}</p><h1>{label}设置</h1><span>使用与文章相同的 Markdown 工作流维护独立页面。</span></div><div className="config-header-actions"><button className="config-preview-link" type="button" onClick={()=>setPreview(true)}>即时预览 <b>↗</b></button>{dirty&&!readOnly&&<button className="axis-config-quick-save" type="button" onClick={()=>formRef.current?.requestSubmit()} disabled={saving}>{saving?"保存中…":"保存更改"}</button>}</div></header>
    <form ref={formRef} className="config-form page-config-form" onSubmit={save}><fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <section className="editor-section"><div className="editor-section-title"><span>01</span><div><b>页面封面</b><small>标题与简介沿用前台排版比例</small></div></div>
        <label>眉题<input value={form.eyebrow} onChange={e=>setForm({...form,eyebrow:e.target.value})} /></label>
        <label className="title-field">页面标题<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} /></label>
        <label>开场简介<textarea rows={4} value={form.excerpt} onChange={e=>setForm({...form,excerpt:e.target.value})} /></label>
        <div className="about-admin-preview"><div><small>{form.eyebrow}</small><b>{form.title}</b><p>{form.excerpt}</p></div><img src={settings.avatarUrl} alt={`${settings.authorName}头像`} /></div>
      </section>
      <section className="editor-section writing-section"><div className="editor-section-title"><span>02</span><div><b>页面正文</b><small>Markdown 编辑与实时预览</small></div><em>VDITOR · MARKDOWN</em></div>{readOnly?<pre className="page-readonly-markdown" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",minHeight:420,maxHeight:720,overflow:"auto",padding:16,borderRadius:12,border:"1px solid rgba(127,127,127,.25)"}}>{form.content}</pre>:<VditorEditor value={form.content} onChange={(content)=>setForm((current)=>({...current,content}))} />}</section>
      </fieldset>{readOnly&&<p className="form-message">站点页面仅管理员可以修改；当前账号可查看原版页面内容。</p>}<footer className="config-footer" data-axis-save-state={saving?"saving":dirty?"dirty":"saved"}><span role="status" aria-live="polite">{message||(readOnly?"只读查看 · 页面内容由管理员维护":dirty?"有未保存的修改 · 可先使用即时预览确认效果":"所有修改均已保存 · 与真实前台一致")}</span><button disabled={saving||readOnly||!dirty} aria-busy={saving} className="save-button">{saving?"正在保存…":`保存${label}页面`}<i>→</i></button></footer>
    </form>
  </section>{preview&&<ContentPageLivePreview page={form} settings={settings} kind={kind} onClose={()=>setPreview(false)}/>}</>;
}

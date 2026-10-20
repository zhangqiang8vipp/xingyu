"use client";

import { FormEvent, useState } from "react";
import { HomeLivePreview } from "./AdminLivePreview";
import { readApiJson } from "@/app/api-response";

export type SiteSettingsForm = {
  brandName:string; brandLatin:string; authorName:string; avatarUrl:string; tagline:string; description:string;
  heroLead:string; heroTail:string; homeSectionTitle:string; homeAboutTitle:string; homeAboutCopy:string;
  footerText:string; seoTitle:string; seoDescription:string; homePostLimit:number;
};

export default function AdminSettingsPanel({ initial, readOnly = false }: { initial: SiteSettingsForm; readOnly?: boolean }) {
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading,setUploading]=useState(false);
  const [preview,setPreview]=useState(false);
  const field = (key: keyof SiteSettingsForm, value: string | number) => setForm((current) => ({ ...current, [key]:value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    setSaving(true); setMessage("");
    const response = await fetch("/api/settings", { method:"PATCH", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(form) });
    const data = await readApiJson<{settings:SiteSettingsForm}>(response); setSaving(false);
    if (!response.ok) return setMessage(data.error ?? "保存失败");
    setForm(data.settings); setMessage("设置已保存，前台刷新后立即生效");
  }
  async function uploadAvatar(file:File){setUploading(true);const body=new FormData();body.set("file",file);const response=await fetch("/api/media",{method:"POST",body});const data=await readApiJson<{url:string}>(response);setUploading(false);if(!response.ok)return setMessage(data.error??"头像上传失败");field("avatarUrl",data.url);setMessage("头像已上传，请保存站点设置")}
  return <><section className="admin-main admin-config-main">
    <header className="admin-header"><div><p>HOME EXPERIENCE</p><h1>首页设置</h1><span>集中维护品牌、首页构图和搜索引擎展示内容。</span></div><div className="config-header-actions"><div className="config-live"><i /><span>数据库同步</span></div><button className="config-preview-link" type="button" onClick={()=>setPreview(true)}>即时预览 <b>↗</b></button></div></header>
    <form className="config-form" onSubmit={save}><fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <section className="editor-section"><div className="editor-section-title"><span>01</span><div><b>品牌身份</b><small>所有页面共用，不再重复写死</small></div></div>
        <div className="form-row"><label>中文名称<input value={form.brandName} onChange={e=>field("brandName",e.target.value)} /></label><label>英文名称<input value={form.brandLatin} onChange={e=>field("brandLatin",e.target.value)} /></label></div>
        <div className="form-row"><label>作者名称<input value={form.authorName} onChange={e=>field("authorName",e.target.value)} /></label><label>头像地址<input value={form.avatarUrl} onChange={e=>field("avatarUrl",e.target.value)} /></label></div>
        <label className="avatar-upload">上传新头像<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" disabled={uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadAvatar(file)}} /><span>{uploading?"正在上传…":"选择图片 · 最大 10MB"}</span></label>
        <label>站点标语<input value={form.tagline} onChange={e=>field("tagline",e.target.value)} /></label>
        <label>站点简介<textarea rows={3} value={form.description} onChange={e=>field("description",e.target.value)} /></label>
        <div className="brand-preview"><img src={form.avatarUrl} alt="头像预览" /><div><small>品牌实时预览</small><b>{form.brandName}<i>。</i></b><span>{form.brandLatin} · {form.tagline}</span></div></div>
      </section>
      <section className="editor-section"><div className="editor-section-title"><span>02</span><div><b>首页内容</b><small>保持当前视觉布局，只替换内容来源</small></div></div>
        <div className="form-row"><label>主标题前半句<input value={form.heroLead} onChange={e=>field("heroLead",e.target.value)} /></label><label>主标题后半句<input value={form.heroTail} onChange={e=>field("heroTail",e.target.value)} /></label></div>
        <div className="hero-title-config-preview" aria-label="首页主标题排版预览"><small>首页标题实时排版</small><div><span>{form.heroLead}</span><b>{form.heroTail}</b></div><p>前半句收束在上层，后半句自然向两侧展开。</p></div>
        <label>文章区标题<input value={form.homeSectionTitle} onChange={e=>field("homeSectionTitle",e.target.value)} /></label>
        <div className="form-row"><label>作者卡标题<input value={form.homeAboutTitle} onChange={e=>field("homeAboutTitle",e.target.value)} /></label><label>首页文章数量<input type="number" min="1" max="24" value={form.homePostLimit} onChange={e=>field("homePostLimit",Number(e.target.value))} /></label></div>
        <label>作者卡简介<textarea rows={3} value={form.homeAboutCopy} onChange={e=>field("homeAboutCopy",e.target.value)} /></label>
        <label>页脚短句<input value={form.footerText} onChange={e=>field("footerText",e.target.value)} /></label>
      </section>
      <section className="editor-section"><div className="editor-section-title"><span>03</span><div><b>搜索与分享</b><small>浏览器标题及搜索结果摘要</small></div></div>
        <label>SEO 标题<input value={form.seoTitle} onChange={e=>field("seoTitle",e.target.value)} /></label>
        <label>SEO 描述<textarea rows={3} value={form.seoDescription} onChange={e=>field("seoDescription",e.target.value)} /></label>
      </section>
      </fieldset>{readOnly&&<p className="form-message">站点设置仅管理员可以修改；当前账号可查看原版页面与配置。</p>}<footer className="config-footer"><span>{message || (readOnly ? "只读查看 · 站点设置由管理员维护" : "修改会保存到站点数据库")}</span><button disabled={saving||readOnly} className="save-button">{saving ? "正在保存…" : "保存站点设置"}<i>→</i></button></footer>
    </form>
  </section>{preview&&<HomeLivePreview settings={form} onClose={()=>setPreview(false)}/>}</>;
}

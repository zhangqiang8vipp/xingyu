"use client";

import "vditor/dist/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type Vditor from "vditor";
import { removeAttachmentReference } from "@/domain/attachments/markdown-reference";
import { mermaidAppearance } from "../markdown/mermaid-theme";

const slashHints = [
  { html: "<b>H1</b><span>一级标题</span>", value: "# 一级标题" },
  { html: "<b>H2</b><span>二级标题</span>", value: "## 二级标题" },
  { html: "<b>H3</b><span>三级标题</span>", value: "### 三级标题" },
  { html: "<b>❞</b><span>引用</span>", value: "> 输入引用内容" },
  { html: "<b>☷</b><span>无序列表</span>", value: "- 列表项目" },
  { html: "<b>1.</b><span>有序列表</span>", value: "1. 列表项目" },
  { html: "<b>▦</b><span>表格</span>", value: "| 项目 | 内容 |\n| --- | --- |\n| 示例 | 文本 |" },
  { html: "<b>&lt;/&gt;</b><span>代码块</span>", value: "```\n在这里输入代码\n```" },
  { html: "<b>↗</b><span>链接</span>", value: "[链接文字](https://)" },
  { html: "<b>▧</b><span>图片</span>", value: "![图片说明](图片地址)" },
];

const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,application/pdf,text/plain,text/markdown,text/csv,application/json,application/zip,.md,.markdown,.txt,.log,.csv,.json,.zip,.docx,.xlsx,.pptx";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type AttachmentItem={id:string;name:string;contentType:string;size:number;createdAt:string;url:string;markdown:string};
type UploadNotice={kind:"success"|"error";title:string;detail:string};

export default function VditorEditor({ value, onChange, previewMode="both", autoFocus=false, attachments=false, postId, postVersion, onPostVersionChange }: { value: string; onChange: (value: string) => void; previewMode?:"both"|"editor"; autoFocus?:boolean; attachments?:boolean; postId?:number; postVersion?:number; onPostVersionChange?:(version:number)=>void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Vditor | null>(null);
  const changeRef = useRef(onChange);
  const [uploadState,setUploadState]=useState<"idle"|"uploading"|"done"|"error">("idle");
  const [attachmentItems,setAttachmentItems]=useState<AttachmentItem[]>([]);
  const [managerOpen,setManagerOpen]=useState(false);
  const [managerLoading,setManagerLoading]=useState(false);
  const [managerMessage,setManagerMessage]=useState("");
  const [deleteCandidate,setDeleteCandidate]=useState<string|null>(null);
  const [notice,setNotice]=useState<UploadNotice|null>(null);
  // Vditor owns its document after mounting; prop changes arrive through its input callback.
  const initialValueRef = useRef(value);

  useEffect(() => { changeRef.current = onChange; }, [onChange]);

  const uploadFiles=useCallback(async(files:File[], editor=editorRef.current) => {
    if (!files.length || !editor) return null;
    setUploadState("uploading");
    setNotice(null);
    const uploaded:AttachmentItem[]=[];
    const failures:string[]=[];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        failures.push(`${file.name}：超过 25 MB 限制`);
        continue;
      }
      try {
        const body=new FormData();
        body.set("file",file);
        if(postId)body.set("postId",String(postId));
        const response=await fetch("/api/attachments",{method:"POST",body});
        const payload=await readAttachmentResponse(response);
        const item=payload.attachment??(payload.markdown&&payload.id?payload as AttachmentItem:undefined);
        if(!response.ok||!item?.markdown)throw new Error(uploadErrorDetail(response.status,payload.error));
        uploaded.push(item);
      } catch (error) {
        failures.push(`${file.name}：${friendlyClientError(error,"网络连接异常，请检查网络后重试")}`);
      }
    }
    if (uploaded.length) {
      editor.insertValue(`\n${uploaded.map((item)=>item.markdown).join("\n")}\n`,true);
      setAttachmentItems((current)=>mergeAttachments(current,uploaded));
    }
    if (failures.length) {
      setUploadState("error");
      setNotice({kind:"error",title:uploaded.length?"部分附件未能上传":"附件上传失败",detail:failures.join("；")});
      return failures.join("；");
    }
    if (uploaded.length) {
      setUploadState("done");
      setNotice({kind:"success",title:uploaded.length===1?"附件已插入正文":`${uploaded.length} 个附件已插入正文`,detail:"可在“附件管理”中重新插入、复制链接或删除。"});
      window.setTimeout(()=>setUploadState("idle"),1800);
    }
    return null;
  },[postId]);

  const openAttachmentManager=useCallback(()=>{
    setManagerOpen(true);
    if(!postId)return;
    setManagerLoading(true);
    setManagerMessage("");
    void fetch(`/api/attachments?postId=${postId}`).then(async(response)=>{
      const payload=await readAttachmentResponse(response);
      if(!response.ok)throw new Error(uploadErrorDetail(response.status,payload.error));
      setAttachmentItems((current)=>mergeAttachments(payload.attachments??[],current));
    }).catch((error)=>{
      setManagerMessage(friendlyClientError(error,"附件列表读取失败，请稍后重试"));
    }).finally(()=>setManagerLoading(false));
  },[postId]);

  useEffect(()=>{
    if(!managerOpen)return;
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setManagerOpen(false)};
    window.addEventListener("keydown",close);
    return()=>window.removeEventListener("keydown",close);
  },[managerOpen]);

  const insertAttachment=useCallback((item:AttachmentItem)=>{
    editorRef.current?.insertValue(`\n${item.markdown}\n`,true);
    setNotice({kind:"success",title:"已插入正文",detail:item.name});
  },[]);

  const copyAttachmentLink=useCallback(async(item:AttachmentItem)=>{
    try{
      await navigator.clipboard.writeText(`${window.location.origin}${item.url}`);
      setNotice({kind:"success",title:"链接已复制",detail:item.name});
    }catch{
      setNotice({kind:"error",title:"无法复制链接",detail:"浏览器拒绝了剪贴板权限，请点击“打开”后从地址栏复制。"});
    }
  },[]);

  const deleteManagedAttachment=useCallback(async(item:AttachmentItem)=>{
    setManagerMessage("");
    try {
      const response=await fetch(`/api/attachments/${item.id}`,{
        method:"DELETE",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({version:postVersion}),
      });
      const payload=await readAttachmentResponse(response);
      if(!response.ok)throw new Error(uploadErrorDetail(response.status,payload.error));
      if(typeof payload.version==="number")onPostVersionChange?.(payload.version);
      setAttachmentItems((current)=>current.filter((entry)=>entry.id!==item.id));
      setDeleteCandidate(null);
      const editor=editorRef.current;
      if(editor){
        const next=removeAttachmentReference(editor.getValue(),item);
        editor.setValue(next);
        changeRef.current(next);
      }
      setNotice({kind:"success",title:"附件已删除",detail:`${item.name} 已从附件库和当前正文中移除。`});
    } catch(error) {
      const detail=friendlyClientError(error,"附件删除失败，请稍后重试");
      setManagerMessage(detail);
      setNotice({kind:"error",title:"附件删除失败",detail});
    }
  },[postVersion,onPostVersionChange]);

  useEffect(() => {
    let disposed = false;
    let ready = false;
    let instance: Vditor | null = null;
    const host = hostRef.current;
    const syncEditorTheme = () => host?.classList.toggle("vditor--dark", document.documentElement.dataset.theme === "dark");
    const configureVditorMermaid = (event: Event) => {
      const script = event.target;
      if (!(script instanceof HTMLScriptElement) || script.id !== "vditorMermaidScript") return;
      const runtime = (window as Window & { mermaid?: { initialize?: (config: Record<string, unknown>) => void; __xingyuConfigured?: boolean } }).mermaid;
      if (!runtime?.initialize || runtime.__xingyuConfigured) return;
      const initialize = runtime.initialize.bind(runtime);
      runtime.initialize = (config) => {
        const appearance = mermaidAppearance(document.documentElement.dataset.theme === "dark");
        return initialize({
          ...config,
          ...appearance,
          flowchart: { ...(config.flowchart as Record<string, unknown> ?? {}), ...appearance.flowchart },
        });
      };
      runtime.__xingyuConfigured = true;
    };
    // Vditor loads Mermaid itself. Intercept the script's capture-phase load event
    // so its renderer receives the same Chinese-safe settings as the public reader.
    document.addEventListener("load", configureVditorMermaid, true);
    const themeObserver = new MutationObserver(syncEditorTheme);
    themeObserver.observe(document.documentElement, { attributes:true, attributeFilter:["data-theme"] });
    syncEditorTheme();
    const keepHintSelectionVisible = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      window.requestAnimationFrame(() => {
        host?.querySelector<HTMLElement>(".vditor-hint--current")?.scrollIntoView({ block: "nearest" });
      });
    };
    host?.addEventListener("keydown", keepHintSelectionVisible, true);
    const timer = window.setTimeout(async () => {
      if (disposed || !hostRef.current) return;
      // Keep the editor runtime out of the initial admin bundle until an editor is visible.
      const { default: VditorRuntime } = await import("vditor");
      if (disposed || !hostRef.current) return;
      const nextEditor = new VditorRuntime(hostRef.current, {
        cdn: "/vditor",
        value: initialValueRef.current,
        mode: "sv",
        lang: "zh_CN",
        height: 560,
        minHeight: 420,
        placeholder: "用 Markdown 开始写作…\n\n输入 / 插入标题、引用、表格等内容；复制图片后直接按 Ctrl+V。",
        cache: { enable: false },
        toolbar: [],
        toolbarConfig: { hide: true },
        counter: { enable: true, type: "text" },
        preview: {
          mode: previewMode,
          delay: 80,
          markdown: { sanitize: true },
        },
        hint: {
          delay: 0,
          extend: [{
            key: "/",
            hint: (keyword) => {
              const normalized = keyword.trim().toLowerCase();
              return slashHints.filter((item) => !normalized || item.html.toLowerCase().includes(normalized));
            },
          }],
        },
        upload: attachments ? {
          multiple: true,
          accept: ATTACHMENT_ACCEPT,
          max: 25 * 1024 * 1024,
          handler: async (files):Promise<null> => {
            await uploadFiles(files, editorRef.current);
            return null;
          },
        } : {
          url: "/api/media",
          fieldName: "file",
          multiple: false,
          accept: "image/jpeg,image/png,image/webp,image/gif,image/avif",
          max: 10 * 1024 * 1024,
          filename: (name) => name,
          format: (files, responseText) => {
            const response = JSON.parse(responseText) as { url?: string; error?: string };
            if (!response.url) return JSON.stringify({ code: 1, msg: response.error ?? "图片上传失败", data: null });
            return JSON.stringify({ code: 0, msg: "", data: { errFiles: [], succMap: { [files[0].name]: response.url } } });
          },
        },
        input: (nextValue) => {
          changeRef.current(nextValue);
          // React updates the parent form after each keystroke. Keep the caret in
          // Vditor instead of allowing the adjacent live-preview iframe to win focus.
          window.requestAnimationFrame(() => {
            const active = document.activeElement;
            if (active instanceof HTMLElement && hostRef.current?.contains(active)) active.focus({ preventScroll:true });
          });
        },
        after: () => {
          ready = true;
          syncEditorTheme();
          if (autoFocus) window.requestAnimationFrame(() => hostRef.current?.querySelector<HTMLElement>(".vditor-ir")?.focus({ preventScroll:true }));
          if (disposed && (nextEditor as Vditor & { vditor?: { element?: HTMLElement } }).vditor?.element) nextEditor.destroy();
        },
      });
      instance = nextEditor;
      editorRef.current = nextEditor;
    }, 50);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      themeObserver.disconnect();
      document.removeEventListener("load", configureVditorMermaid, true);
      host?.removeEventListener("keydown", keepHintSelectionVisible, true);
      if (instance && ready && (instance as Vditor & { vditor?: { element?: HTMLElement } }).vditor?.element) instance.destroy();
      if (editorRef.current === instance) editorRef.current = null;
    };
  }, [previewMode, autoFocus, attachments, postId, uploadFiles]);

  return <div className={`vditor-shell${attachments?" supports-attachments":""}`}>
    {attachments&&<button type="button" className={`vditor-attachment-button ${uploadState}`} onClick={openAttachmentManager} aria-haspopup="dialog">
      <span>{uploadState==="uploading"?"正在上传…":"附件管理"}</span>
      <small>{attachmentItems.length||"＋"}</small>
    </button>}
    <div className="vditor-host" ref={hostRef} />
    {notice&&<div className={`attachment-notice ${notice.kind}`} role={notice.kind==="error"?"alert":"status"} aria-live="polite"><i>{notice.kind==="error"?"!":"✓"}</i><div><b>{notice.title}</b><span>{notice.detail}</span></div><button type="button" onClick={()=>setNotice(null)} aria-label="关闭提示">×</button></div>}
    {attachments&&managerOpen&&<div className="attachment-manager-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&setManagerOpen(false)}>
      <section className="attachment-manager" role="dialog" aria-modal="true" aria-labelledby="attachment-manager-title">
        <header><div><small>ARTICLE ASSETS</small><h3 id="attachment-manager-title">本文附件</h3><p>{postId?"管理这篇文章已经上传的文件。":"新文章保存后，正文中的附件会自动归档到本文。"}</p></div><button type="button" onClick={()=>setManagerOpen(false)} aria-label="关闭附件管理">×</button></header>
        <label className={`attachment-manager-upload ${uploadState}`}><input type="file" multiple accept={ATTACHMENT_ACCEPT} disabled={uploadState==="uploading"} onChange={(event)=>{const files=Array.from(event.target.files??[]);event.target.value="";void uploadFiles(files)}}/><i>＋</i><span><b>{uploadState==="uploading"?"正在上传，请稍候…":"上传并插入正文"}</b><small>图片、PDF、Markdown、ZIP、Office 等 · 单个最大 25 MB</small></span></label>
        <div className="attachment-manager-list">
          {managerLoading&&<p className="attachment-manager-empty">正在读取附件…</p>}
          {!managerLoading&&!attachmentItems.length&&<p className="attachment-manager-empty">还没有附件。上传后会自动插入到当前光标位置。</p>}
          {attachmentItems.map((item)=><article key={item.id}><i>{attachmentKind(item.name)}</i><div><b title={item.name}>{item.name}</b><span>{formatClientBytes(item.size)} · {item.contentType}</span></div><div className="attachment-manager-actions"><button type="button" onClick={()=>insertAttachment(item)}>插入</button><button type="button" onClick={()=>void copyAttachmentLink(item)}>复制</button><a href={item.url} target="_blank" rel="noreferrer">打开</a>{deleteCandidate===item.id?<><button type="button" onClick={()=>setDeleteCandidate(null)}>取消</button><button type="button" className="danger confirm" onClick={()=>void deleteManagedAttachment(item)}>确认删除</button></>:<button type="button" className="danger" onClick={()=>setDeleteCandidate(item.id)}>删除</button>}</div></article>)}
        </div>
        {managerMessage&&<p className="attachment-manager-message" role="alert">{managerMessage}</p>}
        <footer><span>{attachmentItems.length} 个附件</span><button type="button" onClick={()=>setManagerOpen(false)}>完成</button></footer>
      </section>
    </div>}
  </div>;
}

async function readAttachmentResponse(response:Response){
  try{return await response.json() as {id?:string;markdown?:string;attachment?:AttachmentItem;attachments?:AttachmentItem[];error?:string;version?:number|null}}
  catch{return {error:response.ok?"服务器返回了无法识别的数据":"服务器没有返回错误详情"}}
}

function uploadErrorDetail(status:number,error?:string){
  if(error)return error;
  if(status===401)return "登录状态已失效，请刷新页面并重新登录";
  if(status===413)return "文件超过 25 MB 限制";
  if(status===415)return "文件格式不受支持";
  if(status>=500)return "附件存储服务暂时不可用，请稍后重试";
  return `上传请求失败（HTTP ${status}）`;
}

function friendlyClientError(error:unknown,fallback:string){
  if(error instanceof TypeError)return "无法连接附件服务，请检查网络后重试";
  return error instanceof Error&&error.message?error.message:fallback;
}

function mergeAttachments(first:AttachmentItem[],second:AttachmentItem[]){
  const items=new Map(first.map((item)=>[item.id,item]));
  for(const item of second)items.set(item.id,item);
  return [...items.values()].sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
}

function attachmentKind(name:string){return name.split(".").pop()?.slice(0,5).toUpperCase()||"FILE"}
function formatClientBytes(size:number){return size<1024?`${size} B`:size<1024*1024?`${Math.round(size/1024)} KB`:`${(size/1024/1024).toFixed(size<10*1024*1024?1:0)} MB`}

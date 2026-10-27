"use client";

import { useCallback,useEffect,useState } from "react";
import VditorEditor from "./VditorEditor";

type Document={publicId:string;title:string;content:string;version:number;canRead?:boolean;canWrite:boolean;canManage:boolean};
type Revision={version:number;actorUserId:number|null;clientLabel?:string;createdAt:string;contentLength:number};
type Proposal={id:string;baseVersion:number;headVersion:number;actorUserId:number;clientLabel:string;createdAt:string};
type Proposed={status:"conflict"|"merged"|"unchanged";proposalId?:string;currentVersion?:number;version?:number};
type Result<T>={document?:Document;revisions?:Revision[];proposals?:Proposal[];proposal?:{id:string;proposedContent:string};
  revision?:{version:number;content:string};result?:T;error?:string};

async function request<T>(url:string,method="GET",body?:object):Promise<Result<T>>{
  const response=await fetch(url,{method,credentials:"same-origin",cache:"no-store",
    ...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({})) as Result<T>;
  if(!response.ok&&!(response.status===409&&(result.result as Proposed|undefined)?.status==="conflict"))
    throw new Error(result.error??"文档操作失败");
  return result;
}

export default function AdminSpaceCoauthorDialog({spaceId,spaceName,publicId,canWrite,onClose,onUpdated}:{
  spaceId:number;spaceName:string;publicId?:string;canWrite:boolean;onClose:()=>void;onUpdated:()=>void;
}){
  const [doc,setDoc]=useState<Document|null>(null);
  const [title,setTitle]=useState("");
  const [content,setContent]=useState("");
  const [editorKey,setEditorKey]=useState(0);
  const [history,setHistory]=useState<Revision[]>([]);
  const [proposals,setProposals]=useState<Proposal[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(Boolean(publicId));
  const [notice,setNotice]=useState("");
  const [conflict,setConflict]=useState<{proposalId:string;current:string;proposed:string;headVersion:number}|null>(null);
  const [resolved,setResolved]=useState("");
  const [preview,setPreview]=useState<{version:number;content:string}|null>(null);
  const path="/api/space-collaboration/documents/"+encodeURIComponent(publicId??"");
  const load=useCallback(async()=>{
    if(!publicId)return;
    const loaded=await request<Proposed>(path);
    if(!loaded.document)throw new Error("协作文档不存在或无权访问");
    setDoc(loaded.document);
    setTitle(loaded.document.title);
    setContent(loaded.document.content);
    setEditorKey(value=>value+1);
    const [versions,pending]=await Promise.all([
      request<Proposed>(path+"?history=1"),
      loaded.document.canManage?request<Proposed>(path+"?proposals=1"):Promise.resolve({proposals:[]}),
    ]);
    setHistory(versions.revisions??[]);
    setProposals(pending.proposals??[]);
  },[path,publicId]);
  useEffect(()=>{
    if(!publicId)return;
    let active=true;
    void load().catch(e=>{if(active)setNotice(e instanceof Error?e.message:"文档读取失败");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[load,publicId]);
  useEffect(()=>{
    const dismiss=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    window.addEventListener("keydown",dismiss);
    return()=>window.removeEventListener("keydown",dismiss);
  },[onClose]);

  async function save(){
    if(busy)return;
    setBusy(true);setNotice("");
    try{
      if(!publicId){
        const response=await request<{publicId:string}>("/api/space-collaboration/"+spaceId,"POST",{
          action:"create_document",title,content,
        });
        if(!response.result?.publicId)throw new Error("协作文档创建失败");
        onUpdated();onClose();return;
      }
      if(!doc)throw new Error("文档尚未准备好");
      const response=await request<Proposed>(path,"PATCH",{
        baseVersion:doc.version,content,summary:"知识空间协同编辑",
      });
      if(response.result?.status==="conflict"){
        const latest=await request<Proposed>(path);
        const current=latest.document;
        if(!current)throw new Error("冲突版本读取失败");
        setConflict({proposalId:response.result.proposalId??"",current:current.content,
          proposed:content,headVersion:current.version});
        setResolved("");setNotice("检测到重叠修改；他人的版本没有被覆盖，已保留待审核冲突。");
        return;
      }
      await load();onUpdated();
      setNotice(response.result?.status==="unchanged"?"正文未变更":"已安全提交，文档历史版本已更新。");
    }catch(e){setNotice(e instanceof Error?e.message:"保存失败");}
    finally{setBusy(false);}
  }
  async function review(proposalId:string){
    setBusy(true);setNotice("");
    try{
      const [proposed,latest]=await Promise.all([
        request<Proposed>(path+"?proposal="+encodeURIComponent(proposalId)),
        request<Proposed>(path),
      ]);
      if(!proposed.proposal||!latest.document)throw new Error("冲突提案或最新文档不可用");
      setConflict({proposalId,current:latest.document.content,
        proposed:proposed.proposal.proposedContent,headVersion:latest.document.version});
      setResolved("");
    }catch(e){setNotice(e instanceof Error?e.message:"读取冲突失败");}
    finally{setBusy(false);}
  }
  async function resolveConflict(){
    if(!publicId||!conflict||!doc?.canManage||!resolved.trim())return;
    if(!window.confirm("确认已经人工对照双方修改，提交经过审核的完整 Markdown？"))return;
    setBusy(true);setNotice("");
    try{
      await request<Proposed>(path,"POST",{
        action:"resolve",proposalId:conflict.proposalId,
        expectedVersion:conflict.headVersion,content:resolved,
      });
      setConflict(null);setResolved("");
      await load();onUpdated();setNotice("冲突已审核合并，生成新版本。");
    }catch(e){setNotice(e instanceof Error?e.message:"冲突解决失败");}
    finally{setBusy(false);}
  }
  async function restore(version:number){
    if(!doc?.canManage||!window.confirm("将 V"+version+" 恢复为一个新的版本？当前历史不会删除。"))return;
    setBusy(true);setNotice("");
    try{
      await request<Proposed>(path,"POST",{action:"restore",revision:version,expectedVersion:doc.version});
      await load();onUpdated();setPreview(null);
      setNotice("历史版本已恢复，原有历史仍保留。");
    }catch(e){setNotice(e instanceof Error?e.message:"恢复失败");}
    finally{setBusy(false);}
  }
  const editable=publicId?Boolean(doc?.canWrite):canWrite;
  return <div className="space-dialog-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onClose()}>
    <section className="space-dialog space-coauthor-dialog" role="dialog" aria-modal="true" aria-label={publicId?"协作文档":"新建协作文档"}>
      <header><div><small>KNOWLEDGE SPACE · VERSION CONTROL</small>
        <h2>{publicId?title:"新建知识文章"}</h2><p>{spaceName}{doc?" · 版本 V"+doc.version:" · 新建草稿"}</p></div>
        <button type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="space-coauthor-body">
        {loading?<p className="space-collab-muted">正在读取协作文档…</p>:null}
        {notice?<p className="space-collab-notice" role="status">{notice}</p>:null}
        {!publicId&&editable?<label className="space-coauthor-title">文章标题<input maxLength={200} required
          placeholder="例如：项目交接清单" value={title} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label>:null}
        {(!publicId||doc)&&<section className="space-coauthor-content">
          <div className="space-collab-section-heading"><h3>Markdown 正文</h3>
            <span>{editable?"版本保存 · 自动合并非冲突修改":"只读权限"}</span></div>
          {editable?<VditorEditor key={editorKey} value={content} onChange={setContent} attachments={false}/>:<pre className="space-coauthor-readonly">{content||"（文档暂无正文）"}</pre>}
        </section>}
        {conflict?<section className="space-coauthor-conflict">
          <div className="space-collab-section-heading"><h3>需要人工审核的并发冲突</h3><span>当前 V{conflict.headVersion}</span></div>
          <p>已保存冲突提案，不会静默覆盖另一位协作者或 AI 的修改。</p>
          <div className="space-coauthor-diff">
            <div><b>当前已提交版本</b><pre>{conflict.current}</pre></div>
            <div><b>我的 / AI 的修改</b><pre>{conflict.proposed}</pre></div>
          </div>
          {doc?.canManage?<><label>人工确认后的合并正文
            <textarea rows={8} value={resolved} onChange={e=>setResolved(e.target.value)}
              placeholder="请对照两侧版本，填写最终合并结果"/></label>
            <button type="button" className="space-collab-primary" disabled={busy||!resolved.trim()}
              onClick={()=>void resolveConflict()}>审核并提交合并</button>
          </>:<p>空间管理员会处理这份提案。</p>}
        </section>:null}
        {publicId&&doc?<details className="space-coauthor-revisions">
          <summary>历史版本与冲突提案 <span>{history.length} 条历史 · {proposals.length} 个待处理</span></summary>
          {history.map(item=><div className="space-collab-member" key={item.version}>
            <div className="space-collab-member-name"><b>V{item.version}</b>
              <small>{item.clientLabel||"网页"} · {item.createdAt}</small></div>
            <button className="space-collab-subtle" type="button" disabled={busy} onClick={()=>void request<Proposed>(path+"?revision="+item.version)
              .then(data=>setPreview(data.revision??null))
              .catch(e=>setNotice(e instanceof Error?e.message:"历史版本读取失败"))}>预览</button>
            {doc.canManage&&item.version!==doc.version?<button type="button" className="space-collab-subtle" disabled={busy}
              onClick={()=>void restore(item.version)}>恢复</button>:null}
          </div>)}
          {preview?<div className="space-coauthor-preview"><b>历史版本 V{preview.version}</b>
            <pre>{preview.content}</pre><button type="button" onClick={()=>setPreview(null)}>收起预览</button></div>:null}
          {doc.canManage&&proposals.map(item=><div className="space-collab-member" key={item.id}>
            <div className="space-collab-member-name"><b>待审核冲突 · 基于 V{item.baseVersion}</b>
              <small>{item.clientLabel} · {item.createdAt}</small></div>
            <button type="button" disabled={busy} onClick={()=>void review(item.id)}>审阅</button>
          </div>)}
        </details>:null}
      </div>
      <footer>
        <button type="button" onClick={onClose}>关闭</button>
        {editable?<button className="space-collab-primary" type="button" disabled={busy||loading||(!publicId&&!title.trim())}
          onClick={()=>void save()}>{busy?"正在处理…":publicId?"保存并合并":"创建草稿"}</button>:null}
      </footer>
    </section>
  </div>;
}

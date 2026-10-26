"use client";
import {useCallback,useEffect,useState,type CSSProperties,type FormEvent} from "react";
type Space={id:number;name:string;workspaceName:string;workspaceId:number;role:string};
type Child={id:number;name:string;parentId:number};
type Access={id:number;name:string;parentId:number|null;role:string;canManage:boolean;canWrite:boolean;workspaceId:number};
type DocSummary={publicId:string;title:string;version:number;status:string;updatedAt:string};
type Document={publicId:string;title:string;content:string;version:number;spaceId:number;canManage:boolean;canWrite:boolean};
type Invite={id:number;email:string;role:string;expiresAt:number};
type Member={userId:number;name:string;email:string|null;role:string};
type Conflict={status:"conflict";proposalId:string;currentVersion:number;baseVersion:number;reason:string};
type History={version:number;title:string;actorUserId:number|null;createdAt:string;contentLength:number};
type ResponseData={
 error?:string;spaces?:Space[];access?:Access;children?:Child[];documents?:DocSummary[];
 members?:Member[];invitations?:Invite[];settings?:{inheritPermissions:boolean};
 document?:Document;result?:Document|Conflict|Record<string,unknown>;
 revisions?:History[];revision?:{content:string;title:string;version:number};
 proposal?:{id:string;baseVersion:number;headVersion:number;proposedContent:string;clientLabel:string};
 proposals?:Array<{id:string;baseVersion:number;headVersion:number;actorUserId:number;clientLabel:string;createdAt:string}>;
};
const field:CSSProperties={display:"block",width:"100%",minWidth:0,padding:10,border:"1px solid #b0b8c580",borderRadius:10,background:"transparent",color:"inherit"};
const panel:CSSProperties={border:"1px solid #b0b8c550",borderRadius:15,padding:18,display:"grid",gap:12,alignContent:"start"};
const columns:CSSProperties={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16};
const button:CSSProperties={padding:"9px 14px",border:"1px solid #b0b8c580",borderRadius:10,cursor:"pointer",background:"transparent",color:"inherit"};
async function request(path:string,method="GET",body?:object):Promise<ResponseData>{
  const response=await fetch(path,{method,credentials:"same-origin",cache:"no-store",
    ...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({})) as ResponseData;
  if(!response.ok && !(response.status===409 && data.result && "status" in data.result && data.result.status==="conflict"))
    throw new Error(data.error??"请求失败（"+response.status+"）");
  return data;
}
export default function CollaborationClient({initialSpaceId}:{initialSpaceId:number}){
  const [spaces,setSpaces]=useState<Space[]>([]);
  const [spaceId,setSpaceId]=useState(initialSpaceId);
  const [detail,setDetail]=useState<ResponseData|null>(null);
  const [selected,setSelected]=useState<Document|null>(null);
  const [text,setText]=useState("");
  const [history,setHistory]=useState<History[]>([]);
  const [proposals,setProposals]=useState<NonNullable<ResponseData["proposals"]>>([]);
  const [conflict,setConflict]=useState<Conflict|null>(null);
  const [headAfterConflict,setHeadAfterConflict]=useState<Document|null>(null);
  const [manualMerge,setManualMerge]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [email,setEmail]=useState("");
  const [inviteRole,setInviteRole]=useState("editor");
  const [childName,setChildName]=useState("");
  const [title,setTitle]=useState("");
  const [newContent,setNewContent]=useState("");
  const root="/api/space-collaboration";
  const access=detail?.access;
  const refreshList=useCallback(async()=>{
    const data=await request(root);
    setSpaces(data.spaces??[]);
    setSpaceId(old=>old||data.spaces?.[0]?.id||0);
  },[]);
  const refreshSpace=useCallback(async()=>{
    if(!spaceId)return;
    const data=await request(root+"/"+spaceId);
    setDetail(data);
  },[spaceId]);
  useEffect(()=>{
    let active=true;
    void request(root).then(data=>{
      if(!active)return;
      setSpaces(data.spaces??[]);
      setSpaceId(old=>old||data.spaces?.[0]?.id||0);
    }).catch(e=>{if(active)setNotice(e instanceof Error?e.message:"列表读取失败");});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!spaceId)return;
    let active=true;
    void request(root+"/"+spaceId).then(data=>{if(active)setDetail(data);})
      .catch(e=>{if(active){setDetail(null);setNotice(e instanceof Error?e.message:"无法访问此空间");}});
    return()=>{active=false;};
  },[spaceId]);
  async function run(task:()=>Promise<unknown>,success:string,refresh=true){
    setBusy(true);setNotice("");
    try{
      await task();
      if(refresh){await refreshSpace();await refreshList();}
      setNotice(success);
    }catch(e){setNotice(e instanceof Error?e.message:"操作失败");}
    finally{setBusy(false);}
  }
  async function openDocument(publicId:string){
    setBusy(true);setNotice("");setConflict(null);setManualMerge("");setHeadAfterConflict(null);
    try{
      const data=await request(root+"/documents/"+encodeURIComponent(publicId));
      if(!data.document)throw new Error("文档不存在");
      setSelected(data.document);setText(data.document.content);
      const [a,b]=await Promise.all([
        request(root+"/documents/"+encodeURIComponent(publicId)+"?history=1"),
        data.document.canManage?request(root+"/documents/"+encodeURIComponent(publicId)+"?proposals=1"):Promise.resolve({proposals:[]}),
      ]);
      setHistory(a.revisions??[]);setProposals(b.proposals??[]);
    }catch(e){setNotice(e instanceof Error?e.message:"读取文档失败");}
    finally{setBusy(false);}
  }
  async function saveDocument(){
    if(!selected)return;
    setBusy(true);setNotice("");
    try{
      const path=root+"/documents/"+encodeURIComponent(selected.publicId);
      const data=await request(path,"PATCH",{baseVersion:selected.version,content:text,
        summary:"网页协同保存（基础版本 "+selected.version+"）"});
      const result=data.result as Record<string,unknown>|undefined;
      if(result?.status==="conflict"){
        const newConflict=result as unknown as Conflict;
        setConflict(newConflict);
        const head=await request(path);
        if(head.document)setHeadAfterConflict(head.document);
        setNotice("发生重叠修改，已保留待审核提案。原文未被覆盖。");
        return;
      }
      await openDocument(selected.publicId);
      await refreshSpace();
      setNotice(result?.status==="unchanged"?"文档未发生变化":"已安全保存并记录新版本");
    }catch(e){setNotice(e instanceof Error?e.message:"提交失败");}
    finally{setBusy(false);}
  }
  async function resolveConflict(proposalId:string){
    if(!selected||!headAfterConflict||!manualMerge.trim())return;
    if(!window.confirm("请确认已人工审阅当前版本和提案，提交手工合并全文？"))return;
    await run(async()=>{
      const path=root+"/documents/"+encodeURIComponent(selected.publicId);
      await request(path,"POST",{action:"resolve",proposalId,expectedVersion:headAfterConflict.version,content:manualMerge});
      setConflict(null);setHeadAfterConflict(null);setManualMerge("");
      await openDocument(selected.publicId);
    },"冲突已解决并提交新版本");
  }
  async function restoreRevision(rev:number){
    if(!selected||!window.confirm("将版本 "+rev+" 的正文恢复为新的修订吗？不会删除现有历史。"))return;
    await run(async()=>{
      await request(root+"/documents/"+encodeURIComponent(selected.publicId),"POST",{
        action:"restore",revision:rev,expectedVersion:selected.version,
      });
      await openDocument(selected.publicId);
    },"文档已恢复并生成新版本");
  }
  const scopeAction=(action:string,additional:object)=>request(root+"/"+spaceId,"POST",{action,...additional});
  function invite(e:FormEvent){
    e.preventDefault();
    if(!access?.canManage)return;
    void run(async()=>{await scopeAction("invite",{email,role:inviteRole});setEmail("");},"空间邀请已通过邮箱发送");
  }
  function createChild(e:FormEvent){
    e.preventDefault();
    void run(async()=>{await scopeAction("create_child",{name:childName});setChildName("");},"已创建子空间");
  }
  function createDocument(e:FormEvent){
    e.preventDefault();
    void run(async()=>{
      const result=await scopeAction("create_document",{title,content:newContent});
      const doc=result.result as Document|undefined;
      setTitle("");setNewContent("");
      if(doc?.publicId)await openDocument(doc.publicId);
    },"协作文档已创建");
  }
  return <div style={{display:"grid",gap:18,marginTop:22}}>
    {notice?<div role="status" style={{padding:12,border:"1px solid #b0b8c550",borderRadius:10}}>{notice}</div>:null}
    <section style={panel}>
      <h2 style={{margin:0}}>我的协作空间</h2>
      <p style={{margin:0}}>任何空间均可邀请协作者。邀请只开放指定空间，默认不会开放整个工作区。</p>
      <select aria-label="选择协作知识空间" style={field} value={spaceId} onChange={e=>{
        setSelected(null);setText("");setConflict(null);setHistory([]);setDetail(null);setSpaceId(Number(e.target.value));
      }}>
        {!spaceId?<option value={0}>请选择一个空间</option>:null}
        {spaces.map(s=><option key={s.id} value={s.id}>{s.workspaceName} / {s.name}（{s.role}）</option>)}
        {spaceId&&!spaces.some(s=>s.id===spaceId)?<option value={spaceId}>空间 #{spaceId}</option>:null}
      </select>
      {!spaces.length?<p>没有可协作的空间。可以先在写作后台创建知识空间，再回到这里邀请。</p>:null}
    </section>
    {access?<div style={columns}>
      <section style={panel}>
        <h2 style={{margin:0}}>📁 {access.name}</h2>
        <p style={{margin:0}}>权限：{access.role} · 工作区 {access.workspaceId}</p>
        <h3>子空间</h3>
        {(detail?.children??[]).map(child=><button key={child.id} style={{...button,textAlign:"left"}} disabled={busy}
          onClick={()=>{setSpaceId(child.id);setSelected(null);setConflict(null);}}>📁 {child.name}</button>)}
        {access.parentId?<button style={button} onClick={()=>{setSpaceId(access.parentId!);setSelected(null);}}>返回父空间（需有权限）</button>:null}
        {access.canWrite?<form onSubmit={createChild} style={{display:"grid",gap:7}}>
          <label>新建子空间<input style={field} value={childName} onChange={e=>setChildName(e.target.value)} maxLength={100} required/></label>
          <button type="submit" disabled={busy} style={button}>创建子空间</button>
        </form>:null}
        {access.canWrite&&access.parentId?<button style={button} disabled={busy} onClick={()=>{
          if(window.confirm("只能删除完全为空的子空间，确定删除？"))
            void run(()=>scopeAction("delete_empty",{}),"空子空间已删除");
        }}>删除空子空间</button>:null}
      </section>
      <section style={panel}>
        <h2 style={{margin:0}}>文档</h2>
        {(detail?.documents??[]).map(d=><button key={d.publicId} style={{...button,textAlign:"left"}}
          disabled={busy} onClick={()=>void openDocument(d.publicId)}>📄 {d.title} · V{d.version}</button>)}
        {!detail?.documents?.length?<p>此空间还没有文档。</p>:null}
        {access.canWrite?<form onSubmit={createDocument} style={{display:"grid",gap:8}}>
          <h3>创建协作文档</h3>
          <input aria-label="新文档标题" style={field} value={title} maxLength={200} required onChange={e=>setTitle(e.target.value)} placeholder="文档标题"/>
          <textarea aria-label="新文档内容" style={field} rows={4} value={newContent} onChange={e=>setNewContent(e.target.value)} placeholder="Markdown 正文"/>
          <button disabled={busy} type="submit" style={button}>创建文档</button>
        </form>:null}
      </section>
      {access.canManage?<section style={panel}>
        <h2 style={{margin:0}}>邀请与权限</h2>
        <label>继承父空间的邀请权限
          <input type="checkbox" style={{marginLeft:12}} checked={detail?.settings?.inheritPermissions!==false}
            disabled={busy} onChange={e=>{
              if(window.confirm(e.target.checked?"允许继承父空间权限？":"停止继承父空间权限，可能让原成员失去访问？"))
                void run(()=>scopeAction("set_inheritance",{enabled:e.target.checked}),"继承设置已更新");
            }}/>
        </label>
        <form onSubmit={invite} style={{display:"grid",gap:8}}>
          <input type="email" aria-label="邀请邮箱" required style={field} placeholder="person@example.com" value={email}
            onChange={e=>setEmail(e.target.value)}/>
          <select aria-label="邀请权限" style={field} value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>
            {access.role==="owner"?<option value="admin">管理员</option>:null}
            <option value="editor">可编辑</option><option value="viewer">仅阅读</option>
          </select>
          <button disabled={busy} style={button} type="submit">发送邮箱邀请</button>
        </form>
        <h3>空间协作者</h3>
        {(detail?.members??[]).map(member=><div key={member.userId} style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{flex:1}}>{member.name} <small>{member.email??""}</small> · {member.role}</span>
          <select aria-label={"修改 "+member.name+" 的权限"} style={{...field,width:"auto"}} value={member.role}
            disabled={busy||member.role==="admin"&&access.role!=="owner"} onChange={e=>{
              const role=e.target.value;
              if(window.confirm("将 "+member.name+" 的权限修改为 "+role+"？"))
                void run(()=>scopeAction("set_role",{userId:member.userId,role}),"成员角色已更新");
            }}>
            {access.role==="owner"?<option value="admin">管理员</option>:null}
            <option value="editor">可编辑</option><option value="viewer">仅阅读</option>
          </select>
          <button style={button} disabled={busy} onClick={()=>{
            if(window.confirm("移除 "+member.name+" 的空间访问权限？"))
              void run(()=>scopeAction("remove_member",{userId:member.userId}),"成员已移除");
          }}>移除</button>
        </div>)}
        <h3>待接受的邀请</h3>
        {(detail?.invitations??[]).map(i=><div key={i.id} style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{flex:1}}>{i.email} · {i.role}</span>
          <button disabled={busy} style={button} onClick={()=>{
            if(window.confirm("撤销给 "+i.email+" 的邀请？"))
              void run(()=>scopeAction("revoke_invite",{invitationId:i.id}),"邀请已撤销");
          }}>撤销</button>
        </div>)}
      </section>:null}
    </div>:null}
    {selected?<section style={panel}>
      <h2 style={{margin:0}}>编辑：{selected.title} · V{selected.version}</h2>
      <p style={{margin:0}}>网页和多个 AI 都通过相同的基础版本号提交。发生重叠冲突时不会自动覆盖他人的正文。</p>
      <textarea aria-label="协作文档 Markdown 正文" style={{...field,fontFamily:"ui-monospace,monospace"}} rows={18}
        value={text} onChange={e=>setText(e.target.value)} readOnly={!selected.canWrite}/>
      {selected.canWrite?<button disabled={busy} style={button} type="button" onClick={()=>void saveDocument()}>保存并安全合并</button>:null}
      {conflict?<section style={panel}>
        <h3 style={{margin:0}}>⚠️ 发现并发冲突 · 当前版本 V{conflict.currentVersion}</h3>
        <p>冲突提案：{conflict.proposalId}。原文保持不变。请对照两份内容，人工形成最终合并文本。</p>
        <div style={columns}>
          <div><h4>其他协作者已保存的正文</h4><pre style={{whiteSpace:"pre-wrap",maxHeight:250,overflow:"auto"}}>{headAfterConflict?.content}</pre></div>
          <div><h4>我提交的正文</h4><pre style={{whiteSpace:"pre-wrap",maxHeight:250,overflow:"auto"}}>{text}</pre></div>
        </div>
        {selected.canManage?<><label>人工核对后的最终 Markdown<textarea style={field} rows={9} value={manualMerge} onChange={e=>setManualMerge(e.target.value)}/></label>
          <button disabled={busy||!manualMerge.trim()} style={button} onClick={()=>void resolveConflict(conflict.proposalId)}>确认解决冲突</button></>:<p>已提交给空间管理员处理。</p>}
      </section>:null}
      <h3>版本历史</h3>
      <div style={{display:"grid",gap:5}}>
        {history.map(item=><div key={item.version} style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <span>V{item.version} · 用户 #{item.actorUserId??"未知"} · {item.createdAt}</span>
          <button style={button} type="button" disabled={busy} onClick={()=>void run(async()=>{
            const data=await request(root+"/documents/"+encodeURIComponent(selected.publicId)+"?revision="+item.version);
            if(data.revision)setNotice("V"+item.version+" 正文：\n"+data.revision.content.slice(0,1600));
          },"已读取历史版本",false)}>预览</button>
          {selected.canManage&&item.version!==selected.version?<button style={button} type="button" disabled={busy}
            onClick={()=>void restoreRevision(item.version)}>恢复</button>:null}
        </div>)}
      </div>
      {proposals.length?<div><h3>待处理的冲突提案</h3>
        {proposals.map(p=><div key={p.id} style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
          <span>{p.id} · 基于 V{p.baseVersion} · {p.clientLabel}</span>
          <button style={button} disabled={busy} onClick={()=>void run(async()=>{
            const path=root+"/documents/"+encodeURIComponent(selected.publicId);
            const [review,latest]=await Promise.all([request(path+"?proposal="+p.id),request(path)]);
            if(!review.proposal||!latest.document)throw new Error("无法获取冲突提案或最新文档");
            setConflict({status:"conflict",proposalId:p.id,currentVersion:latest.document.version,
              baseVersion:p.baseVersion,reason:"manual_review"});
            setHeadAfterConflict(latest.document);setText(review.proposal.proposedContent);
            setManualMerge("");setNotice("请核对提案与当前版本，填写最终合并内容");
          },"已加载待复核提案",false)}>查看并解决</button>
        </div>)}
      </div>:null}
    </section>:null}
  </div>;
}

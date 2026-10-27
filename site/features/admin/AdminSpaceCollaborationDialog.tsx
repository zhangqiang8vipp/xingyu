"use client";

import { useCallback,useEffect,useState,type FormEvent } from "react";

type Role="owner"|"admin"|"editor"|"viewer";
type Access={id:number;name:string;role:Role;canWrite:boolean;canManage:boolean};
type Member={userId:number;name:string;email:string|null;role:Role;joinedAt:string};
type Invitation={id:number;email:string;role:Role;expiresAt:number};
type SpaceDetails={access:Access;members?:Member[];invitations?:Invitation[];settings?:{inheritPermissions:boolean};error?:string};
type UpdateResponse={result?:unknown;error?:string};

async function api<T>(url:string,method="GET",body?:object):Promise<T>{
  const response=await fetch(url,{method,credentials:"same-origin",cache:"no-store",
    ...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({})) as T&{error?:string};
  if(!response.ok)throw new Error(result.error??"请求失败");
  return result;
}
const ROLE_LABEL:Record<Role,string>={owner:"所有者",admin:"管理员",editor:"可编辑",viewer:"只读"};

export default function AdminSpaceCollaborationDialog({spaceId,spaceName,onClose,onUpdated}:{
  spaceId:number;spaceName:string;onClose:()=>void;onUpdated?:()=>void;
}){
  const [details,setDetails]=useState<SpaceDetails|null>(null);
  const [email,setEmail]=useState("");
  const [role,setRole]=useState<"admin"|"editor"|"viewer">("editor");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [loading,setLoading]=useState(true);
  const endpoint="/api/space-collaboration/"+spaceId;
  const refresh=useCallback(async()=>{
    const data=await api<SpaceDetails>(endpoint);
    setDetails(data);
  },[endpoint]);
  useEffect(()=>{
    let active=true;
    void api<SpaceDetails>(endpoint).then(data=>{
      if(active){setDetails(data);setLoading(false);}
    }).catch(e=>{
      if(active){setNotice(e instanceof Error?e.message:"协作者读取失败");setLoading(false);}
    });
    return()=>{active=false;};
  },[endpoint]);
  useEffect(()=>{
    const dismiss=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    window.addEventListener("keydown",dismiss);
    return()=>window.removeEventListener("keydown",dismiss);
  },[onClose]);
  async function act(action:string,args:object,success:string){
    setBusy(true);setNotice("");
    try{
      await api<UpdateResponse>(endpoint,"POST",{action,...args});
      await refresh();onUpdated?.();setNotice(success);
    }catch(e){setNotice(e instanceof Error?e.message:"操作未完成");}
    finally{setBusy(false);}
  }
  function invite(event:FormEvent){
    event.preventDefault();
    if(!details?.access.canManage)return;
    setBusy(true);setNotice("");
    void api<UpdateResponse>(endpoint,"POST",{action:"invite",email:email.trim(),role})
      .then(async()=>{setEmail("");await refresh();onUpdated?.();
        setNotice("邀请已发送至邮箱。受邀用户登录并接受后才能进入此空间。");})
      .catch(e=>setNotice(e instanceof Error?e.message:"邀请发送失败"))
      .finally(()=>setBusy(false));
  }
  const access=details?.access;
  return <div className="space-dialog-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onClose()}>
    <section className="space-dialog space-collab-dialog" role="dialog" aria-modal="true" aria-label={spaceName+"协作管理"}>
      <header><div><small>KNOWLEDGE SPACE · COLLABORATION</small><h2>协作者与邀请</h2><p>{spaceName}</p></div>
        <button type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="space-collab-dialog-body">
        {loading?<p className="space-collab-muted">正在读取空间权限…</p>:null}
        {access?<div className="space-collab-current">
          <span className="space-collab-dot"/><span>此空间的权限</span>
          <strong>{ROLE_LABEL[access.role]}</strong>
          <small>邀请授权不会自动开放同工作区的其他空间</small>
        </div>:null}
        {notice?<p className="space-collab-notice" role="status">{notice}</p>:null}
        {access?.canManage?<div className="space-collab-section">
          <div className="space-collab-section-heading"><h3>通过邮箱邀请</h3><span>有效期 7 天</span></div>
          <form className="space-collab-invite-form" onSubmit={invite}>
            <label>受邀邮箱<input type="email" value={email} maxLength={254} required
              placeholder="name@example.com" onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>
            <label>空间权限<select value={role} onChange={e=>setRole(e.target.value as typeof role)} disabled={busy}>
              {access.role==="owner"?<option value="admin">管理员</option>:null}
              <option value="editor">可编辑</option>
              <option value="viewer">只读</option>
            </select></label>
            <button type="submit" disabled={busy||!email.trim()}>发送邀请</button>
          </form>
          <p className="space-collab-hint">只有受邀邮箱对应的星屿账号接受邀请后，才能查看本空间及其允许继承的子空间。AI 使用此账号授权的 MCP 访问。</p>
        </div>:null}
        {access?.canManage?<div className="space-collab-section">
          <div className="space-collab-section-heading"><h3>空间成员</h3><span>{details?.members?.length??0} 人（不含所有者）</span></div>
          <div className="space-collab-member-list">
            {details?.members?.map(member=><div className="space-collab-member" key={member.userId}>
              <span className="space-collab-avatar" aria-hidden="true">{(member.name||member.email||"星").slice(0,1)}</span>
              <div className="space-collab-member-name"><b>{member.name||"协作者"}</b><small>{member.email??"已验证账号"}</small></div>
              <select aria-label={"修改 "+member.name+" 的权限"} value={member.role} disabled={busy||(member.role==="admin"&&access.role!=="owner")}
                onChange={e=>{
                  const next=e.target.value;
                  if(window.confirm("确定将 "+member.name+" 设为"+ROLE_LABEL[next as Role]+"？"))
                    void act("set_role",{userId:member.userId,role:next},"成员权限已更新");
                }}>
                {access.role==="owner"?<option value="admin">管理员</option>:null}
                <option value="editor">可编辑</option><option value="viewer">只读</option>
              </select>
              <button type="button" className="space-collab-subtle danger" disabled={busy} onClick={()=>{
                if(window.confirm("确定移除 "+member.name+" 吗？对应 AI 客户端也将失去此空间权限。"))
                  void act("remove_member",{userId:member.userId},"协作者已移除");
              }}>移除</button>
            </div>)}
            {!details?.members?.length?<p className="space-collab-muted">暂无受邀成员。所有者仍保留管理权限。</p>:null}
          </div>
        </div>:null}
        {access?.canManage?<div className="space-collab-section">
          <div className="space-collab-section-heading"><h3>待接受的邀请</h3><span>{details?.invitations?.length??0} 个</span></div>
          {(details?.invitations??[]).map(item=><div className="space-collab-member" key={item.id}>
            <span className="space-collab-avatar space-collab-pending" aria-hidden="true">✉</span>
            <div className="space-collab-member-name"><b>{item.email}</b>
              <small>{ROLE_LABEL[item.role]} · {new Date(item.expiresAt*1000).toLocaleDateString("zh-CN")} 到期</small></div>
            <button type="button" className="space-collab-subtle danger" disabled={busy} onClick={()=>{
              if(window.confirm("撤销 "+item.email+" 的邀请？"))
                void act("revoke_invite",{invitationId:item.id},"邀请已撤销");
            }}>撤销</button>
          </div>)}
          {!details?.invitations?.length?<p className="space-collab-muted">没有待处理的邮箱邀请。</p>:null}
        </div>:null}
        {access?.canManage&&details?.settings?<div className="space-collab-section">
          <label className="space-collab-inheritance"><span><b>继承上级空间的邀请权限</b>
            <small>关闭后，父级邀请不能直接访问本空间；本空间独立邀请仍有效。</small></span>
            <input type="checkbox" checked={details.settings.inheritPermissions} disabled={busy}
              onChange={e=>{
                const enabled=e.target.checked;
                if(window.confirm(enabled?"恢复父级邀请继承？":"关闭继承会立即收回部分成员和 AI 的访问权限，继续吗？"))
                  void act("set_inheritance",{enabled},enabled?"已开启继承":"已限制上级权限继承");
              }}/></label>
        </div>:null}
        <details className="space-collab-mcp">
          <summary>通过 AI / MCP 共创</summary>
          <p>连接 <code>https://zhangwansen.click/mcp</code>，确保授权账号有本空间权限，并拥有 <code>xingyu.read</code> 与 <code>xingyu.draft</code>。协作文档必须使用 <code>get_collaboration_document</code> 和 <code>propose_document_change</code>，不要使用旧版覆盖接口。</p>
          <button type="button" onClick={()=>void navigator.clipboard.writeText(
            "使用 XINGYU MCP 操作知识空间 #"+spaceId+"（"+spaceName+"）。先 get_collaboration_space 检查权限，list_collaboration_documents 查询文档；编辑前 get_collaboration_document 读取 version，再用 propose_document_change 提交 base_version 和完整 Markdown。冲突交由管理员审核。"
          ).then(()=>setNotice("已复制 AI 共创指令")).catch(()=>setNotice("复制失败"))}>复制 AI 指令</button>
        </details>
      </div>
      <footer><button type="button" onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}

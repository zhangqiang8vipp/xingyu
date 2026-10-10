"use client";
import { useCallback,useEffect,useState,type FormEvent } from "react";

type Workspace={id:number;name:string;kind:string;role:string};
type Member={userId:number;name:string;email:string|null;role:string;joinedAt:string};
type Invite={id:number;email:string;role:string;expiresAt:number};
type Reply={error?:string;members?:Member[];invitations?:Invite[];workspace?:Workspace;invitation?:Invite;ok?:boolean};
const border="1px solid var(--admin-line)";
async function request(url:string,method="GET",data?:object):Promise<Reply>{
  const response=await fetch(url,{method,credentials:"same-origin",cache:"no-store",
    ...(data?{headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}:{})});
  const body=await response.json().catch(()=>({})) as Reply;
  if(!response.ok)throw new Error(body.error??"操作失败");
  return body;
}

export default function CollaborationPanel({workspaces}:{workspaces:Workspace[]}){
  const [selectedId,setSelectedId]=useState(workspaces[0]?.id??0);
  const selected=workspaces.find(w=>w.id===selectedId);
  const [newName,setNewName]=useState("");
  const [email,setEmail]=useState("");
  const [inviteRole,setInviteRole]=useState("editor");
  const [members,setMembers]=useState<Member[]>([]);
  const [invitations,setInvitations]=useState<Invite[]>([]);
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const canManage=selected?.kind==="shared"&&(selected.role==="owner"||selected.role==="admin");
  const root="/api/workspaces/"+selectedId;
  const reload=useCallback(async()=>{
    if(!selectedId)return;
    const [a,b]=await Promise.all([
      request("/api/workspaces/"+selectedId+"/members"),
      ...(canManage?[request("/api/workspaces/"+selectedId+"/invitations")]:[]),
    ]);
    setMembers(a.members??[]);
    setInvitations(b?.invitations??[]);
  },[selectedId,canManage]);
  useEffect(()=>{
    if(selected?.kind!=="shared")return;
    let active=true;
    const id=selectedId;
    void Promise.all([
      request("/api/workspaces/"+id+"/members"),
      ...(canManage?[request("/api/workspaces/"+id+"/invitations")]:[]),
    ]).then(([a,b])=>{
      if(!active)return;
      setMembers(a.members??[]);
      setInvitations(b?.invitations??[]);
    }).catch(error=>{if(active)setNotice(error instanceof Error?error.message:"读取失败");});
    return ()=>{active=false;};
  },[selectedId,selected?.kind,canManage]);
  async function run(action:()=>Promise<unknown>,success:string,refresh=false){
    setBusy(true);setNotice("");
    try{
      await action();
      if(refresh)await reload();
      setNotice(success);
    }catch(error){setNotice(error instanceof Error?error.message:"操作失败");}
    finally{setBusy(false);}
  }
  function create(event:FormEvent){
    event.preventDefault();
    void run(async()=>{
      await request("/api/workspaces","POST",{name:newName});
      window.location.reload();
    },"工作区已创建");
  }
  function invite(event:FormEvent){
    event.preventDefault();
    void run(async()=>{
      await request(root+"/invitations","POST",{email,role:inviteRole});
      setEmail("");
    },"邀请邮件已发送",true);
  }
  async function changeRole(member:Member,next:string){
    if(!window.confirm("将 "+member.name+" 调整为 "+next+"？权限会立即变化。"))return;
    await run(()=>request(root+"/members/"+member.userId,"PATCH",{role:next}),"成员权限已更新",true);
  }
  async function remove(member:Member){
    if(!window.confirm("移除 "+member.name+"？其网站和 MCP 工作区权限将立即失效。"))return;
    await run(()=>request(root+"/members/"+member.userId,"DELETE"),"成员已移除",true);
  }
  async function leave(){
    if(!window.confirm("退出共享工作区？之后无法读取其中的文章和附件。"))return;
    await run(async()=>{
      await request(root+"/members/leave","POST");
      window.location.reload();
    },"已退出工作区");
  }
  return <section className="editor-section" style={{marginTop:18}}>
    <h2>共享与协作</h2>
    <p>个人工作区保持私有。需要与他人合作时创建共享工作区，并通过邮箱邀请成员。</p>
    <form onSubmit={create} style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end"}}>
      <label>新共享工作区名称
        <input required minLength={1} maxLength={80} value={newName}
          onChange={e=>setNewName(e.target.value)} placeholder="例如：产品研发团队"
          style={{display:"block",padding:9,marginTop:5}}/>
      </label>
      <button className="new-button" type="submit" disabled={busy}>创建共享工作区</button>
    </form>
    <hr style={{margin:"22px 0",borderTop:border,borderBottom:0}}/>
    <label>选择要管理的工作区
      <select value={selectedId} onChange={e=>{setSelectedId(Number(e.target.value));setNotice("");}}
        style={{display:"block",padding:9,marginTop:6,maxWidth:"100%"}}>
        {workspaces.map(w=><option key={w.id} value={w.id}>{w.name} · {w.role}</option>)}
      </select>
    </label>
    {notice?<p role="status" style={{padding:10}}>{notice}</p>:null}
    {selected?.kind!=="shared"?<p>这是私人工作区，仅属于你。请选择共享工作区管理成员。</p>:
    <>
      <h3>工作区成员</h3>
      <div style={{display:"grid",gap:10}}>
        {members.map(member=><div className="integration-card" key={member.userId} style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div><strong>{member.name}</strong> <small>{member.email??""}</small><div><small>{member.role}</small></div></div>
          {canManage&&member.role!=="owner"&&!(selected.role==="admin"&&member.role==="admin")?
          <div style={{display:"flex",gap:7,alignItems:"center"}}>
            <label>权限 <select disabled={busy} value={member.role} onChange={e=>void changeRole(member,e.target.value)}>
              {selected.role==="owner"?<option value="admin">Admin</option>:null}
              <option value="editor">Editor</option><option value="viewer">Viewer</option>
            </select></label>
            <button className="admin-account-danger" type="button" disabled={busy} onClick={()=>void remove(member)}>移除</button>
          </div>:null}
        </div>)}
      </div>
      {selected.role!=="owner"?<p><button disabled={busy} onClick={()=>void leave()} type="button">退出此共享工作区</button></p>:null}
      {canManage?<section style={{marginTop:20}}>
        <h3>邀请成员</h3>
        <form onSubmit={invite} style={{display:"flex",gap:8,alignItems:"end",flexWrap:"wrap"}}>
          <label>受邀邮箱 <input type="email" required maxLength={254} value={email}
            onChange={e=>setEmail(e.target.value)} placeholder="member@example.com" style={{display:"block",padding:8}}/></label>
          <label>角色 <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={{display:"block",padding:8}}>
            {selected.role==="owner"?<option value="admin">Admin</option>:null}
            <option value="editor">Editor</option><option value="viewer">Viewer</option>
          </select></label>
          <button className="new-button" type="submit" disabled={busy}>发送邀请</button>
        </form>
        <h3 style={{marginTop:20}}>待接受的邀请</h3>
        {!invitations.length?<p>暂无等待接受的邀请。</p>:
        <ul>{invitations.map(i=><li key={i.id} style={{marginBottom:8}}>
          {i.email} · {i.role}
          <button className="admin-account-danger" type="button" disabled={busy} style={{marginLeft:10}}
            onClick={()=>void run(()=>request(root+"/invitations/"+i.id,"DELETE"),"邀请已撤销",true)}>撤销</button>
        </li>)}</ul>}
      </section>:null}
    </>}
  </section>;
}

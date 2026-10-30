"use client";
import { useCallback,useEffect,useState } from "react";
type Connection={clientId:string;clientName:string;registeredName?:string;resource:string;scopes:string;grantedAt:number};
async function loadConnections(){
  const response=await fetch("/api/identity/connections",{credentials:"same-origin",cache:"no-store"});
  const json=await response.json().catch(()=>({})) as {connections?:Connection[];error?:string};
  if(!response.ok)throw new Error(json.error??"读取授权连接失败");
  return json.connections??[];
}
export default function ConnectionsPanel(){
  const [connections,setConnections]=useState<Connection[]>([]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");
  const [editing,setEditing]=useState("");
  const [editName,setEditName]=useState("");
  const [message,setMessage]=useState("");
  const reload=useCallback(async()=>setConnections(await loadConnections()),[]);
  useEffect(()=>{
    let active=true;
    void loadConnections().then(items=>{if(active)setConnections(items);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"读取授权连接失败");});
    return ()=>{active=false};
  },[]);
  async function rename(clientId:string){
    const label=editName.trim();
    if(!label||label.length>40){setError("备注须为 1–40 个字符");return;}
    setBusy(clientId);setError("");setMessage("");
    try{
      const response=await fetch("/api/identity/connections",{method:"PATCH",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:clientId,label})});
      const data=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw Error(data.error??"保存失败");
      setEditing("");setMessage("备注已更新，仅在星屿内显示");
      await reload();
    }catch(error){setError(error instanceof Error?error.message:"保存失败");}
    finally{setBusy("");}
  }
  async function revoke(clientId:string){
    if(!window.confirm("撤销此 MCP 客户端的全部星屿授权？客户端必须重新登录授权才能连接。"))return;
    setBusy(clientId);setError("");
    try{
      const response=await fetch("/api/identity/connections",{method:"DELETE",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:clientId})});
      const data=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(data.error??"撤销失败");
      await reload();
    }catch(e){setError(e instanceof Error?e.message:"撤销失败");}
    finally{setBusy("");}
  }
  return <section className="editor-section" style={{marginTop:18}}>
    <h2>已连接的 AI 客户端</h2><p>这些连接通过独立的 MCP OAuth 授权，与邮箱登录不是同一个令牌体系。</p>
    {error?<p role="alert">{error}</p>:null}
    {message?<p role="status">{message}</p>:null}
    {connections.length===0?<p>暂无已授权连接。</p>:
      <ul>{connections.map(item=><li key={item.clientId} style={{marginBottom:12}}>
        <strong>{item.clientName}</strong>
        <small style={{display:"block",margin:"6px 0",lineHeight:1.6}}>
          客户端自报：{item.registeredName??item.clientName} · ID：{item.clientId.slice(0,18)}
          {" · "}星屿账号授权，不代表远端 AI 登录账号
        </small>
        <span>{item.scopes}</span>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:9}}>
          <button type="button" disabled={Boolean(busy)}
            onClick={()=>{setEditing(item.clientId);setEditName(item.clientName);}}>
            修改备注
          </button>
          <button className="admin-account-danger" type="button" disabled={Boolean(busy)}
            onClick={()=>revoke(item.clientId)}>{busy===item.clientId?"处理中…":"撤销连接"}</button>
        </div>
        {editing===item.clientId&&<form onSubmit={event=>{event.preventDefault();void rename(item.clientId);}}
          style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:11}}>
          <label>连接备注
            <input autoFocus maxLength={40} value={editName}
              onChange={event=>setEditName(event.target.value)}/>
          </label>
          <button type="submit" disabled={Boolean(busy)||!editName.trim()}>保存</button>
          <button type="button" onClick={()=>setEditing("")}>取消</button>
        </form>}
      </li>)}</ul>}
  </section>;
}

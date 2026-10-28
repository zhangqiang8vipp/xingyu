"use client";
import { useCallback,useEffect,useState } from "react";
import Link from "next/link";
type Connection={clientId:string;clientName:string;resource:string;scopes:string;grantedAt:number};
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
  const [loaded,setLoaded]=useState(false);
  const reload=useCallback(async()=>setConnections(await loadConnections()),[]);
  useEffect(()=>{
    let active=true;
    void loadConnections().then(items=>{if(active)setConnections(items);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"读取授权连接失败");})
      .finally(()=>{if(active)setLoaded(true);});
    return ()=>{active=false};
  },[]);
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
    {!loaded?<p role="status">正在读取连接…</p>:connections.length===0&&!error?<div className="integration-card"><strong>连接你的第一个 AI 客户端</strong><p>先选择 OAuth 或个人 Token，再在 AI 客户端中添加星屿 MCP 服务。授权成功后会显示在这里。</p><Link href="/connect">查看接入方式 ↗</Link></div>:
      <ul>{connections.map(item=><li key={item.clientId} style={{marginBottom:12}}>
        <strong>{item.clientName}</strong> · {item.scopes}
        <button className="admin-account-danger" type="button" disabled={Boolean(busy)} onClick={()=>revoke(item.clientId)}
          style={{marginLeft:12}}>{busy===item.clientId?"撤销中…":"撤销连接"}</button>
      </li>)}</ul>}
  </section>;
}

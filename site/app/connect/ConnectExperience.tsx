"use client";
import { useCallback, useEffect, useState } from "react";

type Item={id:number;name:string;tokenSuffix:string;scopes:string[];expiresAt:number|null;revokedAt:number|null;lastUsedAt:number|null;createdAt:number};
const endpoint="https://zhangwansen.click/mcp";
const expiryOptions:[string,string|number][]=[["7 天",7],["30 天",30],["90 天",90],["180 天",180],["365 天",365],["永久","never"]];
const scopeNames:Record<string,string>={"xingyu.read":"读取","xingyu.draft":"草稿","xingyu.publish":"发布"};
function fmt(value:number|null){return value===null?"永久":new Date(value*1000).toLocaleDateString("zh-CN");}
function copy(value:string){return navigator.clipboard.writeText(value);}
export default function ConnectExperience(){
  const [tab,setTab]=useState<"pat"|"oauth">("pat");
  const [user,setUser]=useState<null|{userId:number}>(null);
  const [tokens,setTokens]=useState<Item[]>([]);
  const [name,setName]=useState("");
  const [lifetime,setLifetime]=useState<string>("90");
  const [draft,setDraft]=useState(true);
  const [publish,setPublish]=useState(false);
  const [revealed,setRevealed]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [showForm,setShowForm]=useState(false);
  const refresh=useCallback(async()=>{
    const response=await fetch("/api/identity/tokens",{cache:"no-store",credentials:"same-origin"});
    if(response.ok){const data=await response.json() as {tokens:Item[]};setTokens(data.tokens);}
  },[]);
  useEffect(()=>{
    let live=true;
    void fetch("/api/identity/me",{cache:"no-store"}).then(r=>r.json()).then((d:{user?:{userId:number}})=>{
      if(!live)return;
      setUser(d.user??null);
      if(d.user)void refresh();
    }).catch(()=>{});
    return()=>{live=false;};
  },[refresh]);
  async function create(){
    setBusy(true);setNotice("");
    try{
      const scopes=["xingyu.read",...(draft?["xingyu.draft"]:[]),...(publish?["xingyu.publish"]:[])];
      const response=await fetch("/api/identity/tokens",{
        method:"POST",headers:{"content-type":"application/json"},
        credentials:"same-origin",body:JSON.stringify({name,scopes,lifetime:lifetime==="never"?"never":Number(lifetime)})
      });
      const data=await response.json() as {created?:{token:string};error?:string};
      if(!response.ok||!data.created)throw Error(data.error??"创建失败");
      setRevealed(data.created.token);setName("");setShowForm(false);await refresh();
    }catch(e){setNotice(e instanceof Error?e.message:"创建失败");}
    finally{setBusy(false);}
  }
  async function revoke(id:number){
    if(!window.confirm("确认撤销这个 Token？撤销后无法恢复，不影响其他 Token。"))return;
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/identity/tokens",{
        method:"DELETE",headers:{"content-type":"application/json"},
        credentials:"same-origin",body:JSON.stringify({id})
      });
      const data=await response.json() as {error?:string};
      if(!response.ok)throw Error(data.error??"撤销失败");
      await refresh();
    }catch(e){setNotice(e instanceof Error?e.message:"撤销失败");}
    finally{setBusy(false);}
  }
  return <section className="xy-connect" aria-label="星屿 MCP 接入">
    <div className="xy-connect-head"><div><p>01 / CONNECT TO XINGYU</p><h2>选择你的接入方式。</h2><span>同一条 MCP 服务地址，两种认证方式，都属于你自己的星屿账号。</span></div><code>{endpoint}</code></div>
    <div className="xy-connect-tabs" role="tablist" aria-label="认证方式">
      <button type="button" role="tab" aria-selected={tab==="pat"} className={tab==="pat"?"active":""} onClick={()=>setTab("pat")}>个人 Access Token <small>手动配置</small></button>
      <button type="button" role="tab" aria-selected={tab==="oauth"} className={tab==="oauth"?"active":""} onClick={()=>setTab("oauth")}>OAuth 授权 <small>支持的客户端自动登录</small></button>
    </div>
    {tab==="pat"?<div className="xy-connect-panel" role="tabpanel">
      <header><div><h3>我的访问令牌</h3><p>为 Cursor、脚本和无法使用 OAuth 的客户端生成独立 Token。每个 Token 可单独撤销。</p></div>
        {user?<button className="xy-connect-primary" type="button" onClick={()=>setShowForm(v=>!v)}>＋ 创建 Token</button>:<a className="xy-connect-primary" href="/login?return_to=%2Fconnect">登录后创建</a>}
      </header>
      {user?<>
        {showForm?<form className="xy-connect-form" onSubmit={e=>{e.preventDefault();void create();}}>
          <label>名称<input value={name} required minLength={2} maxLength={60} onChange={e=>setName(e.target.value)} placeholder="例如 Cursor · MacBook"/></label>
          <label>有效期<select value={lifetime} onChange={e=>setLifetime(e.target.value)}>{expiryOptions.map(([label,value])=><option key={value} value={value}>{label}</option>)}</select></label>
          <fieldset><legend>允许的操作</legend><label><input checked disabled type="checkbox"/> 读取</label><label><input checked={draft} onChange={e=>setDraft(e.target.checked)} type="checkbox"/> 创建和修改草稿</label><label><input checked={publish} onChange={e=>setPublish(e.target.checked)} type="checkbox"/> 发布与撤回（敏感权限）</label></fieldset>
          {lifetime==="never"?<p>永久 Token 不会自动到期。请妥善保管，并在不再使用时立即撤销。</p>:null}
          <button disabled={busy} className="xy-connect-primary" type="submit">生成新的 Token</button>
        </form>:null}
        {revealed?<div className="xy-connect-secret" role="status"><strong>请立即复制：完整 Token 仅展示一次。</strong><code>{revealed}</code><button onClick={()=>void copy(revealed)} type="button">复制 Token</button><button onClick={()=>setRevealed("")} type="button">我已保存</button></div>:null}
        {notice?<p role="alert">{notice}</p>:null}
        <div className="xy-token-list">{tokens.length?tokens.map(t=><article key={t.id}>
          <div><strong>{t.name}</strong><code>xy_pat_••••••••{t.tokenSuffix}</code><p>{t.scopes.map(s=>scopeNames[s]??s).join(" · ")} · {t.revokedAt?"已撤销":t.expiresAt!==null&&t.expiresAt<=Date.now()/1000?"已过期":"有效"} · {fmt(t.expiresAt)}</p><small>最近使用：{t.lastUsedAt?new Date(t.lastUsedAt*1000).toLocaleString("zh-CN"):"从未使用"}</small></div>
          {!t.revokedAt?<button disabled={busy} type="button" onClick={()=>void revoke(t.id)}>撤销</button>:null}
        </article>):<p>你还没有创建 Token。</p>}</div>
      </>:<p className="xy-login-note">登录星屿后，在此创建和管理你的专属 Token。Token 只属于当前账号，与其他用户完全隔离。</p>}
      <div className="xy-connect-howto"><h4>手动接入</h4><p>将地址填入客户端的 Streamable HTTP MCP 配置；支持自定义 HTTP 请求头时添加：</p><pre>{`Authorization: Bearer <你的个人 Token>`}</pre><p>Token 不应写入仓库、提交记录或聊天消息。不同客户端的配置格式请以客户端文档为准。</p></div>
    </div>:<div className="xy-connect-panel" role="tabpanel">
      <header><div><h3>OAuth 自动授权</h3><p>适用于支持 MCP OAuth 的客户端，无需提前创建个人 Token。</p></div></header>
      <div className="xy-connect-howto"><h4>三步完成</h4><ol><li>在客户端添加星屿 MCP 服务地址：<code>{endpoint}</code></li><li>客户端打开星屿授权页面，登录并确认读取、草稿或发布权限。</li><li>授权后正常使用 MCP；你可以在工作区管理并撤销授权。</li></ol>
        <p>ChatGPT 与 Grok 已有服务端 OAuth 客户端配置。具体能否成功接入，取决于客户端功能和回调地址配置。</p><a href="/workspace">打开我的工作区 →</a></div>
    </div>}
  </section>;
}

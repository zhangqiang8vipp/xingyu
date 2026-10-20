"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import "./personal-tokens.css";

type PersonalToken = {
  id: number;
  name: string;
  tokenSuffix: string;
  scopes: string[];
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
};
type TokenResponse = { tokens?: PersonalToken[]; created?: { id: number; token: string }; rotated?: { id: number; token: string }; error?: string };
const lifetimeOptions = [
  { value: "7", label: "7 天" },
  { value: "30", label: "30 天" },
  { value: "90", label: "90 天（推荐）" },
  { value: "180", label: "180 天" },
  { value: "365", label: "365 天" },
  { value: "never", label: "永久（手动撤销）" },
];
async function writeSecret(token:string):Promise<boolean>{
  try{await navigator.clipboard.writeText(token);return true;}
  catch{return false;}
}

async function loadOwnTokens(): Promise<{ loginRequired: boolean; tokens: PersonalToken[] }> {
  const response = await fetch("/api/identity/tokens", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) return { loginRequired: true, tokens: [] };
  const data = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok) throw new Error(data.error ?? "读取 Token 失败");
  return { loginRequired: false, tokens: data.tokens ?? [] };
}

const scopeLabels: Record<string, string> = {
  "xingyu.read": "读取", "xingyu.draft": "草稿写入", "xingyu.publish": "发布与撤回",
};

function dateLabel(value: number | null) {
  return value === null ? "永久" : new Date(value * 1000).toLocaleDateString("zh-CN");
}
function timestamp(value: number | null) {
  return value === null ? "尚未使用" : new Date(value * 1000).toLocaleString("zh-CN");
}

export default function PersonalTokensPanel() {
  const [items, setItems] = useState<PersonalToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshotAt, setSnapshotAt] = useState(0);
  const [loginRequired, setLoginRequired] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [lifetime, setLifetime] = useState("90");
  const [allowDraft, setAllowDraft] = useState(true);
  const [allowPublish, setAllowPublish] = useState(false);
  const [revealed, setRevealed] = useState<{ id: number; token: string; rotated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const result = await loadOwnTokens();
    setLoginRequired(result.loginRequired);
    if (!result.loginRequired) setItems(result.tokens);
    setSnapshotAt(Math.floor(Date.now() / 1000));
    setLoading(false);
  }, []);
  useEffect(() => {
    // Keep the effect itself subscription-only: React state changes happen
    // after an external HTTP response, not synchronously during effect setup.
    let active = true;
    void loadOwnTokens().then(result => {
      if (!active) return;
      setLoginRequired(result.loginRequired);
      if (!result.loginRequired) setItems(result.tokens);
      setSnapshotAt(Math.floor(Date.now() / 1000));
      setLoading(false);
    }).catch(error => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : "读取 Token 失败");
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setRevealed(null);
    try {
      const scopes = [
        "xingyu.read",
        ...(allowDraft ? ["xingyu.draft"] : []),
        ...(allowPublish ? ["xingyu.publish"] : []),
      ];
      const response = await fetch("/api/identity/tokens", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), scopes, lifetime: lifetime === "never" ? "never" : Number(lifetime),
        }),
      });
      const data = await response.json().catch(() => ({})) as TokenResponse;
      if (!response.ok || !data.created) throw new Error(data.error ?? "创建 Token 失败");
      setRevealed({id:data.created.id,token:data.created.token,rotated:false});
      setName(""); setShowForm(false);
      const copied=await writeSecret(data.created.token);
      setMessage(copied?"新 Token 已复制。建议保存到密码管理器。":"Token 已生成，点击下方“复制完整 Token”保存。");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建 Token 失败");
    } finally { setBusy(false); }
  }

  async function revoke(item: PersonalToken) {
    if (!window.confirm("确定单独撤销「" + item.name + "」？此操作不可恢复，不影响其他 Token 和 OAuth 授权。")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/identity/tokens", {
        method: "DELETE", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }),
      });
      const data = await response.json().catch(() => ({})) as TokenResponse;
      if (!response.ok) throw new Error(data.error ?? "撤销失败");
      if(revealed?.id===item.id)setRevealed(null);
      await reload();
      setMessage("已撤销「" + item.name + "」，其他连接不受影响。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤销失败");
    } finally { setBusy(false); }
  }

  async function copySecret() {
    if (!revealed) return;
    const copied=await writeSecret(revealed.token);
    setMessage(copied
      ?"完整 Token 已复制；建议存入可信赖的密钥管理器。"
      :"浏览器无法自动复制。请手动选中下方完整 Token 保存。");
  }

  async function rotate(item:PersonalToken) {
    if(!window.confirm("重新生成「"+item.name+"」将立即使旧 Token 失效。使用旧 Token 的客户端需要重新配置，确定继续吗？"))return;
    setBusy(true);setMessage("");setRevealed(null);
    try{
      const response=await fetch("/api/identity/tokens",{
        method:"PATCH",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({id:item.id}),
      });
      const data=await response.json().catch(()=>({})) as TokenResponse;
      if(!response.ok||!data.rotated)throw new Error(data.error??"重新生成失败");
      setRevealed({id:item.id,token:data.rotated.token,rotated:true});
      const copied=await writeSecret(data.rotated.token);
      setMessage(copied
        ?"新 Token 已复制到剪贴板；旧 Token 已失效，请更新客户端。"
        :"新 Token 已生成，旧 Token 已失效。请立即手动复制下方完整 Token。");
      await reload();
    }catch(error){setMessage(error instanceof Error?error.message:"重新生成失败");}
    finally{setBusy(false);}
  }

  async function remove(item:PersonalToken){
    if(!window.confirm("永久删除「"+item.name+"」？如果它仍在使用，将立即失效，且无法恢复。"))return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/identity/tokens",{
        method:"DELETE",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({id:item.id,mode:"delete"}),
      });
      const data=await response.json().catch(()=>({})) as TokenResponse;
      if(!response.ok)throw new Error(data.error??"删除失败");
      if(revealed?.id===item.id)setRevealed(null);
      await reload();
      setMessage("已彻底删除「"+item.name+"」；这条记录不再出现在列表中。");
    }catch(error){setMessage(error instanceof Error?error.message:"删除失败");}
    finally{setBusy(false);}
  }

  const active = items.filter(token =>
    token.revokedAt === null && (token.expiresAt === null || token.expiresAt > snapshotAt)).length;

  return <section className="editor-section xy-pat-manager" aria-label="个人访问令牌">
    <header className="xy-pat-header">
      <div>
        <small>PERSONAL ACCESS TOKENS</small>
        <h2>我的访问令牌</h2>
        <p>一个 AI 客户端一条 Token。可以独立撤销或永久删除；丢失密钥时可安全换发并复制。</p>
      </div>
      {!loginRequired && !loading && <button type="button" className="xy-pat-create-btn" onClick={() => setShowForm(value => !value)} disabled={busy}>
        {showForm ? "取消创建" : "＋ 创建 Token"}
      </button>}
    </header>

    {loginRequired ? <div className="xy-pat-empty">
      <p>请使用你的星屿邮箱账号登录后创建个人 Token。管理员的旧版密码会话不能代替个人身份。</p>
      <Link href="/login?return_to=%2Fai-connections">登录星屿账号 →</Link>
    </div> : <>
      {showForm && <form className="xy-pat-form" onSubmit={event => void create(event)}>
        <div className="xy-pat-form-grid">
          <label>Token 名称
            <input type="text" autoComplete="off" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={60} required placeholder="例如：Cursor · MacBook"/>
          </label>
          <label>有效期
            <select value={lifetime} onChange={event => setLifetime(event.target.value)}>
              {lifetimeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="xy-pat-scopes"><legend>权限范围</legend>
          <label><input type="checkbox" checked disabled/> 读取 · xingyu.read</label>
          <label><input type="checkbox" checked={allowDraft} onChange={event => setAllowDraft(event.target.checked)}/> 写草稿 · xingyu.draft</label>
          <label><input type="checkbox" checked={allowPublish} onChange={event => setAllowPublish(event.target.checked)}/> 发布与撤回 · xingyu.publish</label>
        </fieldset>
        <p className="xy-pat-notice">{lifetime === "never"
          ? "永久 Token 不会自动过期，但依然可以随时撤销。建议只给可信设备使用。"
          : "凭据到期后将自动失效，可以随时提前撤销并重新生成。"}</p>
        <div className="xy-pat-actions">
          <button type="submit" className="xy-pat-create-btn" disabled={busy}>{busy ? "生成中…" : "生成个人 Token"}</button>
          <span>创建后只展示一次完整密钥，数据库仅保存哈希。</span>
        </div>
      </form>}

      {revealed && <div className="xy-pat-reveal" role="status">
        <strong>{revealed.rotated?"新 Token 已生成，旧 Token 立即失效。":"Token 已生成。"}请妥善保存；离开页面后无法再次查看这段完整密钥。</strong>
        <code>{revealed.token}</code>
        <div><button type="button" onClick={() => void copySecret()}>复制完整 Token</button>
          <button type="button" onClick={() => setRevealed(null)}>我已保存</button></div>
      </div>}
      {message && <p className="xy-pat-message" role="status">{message}</p>}

      <div className="xy-pat-list-heading">
        <div><small>MY CREDENTIALS</small><h3>已生成的 Token</h3></div>
        {!loading && <span>{active} 条有效 · 上限 30 条</span>}
      </div>
      {loading ? <p className="xy-pat-loading">正在读取你的 Token…</p>
      : items.length === 0 ? <div className="xy-pat-empty">还没有 Token。为第一个客户端创建一条专属密钥。</div>
      : <div className="xy-pat-list">{items.map(item => {
        const status = item.revokedAt !== null ? "revoked" : item.expiresAt !== null && item.expiresAt <= snapshotAt ? "expired" : "active";
        return <article className="xy-pat-item" key={item.id}>
          <span className="xy-pat-token-icon" aria-hidden="true">⚿</span>
          <div className="xy-pat-token-info">
            <strong>{item.name}</strong><code>xy_pat_••••••••{item.tokenSuffix}</code>
            <div className="xy-pat-tags">
              <span className={status === "active" ? "xy-pat-tag-ok" : "xy-pat-tag-off"}>{status === "active" ? "有效" : status === "revoked" ? "已撤销" : "已到期"}</span>
              {item.scopes.map(scope => <span key={scope}>{scopeLabels[scope] ?? scope}</span>)}
              <span>有效期：{dateLabel(item.expiresAt)}</span>
            </div>
          </div>
          <div className="xy-pat-token-aside">
            <small>最近使用：{timestamp(item.lastUsedAt)}</small>
            <div className="xy-pat-row-actions">
              {status==="active" && (revealed?.id===item.id
                ? <button type="button" disabled={busy} className="xy-pat-copy" onClick={()=>void copySecret()}>复制 Token</button>
                : <button type="button" disabled={busy} className="xy-pat-copy" onClick={()=>void rotate(item)}>换发并复制</button>)}
              {status==="active"&&<button type="button" disabled={busy} className="xy-pat-danger" onClick={()=>void revoke(item)}>撤销</button>}
              <button type="button" disabled={busy} className="xy-pat-danger" onClick={()=>void remove(item)}>删除</button>
            </div>
          </div>
        </article>;
      })}</div>}
      <p className="xy-pat-footnote">密钥只保存哈希，无法找回旧明文。点击“换发并复制”会让旧密钥立即失效并返回一条新的完整 Token；“删除”会清除记录且立即停止授权。其他 Token 和 OAuth 授权不受影响。</p>
    </>}
  </section>;
}

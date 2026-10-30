"use client";

import Link from "next/link";
import PersonalTokensPanel from "./PersonalTokensPanel";
import AdminAskModelPanel from "./AdminAskModelPanel";
import ClientSetupGuide from "./ClientSetupGuide";
import { useState } from "react";
import { readApiJson } from "@/app/api-response";
import {
  activationFieldLabels,
  displayActivationConnectionName,
  privateWriteActionLabel,
  type BetaActivationSignal,
} from "@/domain/admin/activation";
import type { AdminMcpConnection, AdminMcpSession } from "./admin-types";

const SCOPE_LABELS: Record<string, string> = {
  "xingyu.read": "阅读",
  "xingyu.draft": "草稿写入",
  "xingyu.publish": "线上发布",
  offline_access: "保持连接",
};

export default function AdminIntegrationsPanel({
  initial,
  initialActivation,
  isPersonalAccount = false,
}: {
  initial: AdminMcpConnection[];
  initialActivation: BetaActivationSignal;
  isPersonalAccount?: boolean;
}) {
  const [connections, setConnections] = useState(initial);
  const [activation, setActivation] = useState(initialActivation);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [editKey, setEditKey] = useState<string|null>(null);
  const [editName, setEditName] = useState("");

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/integrations", { cache: "no-store" });
      const data = await readApiJson<{ connections: AdminMcpConnection[]; activation: BetaActivationSignal }>(response);
      if (!response.ok) return setMessage(data.error ?? "状态刷新失败");
      setConnections(data.connections ?? []);
      if (data.activation) setActivation(data.activation);
      setMessage("状态已刷新");
    } catch {
      setMessage("状态刷新失败，请检查网络后重试");
    } finally {
      setRefreshing(false);
    }
  }

  async function copyConnectionAddress() {
    const endpoint = `${window.location.origin}/mcp`;
    try {
      await navigator.clipboard.writeText(endpoint);
      setMessage("AI 连接地址已复制。去 AI 的连接或工具设置里粘贴它，完成授权后回来刷新。");
    } catch {
      setMessage("AI 连接地址：" + endpoint);
    }
  }


  async function revoke(connection:AdminMcpConnection,session?:AdminMcpSession){
    const who=session?.label??connection.name;
    if(!window.confirm("撤销后，"+who+" 必须重新授权才能访问星屿。确认撤销吗？"))return;
    setBusy("revoke");setMessage("");
    try{
      const response=await fetch("/api/integrations",{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"revoke",clientId:connection.id,subject:session?.subject})});
      const data=await readApiJson<{connections:AdminMcpConnection[];activation:BetaActivationSignal}>(response);
      if(!response.ok)throw Error(data.error??"撤销失败");
      setConnections(data.connections??[]);
      if(data.activation)setActivation(data.activation);
      setMessage(who+" 已撤销，已从有效连接列表移至历史记录");
    }catch(error){setMessage(error instanceof Error?error.message:"撤销失败，请重试");}
    finally{setBusy("");}
  }

  function startRename(connection:AdminMcpConnection,session?:AdminMcpSession){
    setEditKey(connection.id+"#"+(session?.subject??""));
    setEditName(session?.label??connection.name);
  }

  async function saveRename(connection:AdminMcpConnection,session?:AdminMcpSession){
    const label=editName.trim();
    if(!label||label.length>40){setMessage("连接名称须为 1–40 个字符");return;}
    setBusy("rename");setMessage("");
    try{
      const response=await fetch("/api/integrations",{method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({clientId:connection.id,subject:session?.subject,label})});
      const data=await readApiJson<{connections:AdminMcpConnection[]}>(response);
      if(!response.ok)throw Error(data.error??"重命名失败");
      setConnections(data.connections??[]);
      setEditKey(null);
      setMessage("名称已保存。只是星屿内的备注，不会改变 AI 平台的实际账号。");
    }catch(error){setMessage(error instanceof Error?error.message:"重命名失败");}
    finally{setBusy("");}
  }

  async function cleanup(connection?:AdminMcpConnection,session?:AdminMcpSession){
    const target=session?.label??connection?.name??"所有无效记录";
    const warning=connection
      ?"清理“"+target+"”的失效授权记录？正在授权的连接不会受到影响。"
      :"清理所有已撤销授权和未授权的动态注册客户端？不会撤销或删除任何有效连接。";
    if(!window.confirm(warning))return;
    setBusy("cleanup");setMessage("");
    try{
      const response=await fetch("/api/integrations",{method:"DELETE",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({clientId:connection?.id,subject:session?.subject})});
      const data=await readApiJson<{cleaned:{revokedGrants:number;unusedClients:number};connections:AdminMcpConnection[]}>(response);
      if(!response.ok)throw Error(data.error??"清理失败");
      setConnections(data.connections??[]);
      setMessage("已清理 "+(data.cleaned?.revokedGrants??0)+" 条撤销授权、"+
        (data.cleaned?.unusedClients??0)+" 个未授权动态客户端；有效授权未变。");
    }catch(error){setMessage(error instanceof Error?error.message:"清理失败");}
    finally{setBusy("");}
  }

  const activeConnections=connections.filter(item=>item.kind==="oauth"&&item.status==="connected");
  const inactiveConnections=connections.filter(item=>item.kind==="oauth"&&
    (item.status!=="connected"||item.sessions.some(session=>session.status==="revoked")));
  const legacyHistory=connections.find(item=>item.kind==="legacy"&&item.sessions.length>0);
  const inactiveTotal=inactiveConnections.length+(legacyHistory?1:0);

  function renderConnection(connection:AdminMcpConnection,inactive:boolean){
    const sessions=inactive
      ? connection.sessions.filter(item=>item.status==="revoked")
      : connection.sessions.filter(item=>item.status==="connected");
    const groupKey=connection.id+"#";
    return <article className="axis-connection-row" key={connection.id}>
      <header className="axis-connection-heading">
        <div className="axis-connection-name">
          <small>{inactive?"历史客户端":"已授权应用"}</small>
          <strong>{connection.name}</strong>
          <span>{connection.registeredName?"客户端自报："+connection.registeredName:"未知客户端"}
            {" · "}{connection.redirectHosts?.length
              ?"登记回调："+connection.redirectHosts.join("、"):"未登记回调域名"}
            {" · 客户端 ID："+connection.id.slice(0,17)+(connection.id.length>17?"…":"")}</span>
          <small>应用信息来自客户端注册，不能证明 ChatGPT、Gemini 或 Google 的登录账号。</small>
        </div>
        <div className="axis-connection-actions">
          <span className={inactive?"axis-connection-state inactive":"axis-connection-state"}>
            {inactive?(connection.status==="connected"?"部分已撤销":connection.status==="revoked"?"已撤销":"未曾授权"):"已授权"}
          </span>
          <button type="button" disabled={Boolean(busy)} onClick={()=>startRename(connection)}>改应用备注</button>
          {inactive&&connection.status!=="connected"&&<button type="button" disabled={Boolean(busy)} onClick={()=>void cleanup(connection)}>清理记录</button>}
        </div>
      </header>
      {editKey===groupKey&&<form className="axis-connection-rename" onSubmit={event=>{
        event.preventDefault();void saveRename(connection);
      }}>
        <label>应用显示备注<input autoFocus maxLength={40} value={editName}
          onChange={event=>setEditName(event.target.value)}/></label>
        <button type="submit" disabled={Boolean(busy)||!editName.trim()}>保存</button>
        <button type="button" onClick={()=>setEditKey(null)}>取消</button>
      </form>}
      {sessions.length>0&&<ul className="axis-connection-grants">
        {sessions.map(session=><li key={connection.id+":"+session.subject}>
          <div>
            <div className="axis-connection-grant-title">
              <b>{session.label}</b>
              <button type="button" disabled={Boolean(busy)}
                onClick={()=>startRename(connection,session)}>修改备注</button>
              {!inactive&&<button type="button" className="axis-connection-danger"
                disabled={Boolean(busy)} onClick={()=>void revoke(connection,session)}>撤销授权</button>}
              {inactive&&<button type="button" disabled={Boolean(busy)}
                onClick={()=>void cleanup(connection,session)}>清理此条</button>}
            </div>
            <p><strong>授权的星屿账号：</strong>{session.xingyuAccount??"早期授权或账号资料不可核对"}
              {" · "}并非 ChatGPT / Gemini 账号信息</p>
            <p>权限：{session.scopes.map(scope=>SCOPE_LABELS[scope]).filter(Boolean).join(" · ")||"基础访问"}</p>
            {session.scopes.includes("xingyu.publish")&&<em>含线上发布权限</em>}
            <p>授权于 {formatTime(session.grantedAt)||"未知"} ·
              最近实际调用 {formatTime(session.lastUsedAt)||"尚无记录"}
              {" · "}{session.tokenCount} 个有效短期令牌</p>
          </div>
          {editKey===connection.id+"#"+session.subject&&<form
            className="axis-connection-rename" onSubmit={event=>{
              event.preventDefault();void saveRename(connection,session);
            }}>
            <label>本次授权备注<input autoFocus maxLength={40} value={editName}
              onChange={event=>setEditName(event.target.value)}/></label>
            <button type="submit" disabled={Boolean(busy)||!editName.trim()}>保存</button>
            <button type="button" onClick={()=>setEditKey(null)}>取消</button>
          </form>}
        </li>)}
      </ul>}
      {!sessions.length&&<p className="axis-connection-no-grants">尚无有效的星屿账号授权。</p>}
    </article>;
  }

  const write = activation.privateWrite;
  const changed = write ? activationFieldLabels(write.changedFields) : [];

  return <section className="admin-main admin-config-main">
    <header className="admin-header">
      <div>
        <p>AI 协作</p>
        <h1>连接与首次写入</h1>
        <span>不用看技术日志：这里直接告诉你是否已连上、是否真的写进知识空间，以及最近一次知识空间变更是谁做的。</span>
      </div>
    </header>

    <div className="config-form activation-config">
      {!isPersonalAccount&&<AdminAskModelPanel />}
      <PersonalTokensPanel />
      <ClientSetupGuide />
      {!isPersonalAccount&&<section className="editor-section activation-overview">
        <div className="activation-hero">
          <div>
            <small>{activation.activated ? "FIRST VALUE" : "NEXT STEP"}</small>
            <h2>{stageTitle(activation)}</h2>
            <p>{stageDescription(activation)}</p>
          </div>
          <button className="activation-refresh" type="button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "刷新中…" : "刷新状态"}
          </button>
        </div>

        <ol className="activation-steps">
          <ActivationStep
            index={1}
            done={activation.knowledgeCount > 0}
            title="知识空间里有真实知识"
            detail={activation.knowledgeCount > 0 ? "当前已有 " + activation.knowledgeCount + " 篇知识空间内容可用于协作。" : "先把一篇你真正会继续使用的知识放进知识空间。"}
          />
          <ActivationStep
            index={2}
            done={activation.connected || Boolean(write)}
            title={activation.connected ? "AI 已连接" : write ? "AI 已连接过" : "AI 已连接"}
            detail={activation.connected ? "当前已连接：" + activation.connectionNames.join("、") : write ? "当前没有有效连接，但首次写入记录仍保留。" : "还没有可用连接。"}
          />
          <ActivationStep
            index={3}
            done={Boolean(write)}
            title="AI 完成一次知识空间写入"
            detail={write ? write.actor + " 已经留下知识空间写入记录。" : activation.connected ? "已连接，但还没有发生知识空间写入。" : "连接后，让 AI 保存或更新一篇知识空间内容。"}
          />
        </ol>

        <div className="activation-next">
          <strong>现在做什么</strong>
          <p>{nextStepCopy(activation)}</p>
          {activation.stage === "needs-knowledge"
            ? <Link href="/admin?section=spaces">打开知识空间</Link>
            : activation.stage === "needs-connection"
              ? <button type="button" onClick={() => void copyConnectionAddress()}>复制 AI 连接地址</button>
              : activation.stage === "connected-only"
                ? <code>把这段真实内容保存到知识空间，作为草稿，不要发布。</code>
                : activation.stage === "activated" && !activation.connected
                  ? <button type="button" onClick={() => void copyConnectionAddress()}>复制 AI 连接地址</button>
                  : null}
        </div>

        {write ? <article className="activation-proof">
          <header>
            <div>
              <small>最近一次知识空间写入</small>
              <strong>{write.actor} {privateWriteActionLabel(write.action)}《{write.title}》</strong>
            </div>
            <time dateTime={write.createdAt}>{formatTime(write.createdAt) || "时间未知"}</time>
          </header>
          <p>{write.summary || "已完成一次真实内容写入。"}</p>
          <span>变更：{changed.length ? changed.join(" · ") : "内容已更新"}</span>
          <div>
            <Link href={"/admin?section=articles&edit=" + write.postId}>查看这篇内容</Link>
            <em>这条记录来自知识空间写入；知识空间内容仍受私有边界保护。</em>
          </div>
        </article> : null}
      </section>}


      {!isPersonalAccount&&<section className="editor-section axis-connection-manager" aria-label="AI 授权连接管理">
        <div className="editor-section-title"><span>02</span><div>
          <b>连接详情</b>
          <small>默认只显示已授权连接。应用自报信息与真正的星屿授权账号分别列出，历史记录可折叠清理。</small>
        </div></div>
        <div className="axis-connection-summary">
          <div><strong>{activeConnections.length}</strong><span>个已授权客户端</span></div>
          <div><strong>{inactiveTotal}</strong><span>个历史 / 未授权客户端</span></div>
          <button type="button" disabled={refreshing||Boolean(busy)} onClick={()=>void refresh()}>
            {refreshing?"刷新中…":"刷新连接"}
          </button>
        </div>
        {activeConnections.length
          ? <div className="axis-connection-list">{activeConnections.map(connection=>renderConnection(connection,false))}</div>
          : <p className="axis-connection-empty">暂无有效 OAuth 授权。新连接在授权后才会出现在这里，单纯注册不会占据列表。</p>}
        {inactiveTotal>0&&<details className="axis-connection-history">
          <summary>历史与待清理记录 · {inactiveTotal} 个 <span>展开查看</span></summary>
          <div className="axis-connection-history-controls">
            <p>已撤销授权与仅注册的客户端不会自动变成有效连接。清理不会影响仍在授权的客户端。</p>
            <button type="button" disabled={Boolean(busy)} onClick={()=>void cleanup()}>
              {busy==="cleanup"?"正在清理…":"清理全部无效记录"}
            </button>
          </div>
          <div className="axis-connection-list">
            {inactiveConnections.map(connection=>renderConnection(connection,true))}
            {legacyHistory&&<article className="axis-connection-row">
              <header className="axis-connection-heading"><div className="axis-connection-name">
                <small>旧版环境密钥 · 历史调用</small>
                <strong>{displayActivationConnectionName(legacyHistory)}</strong>
                <span>最后记录 {formatTime(legacyHistory.lastUsedAt)||"未知"}。
                  历史调用不代表密钥目前仍有效；请在服务端轮换或停用。</span>
              </div></header>
            </article>}
          </div>
        </details>}
        <p className="axis-connection-disclosure">
          星屿能核实的是谁用星屿账号完成授权；OAuth 客户端不会向星屿提供其 ChatGPT、Gemini 或 Google 登录邮箱。
          若要关联远端账号，需要对方平台另行提供明确的身份授权能力。
        </p>
      </section>}
      {isPersonalAccount&&<section className="editor-section"><div className="editor-section-title"><span>02</span><div><b>个人连接</b><small>仅管理当前账号自己的访问令牌</small></div></div><p>这里沿用原后台的连接页面样式。个人令牌和客户端接入说明显示在上方；站点级连接、全站会话和撤销操作仅管理员可见。</p></section>}
      <footer className="config-footer"><span role="status" aria-live="polite">{message || (isPersonalAccount ? "个人连接与站点级连接分开管理，避免看到其他账号的授权数据。" : "连接成功不等于激活；只有发生真实知识空间写入后，才会出现上方变更证明。")}</span></footer>
    </div>
  </section>;
}

function ActivationStep({
  index,
  done,
  title,
  detail,
}: {
  index: number;
  done: boolean;
  title: string;
  detail: string;
}) {
  return <li className={done ? "done" : undefined}>
    <i>{done ? "✓" : index}</i>
    <div><b>{title}</b><span>{detail}</span></div>
  </li>;
}

function stageTitle(activation: BetaActivationSignal) {
  if (activation.stage === "needs-knowledge") return "先把真实知识放进知识空间";
  if (activation.stage === "needs-connection") return "知识已经就绪，下一步连接 AI";
  if (activation.stage === "connected-only") return "已连接，还差一次知识空间写入";
  return "首次价值路径已完成";
}

function stageDescription(activation: BetaActivationSignal) {
  if (activation.stage === "connected-only") return "现在只是“连上了”，还不能算激活。只有在知识空间里完成一次创建或更新后，星屿才会留下可核对的激活证明。";
  if (activation.stage === "activated") return activation.connected
    ? "星屿已经观察到真实知识空间写入，并保留了执行者、时间、内容和变更范围。"
    : "首次知识空间写入已经完成并留有证明；当前没有有效连接，需要继续协作时可以重新连接。";
  if (activation.stage === "needs-connection") return "知识空间已有真实内容，但还没有可用的 AI 连接。";
  return "激活从知识空间里的真实知识开始，而不是从公开博客文章或一条空连接开始。";
}

function nextStepCopy(activation: BetaActivationSignal) {
  if (activation.stage === "needs-knowledge") return "先在“知识空间”放入一篇真实内容。普通公开博客文章不计入本次激活，也不要为了过流程创建无意义的测试空壳。";
  if (activation.stage === "needs-connection") return "在你常用 AI 的“连接”或“工具”设置里新增星屿，粘贴下面复制的地址；出现星屿授权页时确认访问，然后回这里刷新。";
  if (activation.stage === "connected-only") return "回到刚连接的 AI，给它一段你愿意长期保存的真实内容，并明确要求保存到知识空间、作为草稿、不要发布。";
  if (!activation.connected) return "先核对下面的历史变更证明；需要继续让 AI 协作时，再重新连接。";
  return "核对下面的变更证明是否符合你的意图；如果不符合，回到对应内容继续修正，而不是直接发布。";
}

function statusLabel(status: AdminMcpConnection["status"]) {
  if (status === "connected") return "已连接";
  if (status === "revoked") return "已撤销";
  return "等待连接";
}

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

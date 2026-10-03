"use client";

import Link from "next/link";
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
}: {
  initial: AdminMcpConnection[];
  initialActivation: BetaActivationSignal;
}) {
  const [connections, setConnections] = useState(initial);
  const [activation, setActivation] = useState(initialActivation);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);

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

  async function revoke(connection: AdminMcpConnection, session?: AdminMcpSession) {
    const who = session?.label ?? connection.name;
    if (!window.confirm("撤销后，" + who + " 必须重新连接才能访问星屿。确认撤销吗？")) return;
    const response = await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", clientId: connection.id, subject: session?.subject }),
    });
    const data = await readApiJson<{ connections: AdminMcpConnection[]; activation: BetaActivationSignal }>(response);
    if (!response.ok) return setMessage(data.error ?? "撤销失败");
    setConnections(data.connections ?? []);
    if (data.activation) setActivation(data.activation);
    setMessage(who + " 已撤销");
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
      <section className="editor-section activation-overview">
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
      </section>

      <section className="editor-section">
        <div className="editor-section-title"><span>02</span><div><b>连接详情</b><small>查看哪些 AI 当前还能访问星屿，也可以撤销单次连接</small></div></div>
        {connections.map((connection) => (
          <article className="integration-card" key={connection.id}>
            <div>
              <small>{connection.kind === "legacy" ? "旧版连接" : "账号连接"}</small>
              <b>{displayActivationConnectionName(connection)}</b>
              <span>状态：{statusLabel(connection.status)}{connection.sessions.filter((session) => session.status === "connected").length > 1 ? " · " + connection.sessions.filter((session) => session.status === "connected").length + " 个有效连接" : ""}</span>
            </div>
            {connection.sessions.length === 0
              ? <small>等待连接</small>
              : <ul className="integration-sessions">
                {connection.sessions.map((session) => <li key={connection.id + ":" + session.subject}>
                  <div>
                    <strong>{session.label}</strong>
                    <span>可做：{session.scopes.map((scope) => SCOPE_LABELS[scope]).filter(Boolean).join(" · ") || "基础访问"}</span>
                    {session.scopes.includes("xingyu.publish") && <em>含线上发布权限</em>}
                    <span>连接于 {formatTime(session.grantedAt) || "未知"} · 最后使用 {formatTime(session.lastUsedAt) || "尚未使用"}</span>
                  </div>
                  {connection.kind === "oauth" && session.status === "connected"
                    ? <button type="button" onClick={() => void revoke(connection, session)}>撤销此连接</button>
                    : <small>{session.status === "revoked" ? "已撤销" : connection.kind === "legacy" ? "请在服务端停用旧版连接" : "已结束"}</small>}
                </li>)}
              </ul>}
          </article>
        ))}
      </section>
      <footer className="config-footer"><span>{message || "连接成功不等于激活；只有发生真实知识空间写入后，才会出现上方变更证明。"}</span></footer>
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

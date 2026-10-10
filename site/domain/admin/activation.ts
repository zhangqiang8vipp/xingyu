export type BetaActivationStage =
  | "needs-knowledge"
  | "needs-connection"
  | "connected-only"
  | "activated";

export type BetaActivationWriteAction = "create_draft" | "update_post";

export type BetaActivationWrite = {
  activityId: number;
  action: BetaActivationWriteAction;
  postId: number;
  publicId: string;
  title: string;
  actor: string;
  summary: string;
  changedFields: string[];
  createdAt: string;
};

export type BetaActivationSignal = {
  stage: BetaActivationStage;
  activated: boolean;
  knowledgeCount: number;
  connected: boolean;
  connectionNames: string[];
  privateWrite: BetaActivationWrite | null;
};

export function betaActivationStage(input: {
  knowledgeCount: number;
  connected: boolean;
  hasPrivateWrite: boolean;
}): BetaActivationStage {
  if (input.knowledgeCount <= 0) return "needs-knowledge";
  if (input.hasPrivateWrite) return "activated";
  if (input.connected) return "connected-only";
  return "needs-connection";
}

export function isKnowledgeSpacePost(input: {
  spaceId: number | null | undefined;
}) {
  return input.spaceId != null;
}

export function isPrivateActivationWrite(input: {
  action: string;
  spaceId: number | null | undefined;
}) {
  return (input.action === "create_draft" || input.action === "update_post")
    && isKnowledgeSpacePost(input);
}

export type ActivationConnectionIdentity = {
  id: string;
  name: string;
  kind: "legacy" | "oauth";
  sessions: Array<{ subject: string; label: string }>;
};

export function displayActivationConnectionName(connection: Pick<ActivationConnectionIdentity, "kind" | "name">) {
  if (connection.kind !== "legacy") return connection.name.trim() || "AI 连接";
  return connection.name.replace(/\s*·\s*Legacy$/iu, "").trim() || "旧版 AI 连接";
}

export function activityActorLabel(clientLabel: string, connections: ActivationConnectionIdentity[]) {
  if (clientLabel.startsWith("pat:")) return "个人 Access Token";
  if (clientLabel.startsWith("oauth:")) {
    const connection = connections.find((item) => {
      if (item.kind !== "oauth") return false;
      const prefix = `oauth:${item.id}`;
      return clientLabel === prefix || clientLabel.startsWith(prefix + ":");
    });
    if (connection) {
      const prefix = `oauth:${connection.id}:`;
      const subject = clientLabel.startsWith(prefix) ? clientLabel.slice(prefix.length) : "";
      const session = subject ? connection.sessions.find((item) => item.subject === subject) : undefined;
      const connectionName = displayActivationConnectionName(connection);
      return session ? `${connectionName} · ${session.label}` : connectionName;
    }
    return "已连接的 AI";
  }
  if (/chatgpt/i.test(clientLabel)) return "ChatGPT";
  if (/\bgrok\b/i.test(clientLabel)) return "Grok";
  if (/\bclaude\b/i.test(clientLabel)) return "Claude";
  const legacy = connections.find((item) => item.kind === "legacy");
  return legacy ? displayActivationConnectionName(legacy) : "已连接的 AI";
}

export function privateWriteActionLabel(action: BetaActivationWriteAction) {
  return action === "create_draft" ? "创建了知识空间草稿" : "更新了知识空间内容";
}

const FIELD_LABELS: Record<string, string> = {
  title: "标题",
  slug: "链接名称",
  excerpt: "摘要",
  content_markdown: "正文",
  category: "分类",
  space: "知识空间",
  sort_order: "排序",
  featured: "精选状态",
  attachments: "附件",
};

export function activationFieldLabels(fields: string[]) {
  const labels = fields.map((field) => FIELD_LABELS[field] ?? "其他内容");
  return [...new Set(labels)];
}

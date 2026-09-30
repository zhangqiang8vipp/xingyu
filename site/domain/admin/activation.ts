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

export function isPrivateActivationWrite(input: {
  action: string;
  afterStatus: string | null;
  spaceId: number | null | undefined;
}) {
  if (input.action === "create_draft") return true;
  return input.action === "update_post"
    && (input.afterStatus === "draft" || input.spaceId != null);
}

export function privateWriteActionLabel(action: BetaActivationWriteAction) {
  return action === "create_draft" ? "创建了私有草稿" : "更新了私有内容";
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

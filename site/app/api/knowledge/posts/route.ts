import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { scopedCreateDraft, WorkspaceContentError } from "@/db/workspace-content";
import { KnowledgeListError, listKnowledgePage, type KnowledgeListType, type KnowledgeListStatus } from "@/db/knowledge-list";
import { identityFromRequest } from "@/server/auth/identity-session";
import { apiJson, readJson } from "@/server/workspace-http";

export async function GET(request: Request) {
  const user = await identityFromRequest(request);
  if (!user) return apiJson({ error: "请先登录" }, 401);
  if (user.userId === 1) return apiJson({ error: "站点管理员请使用站点管理后台" }, 403);

  try {
    const workspaceId = await ensurePersonalWorkspace(user.userId);
    const params = new URL(request.url).searchParams;
    const mode = params.get("type");
    const type: KnowledgeListType = mode === "public" || mode === "all" ? mode : "mine";
    const query = (params.get("q") ?? "").trim().slice(0, 120);
    const statusRaw = params.get("status");
    const status: KnowledgeListStatus = statusRaw === "draft" || statusRaw === "published" ? statusRaw : "all";
    const category = (params.get("category") ?? "all").slice(0, 140);
    const limit = Math.min(50, Math.max(1, Number(params.get("limit") ?? 30) || 30));
    const result = await listKnowledgePage({
      userId: user.userId, workspaceId, type, query, status, category,
      cursor: params.get("cursor"), limit, origin: new URL(request.url).origin,
    });
    return apiJson({ type, workspaceId, ...result });
  } catch (error) {
    if (error instanceof KnowledgeListError) return apiJson({ error: error.message }, 400);
    if (error instanceof WorkspaceContentError) return apiJson({ error: error.message }, error.status);
    console.error("personal.knowledge.list.failed", error instanceof Error ? error.name : "unknown");
    return apiJson({ error: "知识空间暂时不可用" }, 500);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return apiJson({ error: "无效请求来源" }, 403);
  }
  const user = await identityFromRequest(request);
  if (!user) return apiJson({ error: "请先登录" }, 401);
  if (user.userId === 1) return apiJson({ error: "站点管理员请使用站点管理后台" }, 403);

  try {
    const body = await readJson(request, 800000) as Record<string, unknown>;
    if (typeof body.title !== "string" || !body.title.trim()) {
      return apiJson({ error: "请输入文章标题" }, 400);
    }
    const workspaceId = await ensurePersonalWorkspace(user.userId);
    const post = await scopedCreateDraft(user.userId, workspaceId, {
      title: body.title,
      content: typeof body.content_markdown === "string" ? body.content_markdown : "",
      excerpt: typeof body.excerpt === "string" ? body.excerpt : "",
      category: typeof body.category === "string" ? body.category : undefined,
      slug: typeof body.slug === "string" ? body.slug : undefined,
    }, "web:" + user.userId, "个人知识空间创建草稿");
    return apiJson({ post: { ...post, visibility: "personal", canEdit: true }, workspaceId }, 201);
  } catch (error) {
    if (error instanceof WorkspaceContentError) return apiJson({ error: error.message }, error.status);
    console.error("personal.knowledge.create.failed", error instanceof Error ? error.name : "unknown");
    return apiJson({ error: "草稿创建失败" }, 500);
  }
}

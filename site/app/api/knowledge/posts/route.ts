import { listArchivePosts } from "@/db/queries";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { scopedCreateDraft, scopedPostsPage, WorkspaceContentError } from "@/db/workspace-content";
import { identityFromRequest } from "@/server/auth/identity-session";
import { apiJson, readJson } from "@/server/workspace-http";

export async function GET(request: Request) {
  const user = await identityFromRequest(request);
  if (!user) return apiJson({ error: "请先登录" }, 401);
  if (user.userId === 1) return apiJson({ error: "站点管理员请使用站点管理后台" }, 403);

  try {
    const workspaceId = await ensurePersonalWorkspace(user.userId);
    const params = new URL(request.url).searchParams;
    const type = params.get("type") === "public" ? "public" : "mine";
    const query = (params.get("q") ?? "").trim().slice(0, 120);
    const limit = Math.min(50, Math.max(1, Number(params.get("limit") ?? 30) || 30));

    if (type === "mine") {
      const page = await scopedPostsPage(user.userId, workspaceId, {
        query,
        limit,
        cursor: params.get("cursor") ?? undefined,
        category: params.get("category") ?? "all",
        status: params.get("status") === "draft" || params.get("status") === "published" ? params.get("status") : "all",
      });
      const stats = await (await import("cloudflare:workers")).env.DB.prepare(
        "SELECT COUNT(*) AS total,SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,"+
        "SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS drafts,COALESCE(SUM(view_count),0) AS views "+
        "FROM posts WHERE workspace_id=? AND (author_id=? OR created_by=? OR (author_id IS NULL AND created_by IS NULL))"
      ).bind(workspaceId,user.userId,user.userId).first<{total:number;published:number;drafts:number;views:number}>();
      const categories = await (await import("cloudflare:workers")).env.DB.prepare(
        "SELECT id,name,slug,color FROM categories WHERE workspace_id=? ORDER BY id"
      ).bind(workspaceId).all();
      return apiJson({
        type, workspaceId,
        posts: page.rows.map((post) => ({ ...post, visibility: "personal", canEdit: true })),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        stats: {total:Number(stats?.total??0),published:Number(stats?.published??0),drafts:Number(stats?.drafts??0),views:Number(stats?.views??0)},
        categories: categories.results ?? [],
      });
    }

    const result = await listArchivePosts({
      query,
      limit,
      cursor: params.get("cursor") ?? undefined,
    });
    const origin = new URL(request.url).origin;
    return apiJson({
      type,
      workspaceId,
      posts: result.rows.map((post) => ({
        ...post,
        visibility: "public",
        canEdit: false,
        publicUrl: origin + "/posts/" + post.publicId + "/" + post.slug,
      })),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
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
    }, "web:" + user.userId, "个人知识空间创建草稿");
    return apiJson({ post: { ...post, visibility: "personal", canEdit: true }, workspaceId }, 201);
  } catch (error) {
    if (error instanceof WorkspaceContentError) return apiJson({ error: error.message }, error.status);
    console.error("personal.knowledge.create.failed", error instanceof Error ? error.name : "unknown");
    return apiJson({ error: "草稿创建失败" }, 500);
  }
}

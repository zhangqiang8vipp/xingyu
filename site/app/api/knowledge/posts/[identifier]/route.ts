import { getPostByPublicId } from "@/db/queries";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { scopedDeletePost, scopedPost, scopedUpdatePost, WorkspaceContentError } from "@/db/workspace-content";
import { identityFromRequest } from "@/server/auth/identity-session";
import { apiJson, readJson } from "@/server/workspace-http";

type Params = { params: Promise<{ identifier: string }> };

export async function GET(request: Request, { params }: Params) {
  const user = await identityFromRequest(request);
  if (!user) return apiJson({ error: "请先登录" }, 401);
  if (user.userId === 1) return apiJson({ error: "站点管理员请使用站点管理后台" }, 403);

  try {
    const { identifier } = await params;
    const workspaceId = await ensurePersonalWorkspace(user.userId);
    try {
      const post = await scopedPost(user.userId, workspaceId, identifier);
      return apiJson({ post: { ...post, visibility: "personal", canEdit: true }, workspaceId });
    } catch (error) {
      if (!(error instanceof WorkspaceContentError) || error.status !== 404) throw error;
    }

    // Public reading is intentionally limited to published posts in the public site workspace.
    const post = await getPostByPublicId(identifier);
    if (!post) return apiJson({ error: "文章不存在或无权访问" }, 404);
    const origin = new URL(request.url).origin;
    return apiJson({
      post: {
        ...post,
        status: "published",
        spaceId: null,
        visibility: "public",
        canEdit: false,
        publicUrl: origin + "/posts/" + post.publicId + "/" + post.slug,
      },
      workspaceId,
    });
  } catch (error) {
    if (error instanceof WorkspaceContentError) return apiJson({ error: error.message }, error.status);
    console.error("personal.knowledge.read.failed", error instanceof Error ? error.name : "unknown");
    return apiJson({ error: "文章读取失败" }, 500);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return apiJson({ error: "无效请求来源" }, 403);
  }
  const user = await identityFromRequest(request);
  if (!user) return apiJson({ error: "请先登录" }, 401);
  if (user.userId === 1) return apiJson({ error: "站点管理员请使用站点管理后台" }, 403);

  try {
    const { identifier } = await params;
    const body = await readJson(request, 800000) as Record<string, unknown>;
    if (!Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 1) {
      return apiJson({ error: "文章版本无效，请重新读取后保存" }, 400);
    }
    const workspaceId = await ensurePersonalWorkspace(user.userId);
    // Resolve only inside this user's personal workspace. Public or another user's posts never reach the writer.
    const post = await scopedUpdatePost(user.userId, workspaceId, identifier, {
      expectedVersion: Number(body.expected_version),
      title: typeof body.title === "string" ? body.title : undefined,
      content: typeof body.content_markdown === "string" ? body.content_markdown : undefined,
      excerpt: typeof body.excerpt === "string" ? body.excerpt : undefined,
      category: typeof body.category === "string" ? body.category : undefined,
      slug: typeof body.slug === "string" ? body.slug : undefined,
    }, "web:" + user.userId, "个人知识空间编辑文章");
    return apiJson({ post: { ...post, visibility: "personal", canEdit: true }, workspaceId });
  } catch (error) {
    if (error instanceof WorkspaceContentError) return apiJson({ error: error.message }, error.status);
    console.error("personal.knowledge.update.failed", error instanceof Error ? error.name : "unknown");
    return apiJson({ error: "文章保存失败" }, 500);
  }
}
export async function DELETE(request: Request, { params }: Params) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return apiJson({ error: "无效请求来源" }, 403);
  }
  const user = await identityFromRequest(request);
  if (!user) return apiJson({ error: "请先登录" }, 401);
  if (user.userId === 1) return apiJson({ error: "站点管理员请使用站点管理后台" }, 403);

  try {
    const { identifier } = await params;
    const body = await readJson(request, 16000) as Record<string, unknown>;
    if (!Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 1) {
      return apiJson({ error: "文章版本无效，请重新读取后删除" }, 400);
    }
    const workspaceId = await ensurePersonalWorkspace(user.userId);
    await scopedDeletePost(user.userId, workspaceId, identifier, Number(body.expected_version));
    return apiJson({ ok: true });
  } catch (error) {
    if (error instanceof WorkspaceContentError) return apiJson({ error: error.message }, error.status);
    console.error("personal.knowledge.delete.failed", error instanceof Error ? error.name : "unknown");
    return apiJson({ error: "文章删除失败" }, 500);
  }
}


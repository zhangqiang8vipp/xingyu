import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { attachmentUrl } from "@/db/attachments";
import { identityFromRequest } from "@/server/auth/identity-session";
import { apiJson } from "@/server/workspace-http";

type AttachmentRow = {
  publicId: string;
  workspaceId: number;
  originalName: string;
  contentType: string;
  size: number;
  createdAt: string;
  postPublicId: string;
  postTitle: string;
  postSlug: string;
};

export async function GET(request: Request) {
  const user = await identityFromRequest(request);
  if (!user) return apiJson({ error: "请先登录" }, 401);
  if (user.userId === 1) return apiJson({ error: "站点管理员请使用站点管理后台" }, 403);

  try {
    await ensureDatabase();
    const workspaceId = await ensurePersonalWorkspace(user.userId);
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") ?? "").trim().slice(0, 100).replace(/[%_]/g, "");
    const pattern = "%" + query + "%";
    const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? 50) || 50));

    const [personal, publicFiles] = await Promise.all([
      env.DB.prepare(
        "SELECT a.public_id AS publicId,a.workspace_id AS workspaceId,a.original_name AS originalName," +
        "a.content_type AS contentType,a.size,a.created_at AS createdAt," +
        "p.public_id AS postPublicId,p.title AS postTitle,p.slug AS postSlug " +
        "FROM attachments a JOIN posts p ON p.id=a.post_id " +
        "WHERE a.workspace_id=? AND p.workspace_id=? " +
        "AND (p.author_id=? OR p.created_by=? OR (p.author_id IS NULL AND p.created_by IS NULL)) " +
        "AND (a.original_name LIKE ? OR p.title LIKE ?) " +
        "ORDER BY a.created_at DESC,a.id DESC LIMIT ?",
      ).bind(workspaceId, workspaceId, user.userId, user.userId, pattern, pattern, limit).all<AttachmentRow>(),
      env.DB.prepare(
        "SELECT a.public_id AS publicId,a.workspace_id AS workspaceId,a.original_name AS originalName," +
        "a.content_type AS contentType,a.size,a.created_at AS createdAt," +
        "p.public_id AS postPublicId,p.title AS postTitle,p.slug AS postSlug " +
        "FROM attachments a JOIN posts p ON p.id=a.post_id " +
        "WHERE a.workspace_id=1 AND p.workspace_id=1 AND p.status='published' AND p.space_id IS NULL " +
        "AND (a.original_name LIKE ? OR p.title LIKE ?) " +
        "ORDER BY a.created_at DESC,a.id DESC LIMIT ?",
      ).bind(pattern, pattern, limit).all<AttachmentRow>(),
    ]);

    const files = [
      ...(personal.results ?? []).map((row) => ({
        id: row.publicId,
        filename: row.originalName,
        contentType: row.contentType,
        size: row.size,
        createdAt: row.createdAt,
        articlePublicId: row.postPublicId,
        articleTitle: row.postTitle,
        articleSlug: row.postSlug,
        visibility: "personal" as const,
        url: attachmentUrl(row),
      })),
      ...(publicFiles.results ?? []).map((row) => ({
        id: row.publicId,
        filename: row.originalName,
        contentType: row.contentType,
        size: row.size,
        createdAt: row.createdAt,
        articlePublicId: row.postPublicId,
        articleTitle: row.postTitle,
        articleSlug: row.postSlug,
        visibility: "public" as const,
        url: attachmentUrl(row),
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);

    return apiJson({ files });
  } catch (error) {
    console.error("personal.knowledge.files.failed", error instanceof Error ? error.name : "unknown");
    return apiJson({ error: "文件列表暂时不可用" }, 500);
  }
}

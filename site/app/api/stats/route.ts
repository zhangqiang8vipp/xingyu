import { env } from "cloudflare:workers";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { getAdminStats } from "@/db/queries";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { identityFromRequest } from "@/server/auth/identity-session";

export async function GET(request: Request) {
  if (await isAdminRequest(request)) {
    return Response.json({ stats: await getAdminStats() }, { headers: { "Cache-Control": "no-store" } });
  }
  const user = await identityFromRequest(request);
  if (!user) return unauthorized();

  const workspaceId = await ensurePersonalWorkspace(user.userId);
  const [personal, publicPosts] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(view_count),0) AS views " +
      "FROM posts WHERE workspace_id=? AND space_id IS NOT NULL " +
      "AND (author_id=? OR created_by=? OR (author_id IS NULL AND created_by IS NULL))",
    ).bind(workspaceId, user.userId, user.userId).first<{total:number;views:number}>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(view_count),0) AS views " +
      "FROM posts WHERE workspace_id=1 AND status='published' AND space_id IS NULL",
    ).first<{total:number;views:number}>(),
  ]);
  const mine = Number(personal?.total ?? 0);
  const published = Number(publicPosts?.total ?? 0);
  return Response.json({
    stats: {
      total: mine + published,
      published,
      drafts: mine,
      views: Number(publicPosts?.views ?? 0),
      privateArticles: mine,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type WorkspaceGrant = { id: number; name: string; kind: string; role: WorkspaceRole };
export class WorkspaceAccessError extends Error {
  constructor(message = "工作区不存在或无权访问", readonly status: 403 | 404 = 404) { super(message); }
}

/** Safe to retry when verification/network delivery is interrupted. */
export async function ensurePersonalWorkspace(userId: number) {
  await ensureDatabase();
  if (!Number.isSafeInteger(userId) || userId < 1) throw new WorkspaceAccessError();
  const slug = "personal-u" + userId;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO workspaces(kind,owner_user_id,slug,name,status) SELECT 'personal',id,? ,display_name || '的工作区','active' FROM users WHERE id=? AND status='active'",
  ).bind(slug,userId).run();
  const workspace = await env.DB.prepare(
    "SELECT id FROM workspaces WHERE slug=? AND kind='personal' AND owner_user_id=? AND status='active'",
  ).bind(slug,userId).first<{ id: number }>();
  if (!workspace) throw new WorkspaceAccessError("个人工作区初始化失败");
  await env.DB.prepare("INSERT OR IGNORE INTO workspace_memberships(workspace_id,user_id,role,status) VALUES(?,?,'owner','active')").bind(workspace.id,userId).run();
  if (userId !== 1) {
    await env.DB.prepare("INSERT OR IGNORE INTO categories(workspace_id,name,slug,color) VALUES(?,'私人笔记',?,'#507f78')")
      .bind(workspace.id,"user-"+userId+"-private").run();
    await env.DB.prepare("INSERT OR IGNORE INTO spaces(workspace_id,name,slug,parent_id) VALUES(?,'私人知识库',?,NULL)")
      .bind(workspace.id,"private-u"+userId).run();
  }
  return workspace.id;
}

export async function listUserWorkspaces(userId: number): Promise<WorkspaceGrant[]> {
  await ensureDatabase();
  const result = await env.DB.prepare(
    "SELECT w.id,w.name,w.kind,m.role FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND u.status='active' AND w.status='active' AND m.status='active' AND (w.kind<>'personal' OR m.user_id=w.owner_user_id) ORDER BY w.id",
  ).bind(userId).all<WorkspaceGrant>();
  return result.results ?? [];
}

export async function workspaceGrant(userId: number, workspaceId: number, action: "read" | "write" | "manage" = "read"): Promise<WorkspaceGrant> {
  if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(workspaceId) || workspaceId < 1) throw new WorkspaceAccessError();
  await ensureDatabase();
  const item = await env.DB.prepare(
    "SELECT w.id,w.name,w.kind,m.role FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id JOIN users u ON u.id=m.user_id WHERE w.id=? AND m.user_id=? AND u.status='active' AND w.status='active' AND m.status='active' AND (w.kind<>'personal' OR m.user_id=w.owner_user_id)",
  ).bind(workspaceId,userId).first<WorkspaceGrant>();
  if (!item) throw new WorkspaceAccessError();
  if (action === "write" && item.role === "viewer") throw new WorkspaceAccessError("没有工作区写入权限",403);
  if (action === "manage" && item.role !== "owner" && item.role !== "admin") throw new WorkspaceAccessError("没有工作区管理权限",403);
  return item;
}

export async function resolveWorkspace(userId: number, requested?: number | null, action: "read" | "write" | "manage" = "read") {
  if (requested !== undefined && requested !== null) {
    await workspaceGrant(userId, requested, action);
    return requested;
  }
  const list = await listUserWorkspaces(userId);
  const personal = list.find(item => item.kind === "personal");
  if (!personal) throw new WorkspaceAccessError("个人工作区不存在");
  await workspaceGrant(userId,personal.id,action);
  return personal.id;
}

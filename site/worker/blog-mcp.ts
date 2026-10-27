import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { xingyuBlockMcpInstructions } from "@/features/document-blocks/catalog";
import { ensureDatabase } from "@/db/bootstrap";
import { authenticateMcp, rememberTokenUse, type McpAuth } from "./mcp-auth";
import { registerDraftTools } from "./mcp/draft-tools";
import { registerPublishTools } from "./mcp/publish-tools";
import { registerReadTools } from "./mcp/read-tools";
import { registerSpaceTools } from "./mcp/space-tools";
import { registerPersonalKnowledgeTools } from "./mcp/personal-knowledge-tools";
import { registerOrganizationTools } from "./mcp/organization-tools";
import { registerPublicKnowledgeTools } from "./mcp/public-knowledge-tools";
import { registerSpaceCollaborationTools } from "./mcp/space-collaboration-tools";

const MCP_PATH = "/mcp";

function createBlogMcpServer(origin: string, clientLabel: string, auth: McpAuth) {
  const server = new McpServer(
    { name: "xingyu-blog-writer", version: "2.0.0" },
    {
      instructions: [
        ...(auth.userId && auth.userId !== 1 ? [
          "这是星屿个人知识空间 MCP。默认先用 list_my_posts 查看本人文章；创建草稿用 create_my_draft，修改本人文章用 update_my_post。",
          "list_my_posts / get_my_post / update_my_post 只操作自己的私人文章；获邀共享文档必须使用 list_collaboration_spaces、get_collaboration_document 和 propose_document_change。普通账号无权读取其他未获邀的私人文章、组织文章或空间。公开文章使用 search_public_posts 和 get_public_post。",
          "个人附件使用 list_my_attachments、upload_my_attachment、download_my_attachment；公开附件使用 list_public_attachments 和 download_public_attachment。",
          "普通账号不提供站点发布、撤回、首页管理或页面修改工具。xingyu.publish scope 不会赋予普通账号站点发布权限。",
          "组织架构 MCP 只列出当前账号所属组织，通过 Owner/Admin/Member 角色控制组织及成员。组织成员身份不会自动授予知识空间权限，协作空间采用独立邮箱邀请；受邀用户接受后由 OAuth/PAT 按账号实时权限访问。",
        ] : [
          "这是星屿博客的开发/兼容写作 MCP。默认先用 create_draft 创建草稿；只有用户明确要求上线时才调用 publish_post。",
          "查找文章先 search_posts（默认只要目录），确认 public_id 后再 get_post。get_post 默认只给大纲；修改或引用正文前必须 view=content。不要把候选文章全部打开成全文。",
          "你有完整的附件能力：用户给了图片或文件时，调用 upload_attachment 上传，再把返回的 markdown 插入正文。用 list_attachments 查看文章附件，用 download_attachment 读取已有附件。",
          "不要假设分类存在，必要时先调用 list_categories。update_post 不改变发布状态；发布和撤回分别使用独立工具。",
          "知识空间是私有内容边界。创建私有知识必须显式传入 space；更新前先读取完整正文和 version，保留原内容与私有空间。空间文章不会进入公开首页、归档或公开 URL；使用 list_spaces 确认路径，search_posts 可限定空间及其后代。",
          "独立页面先用 get_page 读取；update_page 会立即改变公开页面，必须先展示变更字段和摘要并获得用户确认。",
        ]),
        ...(auth.userId ? [
          "空间共创 MCP 已启用：先用 list_collaboration_spaces 找到本人拥有或已接受邀请的空间（返回 space_id）；再用 list_collaboration_children / list_collaboration_documents 浏览相应的子空间和文档。不能用 list_my_posts 或旧版 search_posts 代替协作文档列表。",
          "多人/多 AI 共同编辑文档时：get_collaboration_document 读取 public_id、content 和 version，每个 Agent 基于这个 version 编辑，再用 propose_document_change 提交 base_version、完整 content_markdown 和 change_summary。服务端自动合并不冲突修改，重叠修改生成待人工审核的冲突提案，绝不能调用覆盖型旧工具绕开此流程。",
          "管理协作者时先用 get_collaboration_space 确认空间和权限，必要时调用 list_space_collaborators；invite_space_member 仅在用户明确同意邮箱、space_id 与角色后发送邀请。每个 AI 客户端都必须使用被邀请的本人账号授权的 OAuth / PAT，并具有 xingyu.read、xingyu.draft 权限；组织成员身份本身不等于知识空间授权。",
          "若调用端只显示旧工具 create_draft / get_post / update_post，而没有 list_collaboration_spaces 和 propose_document_change，说明 ChatGPT 自定义 MCP 应用仍使用已发布时冻结的旧工具快照：请让工作区应用管理员到 Apps / Plugins 的操作控制中 Refresh 工具并启用、发布新增操作，然后在新会话中重新发现；仅重连账号或重复部署 Worker 不一定更新已经发布的工具列表。",
        ] : []),
        xingyuBlockMcpInstructions(),
        "写作时可自主采用 xingyu-block JSON 围栏代码块制作富展示；普通叙述继续用 Markdown。组件必须使用有来源的事实，不要编造成绩、数值、任务状态、事件日期或来源，缺少依据先询问用户。",
        "调用任何写入工具前，先向用户说明目标文章、当前状态与变更摘要；普通账号的 MCP 不提供站点发布权限。",
      ].join(" "),
    },
  );
  const context = { server, origin, clientLabel, auth };
  if (auth.userId && auth.userId !== 1) {
    registerPersonalKnowledgeTools(context);
    registerOrganizationTools(context);
    registerPublicKnowledgeTools(context);
  } else {
    // Development-only single-owner compatibility; production never accepts these identities.
    registerDraftTools(context);
    registerReadTools(context);
    registerPublishTools(context);
    registerSpaceTools(context);
    if (auth.userId === 1) {
      registerOrganizationTools(context);
      registerPublicKnowledgeTools(context);
    }
  }
  if (auth.userId) registerSpaceCollaborationTools(context);
  return server;
}

function securedResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleBlogMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) {
  await ensureDatabase();
  const auth = await authenticateMcp(request);
  if (auth instanceof Response) return auth;
  await rememberTokenUse(auth, ctx);

  const origin = new URL(request.url).origin;
  const clientLabel = auth.authType === "legacy"
    ? (request.headers.get("User-Agent") || "remote-mcp").slice(0, 160)
    : `${auth.authType}:${auth.clientId}:${auth.subject}:credential:${auth.tokenId ?? auth.patId ?? "none"}`;
  const server = createBlogMcpServer(origin, clientLabel, auth);
  const response = await createMcpHandler(server, {
    route: MCP_PATH,
    enableJsonResponse: true,
  })(request, env, ctx);
  return securedResponse(response);
}

export function isBlogMcpPath(pathname: string) {
  return pathname === MCP_PATH;
}

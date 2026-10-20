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

const MCP_PATH = "/mcp";

function createBlogMcpServer(origin: string, clientLabel: string, auth: McpAuth) {
  const server = new McpServer(
    { name: "xingyu-blog-writer", version: "2.0.0" },
    {
      instructions: [
        ...(auth.userId && auth.userId !== 1 ? [
          "这是星屿个人知识空间 MCP。默认先用 list_my_posts 查看本人文章；创建草稿用 create_my_draft，修改本人文章用 update_my_post。",
          "只能读取和编辑当前账号自己的私人文章。公开文章使用 search_public_posts 和 get_public_post；不能读取其他用户的私人文章或团队文章。",
          "个人附件使用 list_my_attachments、upload_my_attachment、download_my_attachment；公开附件使用 list_public_attachments 和 download_public_attachment。",
          "普通账号不提供站点发布、撤回、首页管理或页面修改工具。xingyu.publish scope 不会赋予普通账号站点发布权限。",
          "组织架构 MCP 只列出当前账号所属组织，并通过组织 Owner/Admin/Member 角色控制组织、部门、团队、成员与邀请。组织成员身份不会授予文章或文件权限。",
        ] : [
          "这是星屿博客的开发/兼容写作 MCP。默认先用 create_draft 创建草稿；只有用户明确要求上线时才调用 publish_post。",
          "查找文章先 search_posts（默认只要目录），确认 public_id 后再 get_post。get_post 默认只给大纲；修改或引用正文前必须 view=content。不要把候选文章全部打开成全文。",
          "你有完整的附件能力：用户给了图片或文件时，调用 upload_attachment 上传，再把返回的 markdown 插入正文。用 list_attachments 查看文章附件，用 download_attachment 读取已有附件。",
          "不要假设分类存在，必要时先调用 list_categories。update_post 不改变发布状态；发布和撤回分别使用独立工具。",
          "知识空间是私有内容边界。创建私有知识必须显式传入 space；更新前先读取完整正文和 version，保留原内容与私有空间。空间文章不会进入公开首页、归档或公开 URL；使用 list_spaces 确认路径，search_posts 可限定空间及其后代。",
          "独立页面先用 get_page 读取；update_page 会立即改变公开页面，必须先展示变更字段和摘要并获得用户确认。",
        ]),
        xingyuBlockMcpInstructions(),
        "写作时可自主采用 xingyu-block JSON 围栏代码块制作富展示；普通叙述继续用 Markdown。组件必须使用有来源的事实，不要编造数据或来源。",
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
    : `${auth.authType}:${auth.clientId}:${auth.subject}`;
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

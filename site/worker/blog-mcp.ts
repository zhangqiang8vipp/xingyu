import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureDatabase } from "@/db/bootstrap";
import { authenticateMcp, rememberTokenUse, type McpAuth } from "./mcp-auth";
import { registerDraftTools } from "./mcp/draft-tools";
import { registerPublishTools } from "./mcp/publish-tools";
import { registerReadTools } from "./mcp/read-tools";
import { registerSpaceTools } from "./mcp/space-tools";

const MCP_PATH = "/mcp";

function createBlogMcpServer(origin: string, clientLabel: string, auth: McpAuth) {
  const server = new McpServer(
    { name: "xingyu-blog-writer", version: "1.0.0" },
    {
      instructions: [
        "这是星屿博客的线上写作 MCP。默认先用 create_draft 创建草稿；只有用户明确要求上线时才调用 publish_post。",
        "查找文章先 search_posts（默认只要目录），确认 public_id 后再 get_post。get_post 默认只给大纲；修改或引用正文前必须 view=content。不要把候选文章全部打开成全文。",
        "你有完整的附件能力：用户给了图片或文件时，调用 upload_attachment 上传，再把返回的 markdown 插入正文。用 list_attachments 查看文章附件，用 download_attachment 读取已有附件。不要说星屿不能上传附件。",
        "不要假设分类存在，必要时先调用 list_categories。update_post 不改变发布状态；发布和撤回分别使用独立工具。",
        "知识空间是私有内容边界。空间文章不会进入公开首页、归档或公开 URL；使用 list_spaces 确认路径，search_posts 可限定空间及其后代。",
        "写作时如有明确的测验判题结果或多项指标，可自主采用 Markdown fenced xingyu-block JSON 做富展示：version 必须为 1；quiz_result 使用 items[{title,status(correct/partial/incorrect),explanation?}]，metric_grid 使用 items[{label,value,note?}]；status_list 使用 items[{title,status(done/active/pending/blocked),detail?}]；timeline 使用 items[{label,title,detail?}]。可选 title。只使用来源明确的事实，不凭空生成成绩或数值；普通叙述继续用标准 Markdown。",
        "独立页面先用 get_page 读取；update_page 会立即改变公开页面，必须先展示变更字段和摘要并获得用户确认。",
        "调用任何写入工具前，先向用户说明文章标题、当前状态、将修改的字段与 change_summary；不要替用户默许发布或撤回。",
      ].join(" "),
    },
  );
  const context = { server, origin, clientLabel, auth };
  // Writing and attachments first so short client tool lists still include them.
  registerDraftTools(context);
  registerReadTools(context);
  registerPublishTools(context);
  registerSpaceTools(context);
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
    : `oauth:${auth.clientId}`;
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

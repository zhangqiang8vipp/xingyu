-- Apply only after the versioned schema migrations. This seed is idempotent and
-- does not mark schema_version or app_environment; validate the target first.
INSERT OR IGNORE INTO categories (id, name, slug, color) VALUES (1, '随笔', 'notes', '#8E8E93');
--> statement-breakpoint
INSERT OR IGNORE INTO site_settings (id) VALUES (1);
--> statement-breakpoint
INSERT OR IGNORE INTO content_pages (slug, eyebrow, title, excerpt, content)
VALUES ('about', 'ABOUT · PERSONAL NOTES', '关于星屿，也关于为什么写作。', '这里不是一份履历，也不是一个需要不断更新的个人橱窗。它更像一座安静的数字岛屿，用来保存那些值得慢一点想、认真一点写的东西。', '## 写作，是把模糊的感受变成可以带走的东西。

很多想法在脑海里显得理所当然，直到尝试把它写下来，才会发现其中仍有空白。写作迫使我放慢速度，重新检查自己的判断。

我不追求每天制造内容。更希望每一篇文章，都来自一次真实的观察、一次具体的实践，或者一个值得继续追问的问题。

> 不急着成为声音最大的人。先成为一个观察得足够仔细的人。

保持好奇，持续创造，也为生活保留空白。');
--> statement-breakpoint
INSERT OR IGNORE INTO content_pages (slug, eyebrow, title, excerpt, content)
VALUES ('connect', 'CONNECT · AI WRITING', '让 Codex，直接写进星屿。', '通过一条受控的 MCP 写作通道，AI 可以读取、起草和修改内容；发布、撤回与线上页面更新仍由你确认。', '## 在 Codex 中连接星屿

星屿提供标准的 Streamable HTTP MCP 入口。它不是另一个编辑器，而是让 Codex 等 AI Agent 直接使用博客现有的文章、分类与独立页面数据。

```text
https://zhangwansen.click/mcp
```

先把写作令牌保存在本机环境变量中。令牌只属于你的设备，不要写进仓库或分享给其他人。

```powershell
[Environment]::SetEnvironmentVariable(
  "XINGYU_BLOG_MCP_TOKEN",
  "你的写作令牌",
  "User"
)
```

然后在 Codex 的 `~/.codex/config.toml` 中加入：

```toml
[mcp_servers.xingyu_blog]
url = "https://zhangwansen.click/mcp"
bearer_token_env_var = "XINGYU_BLOG_MCP_TOKEN"
default_tools_approval_mode = "writes"

[mcp_servers.xingyu_blog.tools.list_categories]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.search_posts]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.get_post]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.get_page]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.list_attachments]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.download_attachment]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.upload_attachment]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.create_draft]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.update_post]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.update_page]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.publish_post]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.unpublish_post]
approval_mode = "prompt"
```

重启 Codex 后，先让它“列出星屿的文章分类”或“搜索标题包含某个关键词的文章”。只读操作可以直接完成；真正写入时，Codex 会展示将要修改的内容并等待确认。

## 推荐的写作流程

1. 先搜索，避免创建重复文章；
2. 新文章默认创建为草稿；
3. 修改前读取最新版本，使用稳定公开 ID 定位文章；
4. 确认标题、摘要、分类和正文预览；
5. 只有你明确要求上线时，才调用发布工具。

更新已发布文章、修改独立页面、发布和撤回都属于重要操作。每次写入都会返回变更字段、摘要、时间和记录编号；重复提交相同内容不会再次写入。

> AI 负责把内容送到正确的位置，是否公开仍然由你决定。

## 你可以直接这样说

- “搜索星屿里关于 Windows 环境的文章。”
- “把这份 Markdown 写成草稿，分类放到开发手记。”
- “读取这篇文章，重写开头，但先不要发布。”
- “把这张图上传到刚才那篇草稿，并插入正文。”
- “列出这篇文章已经上传的附件。”
- “更新接入页面的 Codex 配置，并告诉我改了哪些字段。”
- “确认无误，发布刚才的草稿。”

星屿会继续扩展更多 Agent 的接入说明，但它们共享同一套原则：令牌留在本机、读取默认开放、写入需要确认、公开动作单独授权。');
--> statement-breakpoint
INSERT OR IGNORE INTO oauth_clients
  (client_id, client_name, client_type, client_secret_hash, redirect_uris, allowed_scopes, token_endpoint_auth_method, enabled)
VALUES ('grok-xingyu', 'Grok · XINGYU', 'public', NULL, '[]',
  'xingyu.read xingyu.draft xingyu.publish offline_access', 'none', 1);
--> statement-breakpoint
-- Identity base: a single site owner with its local identity. The final UPDATE
-- also repairs attribution for rows imported after the migration chain already
-- ran its own backfill, so the relation audit stays meaningful after cutovers.
INSERT OR IGNORE INTO users (id, display_name, status) VALUES (1, '星屿管理员', 'active');
--> statement-breakpoint
INSERT OR IGNORE INTO user_identities (user_id, provider, subject, name)
  VALUES (1, 'local', 'owner', '星屿管理员');
--> statement-breakpoint
INSERT OR IGNORE INTO site_memberships (user_id, role) VALUES (1, 'owner');
--> statement-breakpoint
UPDATE posts SET author_id = 1, created_by = 1, updated_by = 1 WHERE author_id IS NULL;

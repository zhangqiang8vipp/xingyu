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
VALUES ('connect', 'XINGYU / MCP CONNECT', '把星屿，连接到你的 AI。', '无论你的 AI 客户端支持 OAuth，还是需要手动填写 Token，都可以连接属于自己的星屿工作区。权限由你决定，连接由你管理。', '## 如何开始

星屿通过标准 Streamable HTTP MCP 接入 AI 客户端，服务地址是 https://zhangwansen.click/mcp 。

1. 如果客户端支持 OAuth，在客户端添加 MCP 地址，通过星屿账号登录并确认授权。
2. 如果客户端需要手动 Bearer Token，登录星屿后打开「AI 连接」，为该客户端创建个人 Access Token。
3. 在客户端配置中填写服务器地址及相应认证信息，先尝试读取有权限的工作区或文章。

## 保护你的连接

个人 Token 可以分别命名、独立设置读取/写作/发布权限，并设置有限期或永久有效。永久不代表不可撤销，撤销及账号停用都会令密钥失效。

不要把 Token 放进公共代码仓库、聊天消息、公开日志或截图。使用单独的客户端凭据可以在设备遗失时只撤销该凭据，不影响其他连接。

## 写作与发布

推荐先搜索已有内容、创建草稿、确认变更后再写入。发布与撤回是独立敏感权限，不会因拥有普通读取或草稿权限而自动获得。

需要管理令牌、已授权 OAuth 客户端或撤销连接，请打开登录后的「AI 连接」。');
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

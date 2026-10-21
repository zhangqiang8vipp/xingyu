# XINGYU 知识库问答 v1（OpenRouter free）上线手册

## 功能与安全边界

- /ask 可公开访问，但访客检索只允许 workspace_id=1、space_id IS NULL 且 status='published' 的文章。
- 登录用户（包括原有管理员密码会话）可选择个人知识或公开 + 私人知识；私有文章在 SQL 层执行用户归属和权限检查。
- 私人知识片段不会在仅检索模式中发送第三方；选择模型生成时要求用户明确同意。
- 只将每次相关的最多 5 篇文章片段送 OpenRouter。问题、片段不会写入 XINGYU 聊天记录。
- 模型固定 openrouter/free，可能使用不同免费提供方；其数据政策、限流与可用性以 OpenRouter 最新说明为准。
- API 返回的引用 URL 来自服务器已授权的文章查询结果，不信任模型生成的 URL。泛化问题（例如“这个网站主要分享哪些技术经验？”）从真实文章中按分类提取代表性来源，而不是只匹配“技术/经验”字样。
- 免费模型预算：匿名访客 3 次/日、登录用户 8 次/日；仅搜索模式另计匿名 30 次/日、登录用户 100 次/日；全站最多 40 次模型请求/日。
- 配额只存每日 HMAC 摘要与计数，不存 IP 明文、问题、密钥；已有 Cron 每日清理 30 天前的配额记录。

## 上线前必须准备（禁止在 GitHub 中保存密钥）

1. **撤销用户先前粘贴到聊天中的 OpenRouter Key**，在 OpenRouter 控制台创建新的受限 Key。不要把原密钥或新密钥放进代码、GitHub Issues、PR、Actions 日志或仓库变量。
2. 在 Cloudflare > Workers & Pages > xingyu-blog > Settings > Variables and Secrets，增加 Secret，名称 OPENROUTER_API_KEY，值为新密钥。不能把它放入 wrangler.production.jsonc 的 vars。经过安全认证的本机 Wrangler 也可以操作；但 wrangler secret put 会立即发布一个 Worker 版本。
3. 本版需要 D1 schema 26。先做好包含最新数据的可核对备份，在隔离 D1 演练迁移、索引校验、恢复和回退。生产升级必须遵照受控维护流程，避免 schema 25 与 26 的 Worker 混用。
4. 对目标 D1 执行迁移 0024_ai_question_quotas.sql 后，在受控切换窗口更新 app_meta.schema_version=26 并发布对应 Worker；切换前后都要验证运行时 instance_id 和 D1/R2 绑定。不能仅改 schema_version 冒充迁移成功。
5. 完整 CI 与浏览器视觉验收均通过后，才允许进入受控上线。新功能不能绕开生产发布门禁。

## 验收矩阵

- 匿名 /ask 问公开文章：只见已发布站点文章；不存在的内容不生成伪引用。
- 匿名请求 scope=mine|all：401；跨域 POST：403；错误 Content-Type/过大内容：拒绝。
- 用户 A 私人问答：只见 A 可访问文章，B 看不到 A 的内容，即使知道 ID。
- 用户未同意：不得向 OpenRouter 发私人片段；仅检索不使用模型。
- 模型调用失败、超时或 429：页面显示真实检索结果并提示降级。
- 第四次同一匿名 AI 问答（单日额度 3）：429；第 31 次匿名仅检索：429；全站 AI 调用上限 40。
- API Key 缺失：生成回答返回 503，不能回退到不安全的客户端直连。
- 生产检查：来源链接跳转到正确文章；问答页在移动端和深色主题无横向溢出。
- 指标：从 Cloudflare 的响应和错误率观察，不记录问题原文或私人检索片段。

## 后续版本，不属于 v1

- 流式回答、上下文多轮对话、向量召回与中文短词索引性能。
- 更细的自定义检索范围、用户可配置服务商、付费配额。
- AI 自动保存用户对话或长期记忆功能不在产品方向内。

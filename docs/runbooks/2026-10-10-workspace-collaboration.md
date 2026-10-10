# 星屿共享工作区：运维与验收说明

> 本功能 PR #16 **依赖 PR #15** 的统一身份与单实例多工作区系统。前者必须先通过预发和上线验收；此协作 PR 不可跳过身份系统单独部署。

## 交付边界

- 复用 `users`、`user_identities`、`workspaces`、`workspace_memberships` 和既有 MCP OAuth，无第二套认证体系。
- `kind=personal` 的个人工作区保持私有；即使误写入成员数据，也有数据库触发器和读取层限制，不能被其他账号访问。
- 新建 `kind=shared` 的共享工作区时自动建立 Owner 成员、私有分类与根空间；工作区内容仍属于单实例 D1/R2，而不是单独部署。
- 角色为 Owner / Admin / Editor / Viewer。Owner 不可降级/移除，Admin 可管理 Editor、Viewer；不能管理另一个 Admin 或提升 Admin。Editor 可写，Viewer 只读。
- 成员降权或移除后，网站 API 和 MCP 都会在下一次数据库权限检查时立刻生效。
- 本版**不包含**空间级 ACL、组织架构、团队分组、公开共享链接和微信登录 Provider。

## 邮箱邀请流程

1. Owner 或 Admin 使用已配置的 Resend 邮件通道发送邀请。Admin 不可邀请其他 Admin。
2. 令牌为随机 32 字节，只存 SHA-256 哈希；默认七天过期；相同工作区邮箱同一时刻只有一条未接受邀请。
3. 收件人通过 ` /invite?token=... ` 进入，必须登录**与受邀邮箱一致的已激活邮箱账号**才允许接受。未注册用户先按原有邮箱注册与验证流程完成账号激活。
4. 服务端事务消费一次性令牌并创建成员关系。重放、非受邀账号、邀请人已失去管理权限、工作区关闭等情况均拒绝。
5. 邮件发送失败会撤销新邀请，邀请管理者可撤销未使用的邀请；受邀列表不得包含原始令牌。
6. 有工作区级别的发邀请限额，正式开放时仍需配置 Cloudflare WAF、邮件配额告警与反滥用监控。

## 数据库升级

- 新增迁移 `site/drizzle/0020_workspace_collaboration.sql`，Schema 21 → **22**。
- 新表 `workspace_invitations`；唯一 token 索引、唯一 pending(workspace_id,email) 部分索引、列表查询索引，以及成员 Owner 不可删除、个人空间不可分享等三个触发器。
- 升级过程中不重建 `posts`、`attachments`、`spaces`、`users` 或旧工作区，不复制 R2 对象。
- 必须在**独立预发 D1**先做 21→22 迁移，确认实例标记、备份、数据完整性，再由运维在正式窗口按运行手册升级目标 D1、校验后更新 `app_meta.schema_version=22`。
- 如果正式环境还没有 PR #15 的 Schema 21，不允许直接将 Schema 22 上线；先完成 PR #15 上线验收。
- 回滚需配套匹配数据库备份与 Worker 版本，切忌仅重新部署旧 Worker 而保留新 Schema。

## 预发验收

- [ ] 本分支精确 SHA 运行完整 `cd site && npm ci && npm run ci`。
- [ ] 独立 Worker/D1/R2 升级 Schema 21→22，并通过迁移完整性门禁。
- [ ] A 创建共享工作区，B 受邀并使用真实验证邮箱接受；失效链接、错误邮箱、重复接受不能通过。
- [ ] A/B 在同一共享工作区协作文章、附件；个人工作区内容仍然互不可见。
- [ ] Viewer 写入失败，Editor 可写，Admin 不得修改 Owner；角色改变和成员移除后 MCP 权限立即变化。
- [ ] 旧博客的公开文章与图片、既有 MCP OAuth、管理员登录仍可正常使用。
- [ ] 检查邮件发信限额、邀请撤销、并发请求、Origin/CSRF、异常日志和回滚演练。
- [ ] 正式生产合并、升级、开放分享功能前由用户批准。

**当前 PR 为 Draft；不要自行合并到 main 或修改生产。**

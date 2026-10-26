# XINGYU 多人 / 多 AI 协作：生产发布操作手册（2026-10-26）

状态：**操作入口就绪不等于生产已上线**。只有手动工作流成功，并完成真实邀请/授权验收后才确认发布。

## 工作流入口（不用本地 GitHub CLI）

GitHub Actions：[One-time collaboration production release (schema 26)](https://github.com/zhangqiang8vipp/xingyu/actions/workflows/release-collaboration-2026-10-26.yml)

1. 在发布窗口确认主分支 CI 绿灯，并确认前一次生产数据库版本为 25。
2. 核查 `CLOUDFLARE` GitHub Environment 已启用 Required reviewers，且只允许 `main`。环境变量 `PRODUCTION_DEPLOY_ENABLED=true`、Cloudflare 凭据须由授权人员事先配置。生产 Worker 加密 Secrets 要包含 `OPENROUTER_API_KEY`、`RESEND_API_KEY`、`ADMIN_SESSION_SECRET`。
3. 点击 `Run workflow`，选择 `main`，填写 `confirm=RELEASE-COLLAB-26` 与 `migrate=D1-SCHEMA-26`。两项必须准确；输入相当于批准变更生产数据库和 Worker。
4. `verify` 先执行完整 `npm run ci`，任何失败均停止。
5. `release` 等待 `CLOUDFLARE` Environment 审批后，检查已绑定的生产 D1 / R2 / Worker ID、当前 D1 metadata、已执行迁移清单和业务 Secret 名称。只允许旧 schema 25 且恰好待执行 0024，或已完成 26 的安全重试。
6. 迁移前获取 **Cloudflare D1 Time Travel 恢复 bookmark**；随后执行迁移 0024、重新读取 D1 表和触发器、确认清单完整，再把 `app_meta.schema_version` 从 `25` 更新为 `26`。
7. 只有 schema 26 / instance identity 再次验证通过才会运行 `npm run deploy:production`，随后匿名探测网站首页、问答入口、OAuth 和 MCP/空间协作访问隔离。

原有 `deploy-production.yml` 不变：仍是手动发布，只读检查 D1，**绝不自动做数据库迁移**。新专项工作流是经过明确二次确认的单次迁移发布入口，按 `xingyu-production-deploy` 并发锁与普通生产发布互斥。

## 风险与中断处理

- 0024 是增加空间邀请、版本快照、权限表和触发器的 D1 迁移，不可假定零耗时。高峰期不要执行。迁移和 app_meta 标记晋级至 Worker 发布之间，旧 Worker（预期 schema 25）可能拒绝请求，必须预留维护窗口。
- Cloudflare D1 的 Time Travel 恢复是**破坏性就地覆盖**，会丢失 bookmark 之后的数据。工具不会自动执行 `time-travel restore`。先核对当前是否发生用户写入，再决定修复前进、回退应用版本还是数据恢复。
- 如果迁移成功但 Worker 部署失败，不能简单发布旧版本：旧 Worker 可能不接受 schema 26。需要有权限的人检查最新 D1 marker、Worker 已发布版本和业务流量，再选择修复前进或明确兼容的回退。
- 如果运行到一半停止，必须先只读检查 `app_meta`、`d1_migrations` 以及表、触发器；工作流的失败关闭保护会拒绝状态不一致的盲目重跑。
- 本流程只复用现有 `CLOUDFLARE` 环境授权，没有在仓库写入任何 Secret、Token、私有 D1 内容或导出的完整数据库。

## 成功后人工验证（需要至少两个真实账号）

- 以所有者打开 `/collaboration`，创建或选择私有空间，对可控邮箱发起 `editor` 邀请，确认 Resend 邮件真正送达、链接在 7 天内有效、受邀邮箱必须一致。
- 受邀者接受后，只能看到获邀空间和可继承的子空间；不应获得整个工作区、其他空间、非公开附件或个人知识文章的读取权限。
- 两个独立授权的 MCP AI 客户端读取同一文档版本，分别编辑两个章节时自动合并；修改同一段时产生冲突提案；管理员核对并解决后产生新修订。
- 移除协作者后，旧 OAuth/PAT 对该空间的读写要立即被拒绝；其他私有资源仍不泄露。
- 检查版本历史、作者 / AI 客户端标识、空子空间删除保护和基础登录/文章阅读。

## 参考

- [Cloudflare D1 Wrangler Commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [项目现有生产发布流程](2026-10-19-github-actions-production-deploy.md)

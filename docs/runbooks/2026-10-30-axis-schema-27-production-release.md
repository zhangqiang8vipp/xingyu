# AXIS 整体后台体验（PR #82）— schema 27 生产发布

本流程仅在已完成代码审查、完整 CI、用户授权上线后执行。不会因合并 main 而自动修改生产 D1 或发布 Worker。

工作流：.github/workflows/release-axis-schema-27.yml

## 发布步骤

1. 确认 PR #82 最新 HEAD 全量 CI、后台/空间/AI/Connect 浏览器工作流通过；合并到 main，等待同一提交的 main push 全量 CI 20/20 通过。
2. 打开 GitHub → Actions → One-time AXIS production release (schema 27) → Run workflow，选择 main。
3. 输入 confirm=RELEASE-AXIS-27、migrate=D1-SCHEMA-27。由现有受保护的 CLOUDFLARE Environment 进行审批，并使用其 Cloudflare 凭据及 PRODUCTION_DEPLOY_ENABLED=true。
4. 先确认生产 D1 app_meta 的版本是 26 或已完成 27，迁移历史严格吻合前 25 条或 26 条文件，实例为 production:xingyu-blog，绝不允许其他 D1；检查关键加密 Worker Secret 的名字。
5. **任何数据库写入前完成新 Worker 构建**，且对于首次 26→27 迁移必须取得并记录 D1 Time Travel bookmark；未得到书签不得迁移。
6. 仅应用 0025_oauth_connection_labels.sql，确认迁移日志和实际表结构吻合，再把 app_meta.schema_version 从 26 修改为 27，并重复只读核验；仅随后发布预先构建的 Worker。
7. 匿名检查首页、/ask、OAuth metadata、/mcp 与空间协作 API 的未授权响应。随后人工验证管理员后台、知识空间搜索/编辑、OAuth 连接重命名和撤销、真机 iPhone Safari。

## 安全与停机边界

- 这是受保护的一次性写入发布流程，**不是**原有的只读部署工作流；旧的 schema-26 发布脚本在 27 版本会拒绝执行。
- 由于现有 Worker 对版本 26/27 严格匹配，版本标记升级到 Worker 切换之间可能出现短暂请求失败。必须安排低流量窗口，并在任何失败后先读 D1 元信息和生产 Worker 状态，不要盲目重复写入。
- 安全重试：若 0025 已应用但标记仍为 26，则只更新标记；若标记与迁移均为 27，则仅重新发布 Worker。其余不一致状态全部拒绝。
- Time Travel 书签只用于人工恢复分析；**恢复操作会覆盖恢复点之后的业务写入**，工作流绝不自动恢复 D1。
- 连接清理功能由管理员在后台交互式确认后触发；这套发布流程不会清除任何现有 OAuth 授权、个人内容或审计数据。
- 即使自动检查全绿，也不能代替真实 iPhone Safari 触控测试和管理员人工验收。

参见 Cloudflare 官方 D1 Time Travel 与 Wrangler migrations 文档。

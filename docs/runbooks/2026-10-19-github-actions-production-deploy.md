# GitHub Actions → Cloudflare Workers 生产部署

工作流：.github/workflows/deploy-production.yml

**只允许手动执行。** 合并到 main 不会自动部署。工作流不会执行生产 D1 的迁移或种子写入，而是先做只读校验，验证通过后才发布 Worker。

## 一次性配置（需要 GitHub / Cloudflare 管理权限）

1. 在 GitHub 仓库打开 Settings → Environments → New environment，名称必须是 production。
2. 在 production 环境设置 Deployment protection rules：添加 Required reviewers（建议禁止 self-review），并将 Deployment branches and tags 限制为 main。GitHub 的审批保护是后台设置，单靠 YAML 不能代替。
3. 在 production → Environment secrets 添加：
   - CLOUDFLARE_API_TOKEN：Cloudflare API Token，限制至生产账号与必要资源。需相应的 Workers 发布/路由权限，以及执行只读 D1 查询的权限；不要使用 Global API Key。
   - CLOUDFLARE_ACCOUNT_ID：Cloudflare 生产账号 ID。
4. 在 production → Environment variables 创建 PRODUCTION_DEPLOY_ENABLED。只有确认人工审批、备份、预发/回归验收、生产资源绑定后才设置为 true；未设置或非 true 即使手动触发也会失败。
5. 现有 Worker 的 ADMIN_SESSION_SECRET、RESEND_API_KEY 等业务 Secret 仍放在 Cloudflare，不要复制到仓库或工作流日志。部署所用的 Cloudflare API Token 与用户的 OAuth 令牌不是同一项。

工作流不会自行创建环境保护规则、Secrets、Cloudflare API Token、D1 或 R2。

## 手动发布

1. 检查 main 的最新 CI 与目标变更，完成所需的生产数据迁移、恢复演练和变更审批（如果此次版本涉及迁移）。
2. 打开 GitHub → Actions → Deploy production (Cloudflare Workers) → Run workflow。
3. 选择 main，确认框输入 DEPLOY 后运行。
4. verify 阶段执行 npm ci、npm run ci、生产配置文件验证；失败立即停止。
5. deploy 阶段关联受保护的 production GitHub Environment，按已设置的 Required reviewers 批准后执行。若没有设置保护规则，GitHub 不会自动添加审批。
6. 工作流读取生产 D1 中的 schema_version、app_environment、instance_id，并与 db/bootstrap.ts 和 wrangler.production.jsonc 期望值比对，查询只读且绝不改写数据库。
7. 使用已有 npm run deploy:production 重新构建并发布 Cloudflare Worker。
8. 自动校验首页、OAuth metadata（必须包含 registration_endpoint）和未授权 MCP 返回的 401。

## 注意与故障处理

- 生产 D1 标记不匹配时必须停止并调查，不得绕过数据库门禁或自动执行远程迁移。
- HTTP 冒烟不能代替完整的管理员登录、附件、发布和 Gemini 实际 OAuth 授权验收。
- Cloudflare 发布异常时，参考 Worker 部署版本记录，选择与现有 D1 schema 兼容的已知正常版本回退；不要用旧 D1 备份覆盖当前业务数据。
- 如果 Cloudflare API Token 权限不足，请检查所需的 Workers 发布/路由权限和 D1 只读权限，不要删除检查步骤。
- 本流程要求手动确认和 main 分支。CI 通过不代表线上已部署，首次真实发布仍需有 Cloudflare 权限者执行。

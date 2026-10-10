# 星屿 Connect 双轨接入与个人 PAT（Schema 25）

## 变更范围
- 保留 OAuth `xy_at_` 和同一个 `/mcp` endpoint。
- 新增 `xy_pat_` 个人 Token：每用户可持有最多 30 个同时有效凭据，独立命名、Scope、到期与撤销。
- 有效期支持 7/30/90/180/365 天及永久；数据库 `expires_at IS NULL` 表示永久。
- Token 创建时仅返回一次完整明文；数据库只有 SHA-256 哈希和末四位。
- 令牌实时校验账号是否有效，工具调用仍使用现有用户 workspace/space ACL。不能用 Token Scope 越过工作区权限。
- 旧 `MCP_WRITE_TOKEN` 在生产继续禁止。

## 迁移与上线（需要运维单独执行）
1. 在隔离环境验证 `site/drizzle/0023_personal_access_tokens.sql`，备份生产 D1。
2. 按已有 Wrangler 的 `migrations_pattern` 执行编号迁移（不得直接修改生产的既有表）。
3. 校验 `personal_access_tokens` 表及两个索引，更新该环境 `app_meta.schema_version` 为 **25**（不能只修改版本标记）。
4. 在对应预发环境部署构建，执行 `npm run ci`、`node --test tests/integration/identity-personal-pat.test.mjs`，测试真实 MCP 初始化、Scope 越权、账号停用、跨用户撤销、永久 Token 与过期 Token。
5. 仅在预发通过后由用户明确批准合并及生产部署，必要时整体回滚 Worker + D1（旧 Worker 不应挂新 Schema）。
6. 生产 `content_pages.slug='connect'` 的引导正文可通过现有页面管理编辑更新（不要在迁移中覆盖用户已修改文案）。删除旧的全站共享 Token 说明，但保留个人 PAT 的环境变量与 Codex 配置示例。

## 对外接口
- `GET /api/identity/tokens`：登录用户查看自己的 Token（仅末四位、Scope、过期/撤销/最后使用时间）。
- `POST /api/identity/tokens`：需要 session + same-origin，body 包含 `name`、`scopes`、`lifetime`。成功时明文仅返回一次。
- `DELETE /api/identity/tokens`：需要 session + same-origin，body 包含 `id`；仅能撤销自己的 Token。
- 所有响应强制 `Cache-Control: no-store`。

## 需特别验证
- 数据库迁移和 drizzle metadata/snapshot 一致性，避免后续生成迁移误差。
- 限流策略、创建配额并发竞争；当前上限为业务层计数，极端并发可能突破上限。
- 确认浏览器 / 客户端可以在远程 MCP 请求中正常发送 Authorization Header。
- 已保存的线上 `connect` 文案需要单独由内容库修改；代码部署不会自动改写用户内容。

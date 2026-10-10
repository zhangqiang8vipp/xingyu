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
- 30 条有效 Token 上限已使用单条 INSERT...SELECT 原子条件写入；仍需执行并发集成测试与请求限流检查。
- 确认浏览器 / 客户端可以在远程 MCP 请求中正常发送 Authorization Header。
- 已保存的线上 `connect` 文案需要单独由内容库修改；代码部署不会自动改写用户内容。

## 页面职责与视觉验收

- 公开 `/connect` 是纯介绍页，按已确认的 Demo 实现视觉：大标题 + 深色 endpoint 卡片、OAuth/PAT 两种方式、步骤、权限卡与 FAQ。**不读取账号、不会调用 PAT API、不显示真实 Token，也不执行 OAuth 授权**。
- 登录后的 `/ai-connections` 提供所有普通用户的个人 PAT 创建/列表/撤销与属于该账号的 OAuth 授权记录；复用原来的 AdminAccountFrame / AdminSidebar 视觉和会话。普通用户无权操作其他用户的凭据。
- 旧管理后台「AI 连接」（`/admin?section=integrations`）继续显示现有连接与激活概览，并复用 PersonalTokensPanel，仅在使用真实个人邮箱账号会话时创建个人 PAT。
- `/workspace` 不再塞入连接管理面板。侧栏新增「AI 连接」，确保实际功能不与知识空间编辑混杂。
- `content_pages[slug='connect']` 仍提供公开页可编辑文案。老生产数据库有旧 Codex/共享密钥相关内容，版本发布后应使用 `/admin?section=connect` 页面编辑器更新并审阅正文；**不要在 Schema 25 迁移中直接覆盖线上运营文案**。页面暂时隐藏已识别的旧配置文章，新站点默认种子已经改成 OAuth+PAT 指引。
- 部署检查：桌面/手机/深色模式对照已确认 Demo，不允许只出现新增小功能模块而保留原文档式主体；同时检查公开页面不触发 `GET /api/identity/tokens`。

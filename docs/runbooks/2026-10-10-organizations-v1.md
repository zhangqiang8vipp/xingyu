# 组织与部门 V1：Schema 23 发布手册

> **PR #17** 依赖 PR #16 共享工作区（Schema 22），PR #16 又依赖 PR #15 统一身份（Schema 21）。三者各自保留独立部署与迁移门禁，不能跳过依赖直接部署。

## 模型与安全边界

- User：统一的内部账号 ID，可以加入多个 Organization，邮箱与未来登录 Provider 只映射该用户。
- Organization：独立组织及组织成员关系，支持 Owner / Admin / Member。Owner 永远不可降级、退出或被删除；Admin 只能管理 Member。
- Unit / Department：组织内部的多级部门树，每人可以属于多个部门。移动部门不能产生环或跨组织父子关系；含子部门或成员的部门禁止删除；退出组织自动清理部门关系。
- Workspace：单独的数据所有权和访问边界。**组织成员、组织管理员和部门成员均不会自动获得任何个人/共享工作区的文章、附件及 MCP 权限。** 组织工作区授权和空间级 ACL 留待后续单独开发。
- 组织邀请：复用原邮箱与 Resend 基础设施，七天有效、一次性、只存 SHA-256 哈希，只有受邀邮箱的已激活星屿账号可以接受。撤销、过期、邀请人被移除均拒绝。
- 滥用限制：一个用户最多拥有 10 个活跃组织；一个组织最多有 500 个部门，每日最多创建 50 次邀请。生产仍需 WAF、发信配额及异常监控。

## 迁移

新增 `site/drizzle/0021_organizations_and_units.sql`，将 D1 **Schema 22 → 23**，增加以下五表及其索引与安全触发器：

- `organizations`
- `organization_memberships`
- `organization_invitations`
- `organization_units`
- `organization_unit_memberships`

旧 `users`、`workspaces`、`workspace_memberships`、`posts`、`spaces`、`attachments` 和 OAuth 表不重建/复制；R2 对象不搬动。

在隔离预发 D1 上完成 0021，校验表/索引/触发器、跨组织关系、循环和 Owner 不可删除；再将**同一个正确实例**的 `app_meta.schema_version` 更新为 `23`。生产禁止重写 `INSTANCE_ID` 绕过检查。migration-only 模式仍然 fail-closed。

## 预发验收

1. 确认 PR #15、PR #16 分别通过验收，预发数据库处于 Schema 22；创建独立备份和恢复演练。
2. 对 PR #17 精确 SHA 执行 `cd site && npm ci && npm run ci`，要求构建、静态检查、迁移完整性和全部 Worker/D1 测试通过。
3. 三个真实邮箱用户：A 创建两个组织，B 通过两份邀请加入两个组织，C 错误邮箱无法接受邀请；验证真实 Resend 邮件、一次性接受、撤销、过期和重放。
4. 验证组织 Owner/Admin/Member 角色：Owner 不能退出或被移除，Admin 不得管理其他 Admin，普通成员不能修改部门；降权和移除立即生效。
5. 验证部门深度嵌套、同名冲突、跨组织父级、循环引用、空部门删除以及成员自动清理。
6. 使用组织 Owner 与 Admin 尝试读取普通成员的个人工作区和 MCP 内容，必须被现有 Workspace ACL 拒绝。
7. 验证旧博客、登录、个人与共享工作区、附件、MCP 工具、公开路由正常，且组织创建不会隐式赋予工作区权限。
8. 检查 WAF、邀请邮件限额、错误日志、D1/R2 备份和回滚机制。获得用户明确批准才可进行任何生产合并、迁移和部署。

## 失败处理

不得通过删除触发器、修改生产实例标记或给组织管理员全局工作区权限来通过测试。新组织一旦开始写入，不得无备份直接恢复旧库而丢失用户数据；优先冻结写入、评估前向修复。

**此版本只有组织、成员和部门结构；团队授权与组织工作区仍是后续 V2。**

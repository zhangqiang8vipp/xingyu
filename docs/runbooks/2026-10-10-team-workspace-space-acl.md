# 团队、组织工作区与空间 ACL：Schema 24 发布手册

> V1 集成以 `docs/releases/v1-rc-20261010/` 为准。在该 RC 获准之前，不要按本文件单独部署生产。

> 本版本属于 PR #18，**依赖 PR #17（Schema 23）→ PR #16（Schema 22）→ PR #15（Schema 21）**。各依赖必须先完成独立预发/生产验收，PR #18 不允许绕过审批直接合并或部署。

## 业务范围与不可越过的边界

- Team：组织下的跨部门团队。团队成员必须是该组织当前有效成员；一个账号可以加入多个团队/组织。
- Organization Workspace：只有组织 Owner 创建，工作区 kind=organization，owner_user_id 绑定组织 Owner；数据库必须有显式 organization_workspaces 关系。**加入组织本身不获得任何工作区阅读权**。
- Workspace Team Grant：组织工作区 Owner/明确获工作区管理权限的管理员向同组织团队授予 Viewer/Editor（不能授 Owner/Admin）。团队成员移除、组织成员离开/停用、团队授权撤销会即时改变实际权限。
- Workspace 原有的直接成员授权仍有效，但组织工作区必须同时要求用户是组织有效成员。团队授权是通过数据库 view 实时计算，不同步「影子成员」。
- Space ACL：仅用于组织工作区。默认遵循工作区角色；空间设置为 restricted 后，只有获得该空间及**所有受限祖先空间**的用户/团队主体才能看见。Viewer ACL 只读，Editor ACL 允许在已有工作区 Editor 资格内写入；不能用 ACL 绕过工作区权限。Owner/Admin 可进行权限维护。
- 空间、文章列表/搜索、文章详情、发布状态、附件与关联 R2 内容、MCP 操作记录和 MCP 工作区工具全部调用相同权限模型。空间结构（包括移动和删除）由组织工作区管理角色负责，防止编辑者将受限内容移到公开上级。
- 非关联附件对组织工作区普通团队成员隐藏；上传需要明确绑定有写入权的文章。旧个人/独立共享工作区的内容与附件行为保持原样。
- **本阶段不支持** Organization Owner 默认读取其他成员个人空间，也不支持组织层级自动继承所有工作区、匿名公开共享、跨组织移动文章或自动导出内部知识。

## 数据库迁移

- D1 Schema **23 → 24**：site/drizzle/0022_teams_workspace_grants_space_acl.sql
- 新建表：teams、team_memberships、organization_workspaces、workspace_team_grants、space_access_policies、space_principal_grants
- 新增索引、团队归属/授权约束触发器，以及 **workspace_effective_grants** 统一有效权限视图。
- 不重建旧的 users、user_identities、posts、spaces、attachments、oauth_access_tokens、workspaces 等表；R2 对象不搬迁。
- 生产必须使用 migration-only 校验：先在与生产隔离的 D1 按迁移文件执行 0022，验证所有表/索引/触发器/视图和必要数据，然后更新**对应正确 INSTANCE_ID** 的 app_meta.schema_version 为 24。不能只篡改版本标记、跳过 SQL。
- 旧 Worker 不能直接指向新版数据库继续写入；回滚必须把代码、D1 schema 和数据一致性作为整体处理，避免丢失已加入的团队、空间 ACL 及工作区数据。

## 功能路径

- /organizations：组织、团队、跨部门成员、组织工作区与空间 ACL 统一操作界面
- /workspace：工作区实际文章和内容编辑入口
- /api/organizations/:id/teams：团队列表、创建
- /api/organizations/:id/teams/:teamId：团队更名、删除（必须清空成员与授权）
- /api/organizations/:id/teams/:teamId/members：团队成员的添加与移除
- /api/organizations/:id/workspaces：组织工作区列表、创建
- /api/organizations/:id/workspaces/:workspaceId/grants：工作区团队授权查询和设置
- /api/organizations/:id/workspaces/:workspaceId/grants/:teamId：撤销团队授权
- /api/workspaces/:id/spaces/:spaceId/access：查看/切换受限策略
- /api/workspaces/:id/spaces/:spaceId/access/grants：为用户/团队授予 Viewer/Editor 或撤销

## 预发验收清单

1. 独立 D1/R2/Worker、完整快照备份与恢复演练，确认之前三批发布及 Schema 23 真实完成。
2. 精确 SHA 完整 CI：lint、严格 TypeScript、Vinext 构建、Workers 类型、source、provisioning、Worker+D1+R2 integration 全绿。
3. 两个组织、三个以上已验证邮箱用户，验证非组织成员无法加入团队，不能设置跨组织团队到工作区，不能把个人空间设置组织 ACL。
4. A 团队在组织工作区先授 Viewer，再升 Editor，之后撤销；用相同 OAuth 令牌立即重复读写 MCP，必须实时反映变化，无缓存泄漏。
5. 部门、组织成员撤销后的团队资格和工作区权限同时消失；不同组织的成员身份与个人工作区不被连带修改。
6. 在含文章、附件及后代的知识空间设置 restricted；只有明确授予的主体可读，父目录 restricted 时子目录授权不能绕过父级。Editor 仍不得突破 Viewer 空间权限。
7. 搜索、目录、文章详情、MCP get_post、附件下载与审计列表在受限节点不可泄漏标题、正文、文件字节或成员数据。
8. 原博客公开页面/历史附件/旧 MCP 写作及独立共享工作区不回归；检查 WAF、日志、审计、限额和生产回滚执行案。
9. 只有收到用户明确的上线批准，才能合并 PR、执行正式 D1 迁移或开放组织共享。

## 限额与后续能力

- 每组织最多 100 团队、30 组织工作区；ACL 解析受最大空间节点数保护，过大时拒绝返回数据而不是返回部分未过滤的内容。
- 本批不实现跨空间全文检索索引、独立组织级 MCP 管理员读取令牌或复杂角色继承；需要时从有效授权模型继续扩展。

**PR #18 必须保持 Draft，未上线，直到以上真实预发验收通过。**

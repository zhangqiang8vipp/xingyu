# Schema 21→24 迁移

生产 Worker 配置是 `DB_SCHEMA_MODE=migration-only`。版本标记不对时，RC Worker 会拒绝启动。禁止只改 `app_meta.schema_version` 而不执行 SQL。禁止改 `instance_id` 来绕过校验。禁止对生产库 `xingyu-production-v2`（`ef27f3c6-349a-44ea-ae09-0cc9dccca691`）执行本文命令，除非已有单独的上线批准。

## 版本对照

| 标记 | 在上一标记之后执行的 SQL | 新增内容 |
| --- | --- | --- |
| 19 | 生产现役基线。审计时 `main` 为 PR #14。执行前必须重新读取线上标记 | 已有博客 |
| 21 | `0018_identity_email_login.sql`、`0019_workspaces_and_verification.sql` | 用户凭据、会话、邮箱验证、个人工作区 |
| 22 | `0020_workspace_collaboration.sql` | 共享工作区邀请 |
| 23 | `0021_organizations_and_units.sql` | 组织、成员、部门树 |
| 24 | `0022_teams_workspace_grants_space_acl.sql` | 团队、组织工作区、团队授权、空间 ACL、视图 `workspace_effective_grants` |

RC Worker 要求最终标记为 **24**。中间标记 21/22/23 只作为冻结窗口里的检查点。在标记达到 24 之前，不要把 RC Worker 接到这个数据库。

历史文章留在 `workspace_id=1`。迁移不重建 `posts`、`spaces`、`attachments`，不搬迁 R2 对象，不改 `public_id` 和 slug。

## 执行前检查

在 `site/` 目录，对**目标库自己的 wrangler 配置**执行。下面用 `CONFIG` 表示该配置路径。生产配置路径是 `wrangler.production.jsonc`，但默认不要用它。

```bash
npx wrangler d1 execute DB --remote --config CONFIG --json --command "SELECT key, value FROM app_meta WHERE key IN ('schema_version','app_environment','instance_id')"
npx wrangler d1 execute DB --remote --config CONFIG --json --command "SELECT COUNT(*) AS n FROM d1_migrations"
npx wrangler d1 execute DB --remote --config CONFIG --json --command "SELECT COUNT(*) AS posts FROM posts"
```

停止条件：

- `schema_version` 不是预期基线（生产侧重新读到的当前值；RC 代码假设从 19 经上述 SQL 走到 24）。
- `app_environment` 与该库身份不一致。
- `instance_id` 缺失，或与 Worker `INSTANCE_ID` 不一致。
- 目标库不是这次批准的库。

## 备份

1. 冻结该库的写入。
2. 导出可恢复的 D1 备份，记录 SHA-256 和各业务表行数。
3. 在另一个空的 D1 上恢复这份备份，确认行数一致。
4. 确认 R2 桶 `xingyu-production-media` 的版本或备份策略仍然有效。RC 迁移不写 R2。
5. 恢复演练未通过时停止。不要在原库上继续。

## 在隔离库上的顺序

隔离库先恢复生产形状的备份，再执行。不要把手上的 Schema 21 预发库 `xingyu-beta-identity-qa-20261010-db` 当成 Schema 24 演练库。

```bash
npx wrangler d1 migrations apply DB --remote --config CONFIG
```

该命令按 `drizzle/meta/_journal.json` 应用尚未记录在 `d1_migrations` 的编号 SQL，包括 0018 到 0022。然后核对对象，再写版本标记：

```bash
npx wrangler d1 execute DB --remote --config CONFIG --json --command "SELECT name FROM sqlite_master WHERE name='workspace_effective_grants'"
npx wrangler d1 execute DB --remote --config CONFIG --json --command "SELECT COUNT(*) AS n FROM users WHERE id=1"
npx wrangler d1 execute DB --remote --config CONFIG --json --command "SELECT COUNT(*) AS n FROM user_identities WHERE provider='email' AND subject='zhangqiang8vip@gmail.com' AND user_id=1"
npx wrangler d1 execute DB --remote --config CONFIG --json --command "UPDATE app_meta SET value='24' WHERE key='schema_version' AND value='19'"
```

最后一条必须只更新 1 行。若影响行数不是 1，说明基线不是 19，停止并核对，不要改成无条件 `UPDATE`。

成功判定：

- `d1_migrations` 含 `0022_teams_workspace_grants_space_acl`。
- 视图 `workspace_effective_grants` 存在。
- `users.id=1` 仍在，管理员邮箱身份仍指向该用户。
- 文章行数与冻结时一致。
- `schema_version` 为 24，`instance_id` 未变。

任一步 SQL 失败：停止。不要写版本标记。用备份恢复隔离库。生产库此时应还没有被改过。

## 回滚

版本标记写成 24 之后，旧的 Schema 19 Worker 不能再指向这个库。回滚必须同时恢复迁移前的 D1 备份和迁移前的 Worker 版本。已经有新用户、邀请、组织或团队写入时，不能用旧备份覆盖，应冻结写入后向前修复。详见 `ROLLBACK.md`。

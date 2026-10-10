# Go / No-Go

记录 RC `git rev-parse HEAD`。每一行只能填已发生的证据。空着就是未通过。

| 门禁 | 证据 | 结果 |
| --- | --- | --- |
| RC 分支含 PR #18 的 `da1504c` 与 scrypt 修复 `0c24c8d` | 提交记录 | 待本分支推送后复核 |
| `site` 下 `npm ci && npm run ci` 在该 HEAD 通过 | GitHub Actions 或本地日志 | 未完成前不得标通过 |
| 隔离 D1 从生产形状备份走到 Schema 24，视图 `workspace_effective_grants` 存在 | 命令输出 | 未做 |
| 隔离库恢复演练行数一致 | 备份 SHA 与行数 | 未做 |
| 验收 A–H | `ACCEPTANCE.md` | 仅 Schema 21 身份预发做过 A 的一部分和 G 的令牌部分 |
| 管理员原密码可登录且旧密码入口关闭 | 预发记录 | Schema 21 预发做过；Schema 24 未做 |
| 旧文章 URL 与图片在迁移后的库上仍可打开 | 预发记录 | 未做 |
| Resend 密钥只存在于 Secret，且已轮换曾泄露的钥匙 | Secret 名称列表 | 未完成轮换确认 |
| 生产 `instance_id` 与配置一致 | 只读查询 | 部署前重读 |
| 明确的生产上线批准 | 书面回复 | 没有 |

## 结论规则

- CI 绿、文档齐、生产未迁移：`READY FOR STAGING`。
- 权限、迁移或密码计算仍会在目标环境失败：`BLOCKED`。
- 隔离预发的 A–H 和备份演练都有证据：才可以写成 `READY FOR PRODUCTION APPROVAL`。
- CI 通过不能写成生产就绪。

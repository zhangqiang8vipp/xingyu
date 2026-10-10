# 环境与绑定检查

只核对名称、绑定和是否已设置。不要把 Secret 值写进工单、日志或聊天。

## Worker 明文变量

生产配置 `site/wrangler.production.jsonc` 已包含：

| 变量 | 生产值的作用 | 检查 |
| --- | --- | --- |
| `APP_ENV` | 必须为 `production` | 配置文件 |
| `INSTANCE_ID` | `production:xingyu-blog`，必须等于 D1 `app_meta.instance_id` | 配置与 `app_meta` 对读 |
| `DB_SCHEMA_MODE` | `migration-only`，禁止请求期建表 | 配置文件 |
| `CSP_MODE` | 当前为 `report-only` | 配置文件 |

预发要使用另一套 Worker 名、另一套 `INSTANCE_ID`（例如 `beta:...`）、另一套 D1 和 R2。`PUBLIC_SITE_URL` 必须是该环境自己的 https 源站。

## 需要在 Dashboard 或 `wrangler secret` 中存在的 Secret

| 名称 | 作用 | 检查方式 |
| --- | --- | --- |
| `ADMIN_PASSWORD_HASH` | 现有管理员密码的哈希。首次邮箱登录后写入 `user_credentials` | `wrangler secret list` 只看名称 |
| `ADMIN_SESSION_SECRET` | 会话签名 | 同上 |
| `ADMIN_EMAILS` | 管理员邮箱名单 | 同上 |
| `VIEWS_IDENTITY_SECRET` | 阅读计数身份 | 同上 |
| `RESEND_API_KEY` | 发信。只放 Secret，不进前端 | 同上。若密钥曾经出现在聊天或日志中，上线前在 Resend 轮换 |

## 预发才临时打开的变量

| 名称 | 作用 |
| --- | --- |
| `PUBLIC_SITE_URL` | 验证邮件和重置邮件里的站点源站，必须与请求源站一致 |
| `EMAIL_FROM` | 已在 Resend 验证的发信地址 |
| `REGISTRATION_ENABLED` | 迁移和冒烟期间保持 `false`。隔离验收通过后再设为 `true` |

生产配置里目前没有这三项。在生产冒烟完成前不要打开公开注册。

## Cloudflare 绑定

| 绑定 | 生产资源 |
| --- | --- |
| `DB` | D1 `xingyu-production-v2` |
| `MEDIA` | R2 `xingyu-production-media` |
| `ASSETS` | 构建产物 `dist/client` |
| `IMAGES` | Images |
| `VIEW_RATE_LIMITER` | namespace `1901`，240 次 / 60 秒 |

预发绑定不得复用以上生产 ID。

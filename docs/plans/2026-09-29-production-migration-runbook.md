# 生产迁移 Runbook：0014–0016 → schema 18

**用途**：把生产 Green（`xingyu-production-v2`，2026-09-30 已为 schema 15 / 14 条迁移）升到 schema 18，之后才允许部署要求 schema 18 的代码（`unbound_at` 过期计时、身份底座与文章归属、浏览计数限流；附件清理队列 0013 已上线）。**每一步只读为先，写入前有明确验证门槛；任何一步不符合预期立即停止，不修复、不回滚，先调查。**
**前置**：约 15 分钟写入冻结窗口；`npx wrangler whoami` 确认登录身份有 D1 与 Worker 权限；本机 `site/` 目录在执行。

---

## 0. 冻结窗口与基线记录

1. 记录当前 Worker 版本（Cloudflare Dashboard → Workers → xingyu-blog → Deployments，或 `npx wrangler versions list --config site/wrangler.production.jsonc`）。
2. 通知停止写入：后台、MCP、浏览器阅读计数都算写入（`post_views`）。浏览读请求可继续。
3. 基线只读核对（每条命令都应 `rows_written: 0`）：

```powershell
cd site
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT value FROM app_meta WHERE key='schema_version'" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT COUNT(*) AS c FROM d1_migrations" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT COUNT(*) AS c FROM posts" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT COUNT(*) AS c FROM attachments" --json
```

期望：schema_version=15、d1_migrations=14（或届时真实值，其余以此为基线）。在任何生产迁移前，须枚举 Green 的全部业务表（包括已上线的 `attachment_cleanup_queue`），从窗口内最新数据导出两份，核对文件 SHA-256、逐表行数、附件 D1/R2 键集，并在隔离副本预演 0014–0016 及关系审计；旧窗口快照只能用于预先试跑。

> 陷阱记录：Wrangler 对 `--command` 的**多语句串只执行第一条**（本地已验证，远端不假设）；不要在一条 `--command` 里塞分号分隔的多个语句。关系审计 SQL 用分组单条 SELECT 执行。

### 0.5 设置 `VIEWS_IDENTITY_SECRET`（部署浏览计数代码的前置）

```powershell
cd site
npx wrangler secret put VIEWS_IDENTITY_SECRET --config wrangler.production.jsonc
```

输入一个随机密钥（`openssl rand -hex 32` 一类）。当前审核分支的生产代码在密钥缺失时对浏览计数请求返回 503，且不写入；因此配置与核验密钥是发布 PR-05 的前置条件。

## 1. 应用三条迁移

```powershell
cd site
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
```

期望输出：只补 0014_hot_the_stranger、0015_amused_donald_blake 与 0016_bouncy_luckman；0013_bitter_caretaker 已应用，其余 marked as already applied。若列表不同，停止。

## 2. 只读核对新结构

```powershell
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT COUNT(*) AS c FROM d1_migrations" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' AND name='attachment_cleanup_queue'" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT name FROM sqlite_master WHERE type='index' AND name='attachment_cleanup_queue_object_key_uidx'" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT sql FROM sqlite_master WHERE name='attachment_cleanup_queue'" --json
```

再核 `attachments.unbound_at` 列与回填（回填应只影响当时 `post_id IS NULL` 的行）：

```powershell
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT name, type, dflt_value FROM pragma_table_info('attachments') WHERE name='unbound_at'" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT COUNT(*) AS c FROM attachments WHERE post_id IS NULL AND unbound_at IS NULL" --json
```

期望：d1_migrations=17；队列表与唯一索引各 1 行；`unbound_at` 为 TEXT、默认 NULL；最后一条计数为 0。

再核身份底座（0015）：三张表与两处索引存在，owner 身份与成员各 1 行，历史文章归属已回填：

```powershell
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','user_identities','site_memberships') ORDER BY name" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('user_identities_provider_subject_uidx','site_memberships_user_id_uidx') ORDER BY name" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT role, COUNT(*) AS c FROM site_memberships GROUP BY role" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT COUNT(*) AS c FROM posts WHERE author_id IS NULL OR created_by IS NULL OR updated_by IS NULL" --json
```

再核浏览计数限流（0016）：

```powershell
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' AND name='view_request_limits'" --json
```

关系审计 16 项（`site/drizzle/verify-core-relations.sql` 的每条独立 SELECT 单独 `--command` 执行），全部应为 0；任一项非 0 → 停止。部署含运维门禁的代码后，登录后台的管理员也可用 `GET /api/admin/diagnostics` 一次核对同一批 16 项（含队列与 owner 状态），与逐条 `--command` 结果互为佐证。

## 3. 写 schema 18 标记（唯一应用数据写入）

```powershell
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "UPDATE app_meta SET value='18' WHERE key='schema_version'" --json
npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --command "SELECT value FROM app_meta WHERE key='schema_version'" --json
```

期望：返回 18。

## 4. 部署与烟测

```powershell
cd site
npm run deploy:production
```

记录新 Worker 版本。烟测：

```powershell
Invoke-WebRequest -Uri 'https://zhangwansen.click/' -UseBasicParsing           # 200
Invoke-WebRequest -Uri 'https://zhangwansen.click/about' -UseBasicParsing      # 200
(Invoke-WebRequest -Uri 'https://zhangwansen.click/admin' -UseBasicParsing -Method GET -SkipHttpErrorCheck).StatusCode  # 307
```

后台登录 → 上传一个临时附件 → 删除它 → 确认成功；MCP 只读工具正常。全部通过后：

- CSP 无需 D1 变更：配置 vars 已带 `CSP_MODE=report-only`，公开 HTML 会带 `Content-Security-Policy-Report-Only`；在日志里定期复查 `csp_violation` 事件，累计数据后再决定是否切 `enforce`（先修合法资源，不要整体放宽）。
- 恢复写入（解冻）。
- 记录：Worker 版本、迁移数、schema 18、烟测时间。更新 `site/AI_HANDOFF.md` 头部的「最近线上 Worker 版本 / 生产 D1」两行与 `docs/plans/` 看板。

## 5. 回退边界（出问题只读评估，不盲动）

- **代码回退**：只能回退到经 schema 18 契约验证的先前版本（届时以云面板记录为准）；不能回退到当前只认 schema 15 的 Worker 或更早版本（会因 migration-only 版本不匹配导致请求失败）。
- **数据回退**：迁移阶段（第 3 步之前）失败且未写标记 18：Green 数据仍兼容旧代码（新表/新列对旧代码不可见、无害），可直接回退旧 Worker 版本继续服务，另排窗口重试。
- **已写标记 18 之后**：旧代码不再兼容此库；禁止 Time Travel 到切换前或切回旧 Blue/旧导出。若新版本出缺陷，做前向修复，或按「生产最新数据回退演练」从最新 Green 重新导出、隔离验证后换库。
- 任何时候**不手工改 `d1_migrations`、不用 `app_meta` 伪装迁移已执行**。

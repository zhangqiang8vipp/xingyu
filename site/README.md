# 星屿博客

星屿是一个运行在 Vinext 与 Cloudflare Workers 上的个人博客。前台包含首页、文章归档、文章阅读和关于页；后台负责站点设置、文章、分类、Markdown 实时写作与真实前台预览。

## 本地开发

需要 Node.js 22.18～22.x，或 24.11 及更高版本（与 `package.json` 的 `engines.node` 一致）。

```bash
npm install
npm run dev
```

本地地址固定为 `http://127.0.0.1:3000`，避免系统代理影响 localhost 访问。

### 开发与正式环境

- `npm run dev` 使用 `development` 环境和项目内持久化的本地 D1/R2。2026-09-28 已将原有 45 篇文章及关联数据迁移至 schema 14 的新本地 D1；旧库保留在原位置并另有一致性快照。
- `npm run dev:production` 使用另一套独立的本地正式环境预览库，原有 1 篇文章及关联数据也已迁移至 schema 14 的新本地 D1。两种本地模式均使用 `migration-only`，不会在请求中建库或升级表结构。
- 正式部署默认使用 `production` 环境，由 `wrangler.production.jsonc` 声明的 Worker + D1/R2 绑定承载。部署只发布代码，不会上传 `.wrangler` 中的开发文章。
- 两套数据库都会记录自己的环境身份；如果误把同一个数据库绑定到另一环境，应用会拒绝启动，避免串库。
- 2026-09-29 本地两库已应用 0013（附件清理队列）、0014（附件 `unbound_at`）、0015（身份底座与文章归属三列，schema 17）与 0016（浏览计数限流 `view_request_limits`，schema 18）。生产 Green 仍为 schema 14，需在维护窗口完成迁移后才能部署要求 18 的新代码；部署前还需为生产设置 `VIEWS_IDENTITY_SECRET` 云密钥。

新建本地 D1 时须先执行编号迁移、两份种子、结构和数据校验，再设置 schema 版本与环境标记；不能仅更换数据库 ID 后依赖页面请求建库。线上正式库同样必须先经过显式迁移和校验。文章只有在对应环境的后台发布后才会出现。

## 验证

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` 会执行生产构建和源码回归测试。需要同时验证本地页面、D1 和 R2 上传时，可运行：

```powershell
.\test-local.ps1
```

### D1 迁移的隔离演练

`npm run ci` 会先构建 Worker，再运行集成测试；其中包含从空 D1 执行 `drizzle/` 编号迁移的结构比对，以及“迁移 → 独立种子 → 验证 → 写入应用版本/环境标记 → `migration-only` 请求”的隔离验收。单独运行 `npm run test:integration` 前也要先执行 `npm run build`，避免测试到旧构建。种子文件 `drizzle/seed-app-defaults.sql`、`drizzle/seed-chatgpt-oauth.sql` 不在自动迁移列表中；应用版本与环境标记也不由种子自动写入，必须在目标库校验通过后才设置。

若要用 Wrangler 对**新建的隔离本地 D1 目录**复核迁移和只读关系审计，可在 `site/` 执行（将占位符换成自己创建的临时目录绝对路径，不要指向日常开发库）：

```powershell
npx wrangler d1 migrations apply DB --config wrangler.production.jsonc --local --persist-to '<隔离本地D1目录>'
npx wrangler d1 execute DB --config wrangler.production.jsonc --local --persist-to '<同一隔离本地D1目录>' --file drizzle/seed-app-defaults.sql
npx wrangler d1 execute DB --config wrangler.production.jsonc --local --persist-to '<同一隔离本地D1目录>' --file drizzle/seed-chatgpt-oauth.sql
```

迁移与种子命令必须保留 `--local` 和同一个 `--persist-to`；不要改成 `--remote`。只读审计要把 `verify-core-relations.sql` 折叠为单条 SQL 后用 `--command` 执行；Wrangler 4.130.0 的 `--file` 对此 SELECT 未返回十三项结果，直接把多行文本交给 `--command` 会报 `incomplete input`。例如 PowerShell：

```powershell
$sql = (Get-Content drizzle/verify-core-relations.sql -Raw) -replace '(?m)^--[^\r\n]*\r?\n', ''
$sql = ($sql -replace '\s+', ' ').Trim().TrimEnd(';')
npx wrangler d1 execute DB --config wrangler.production.jsonc --local --persist-to '<同一隔离本地D1目录>' --command $sql --json
```

审计输出的十三个计数应全部为 0，否则先调查差异。空间不可从根节点到达通常表示孤儿或父级循环；应结合 `spaces_missing_parent` 排查。空库全为 0 仅验证命令和 SQL 可运行；带代表性旧数据的迁移与关系检查在 `npm run test:integration` 中覆盖，仍不能代替实际生产数据迁移验收。

第 0012 条自定义迁移在数据库层保留历史 Slug：其他文章不能将它设为当前地址，历史记录也不能遮蔽其他文章的现用地址；同一篇文章仍可取回自己的旧地址。旧库升至应用 schema 14 前会先查已有冲突并 fail fast；**触发器只能阻止新冲突，不能自动修复旧数据**。切换前仍须执行上述只读审计，并逐项处理任何非零结果。

2026-09-28 已按路线图将生产 Worker 绑定切换到 `xingyu-production-v2`，仓库生产配置为 `migration-only`；旧 `xingyu-production` 仅保留作历史快照。切换后 Green 已有新写入，**不得直接切回旧库或按旧导出恢复，否则会丢失新数据**。正式库按 13 条迁移建立并复制、核对了 17 张业务表的原有列，线上读权限烟测通过；MCP 临时草稿创建与同版本并发更新已在生产验证，测试草稿已删除、审计保留。用户确认生产后台登录及临时草稿创建、修改、删除成功。R2 清理失败及管理员孤儿清单已在隔离 Worker 中以故障绑定验收；合成数据的最新 Green→新 Green 本地恢复也已通过 17 表逐行、关系审计及 Worker 读取验证。线上持续观察和以生产最新数据进行的无损回退演练仍待完成，详见仓库路线图。本地开发与正式预览绑定也已切至各自迁移库。`migration-only` 是显式迁移后的验证模式：版本/环境标记不匹配、必需表或触发器缺失、关键唯一索引的所属表、唯一性、列顺序或部分索引条件不匹配、`posts_fts` 不是关联文章的 trigram FTS5 索引、`posts.version` 缺失或不兼容，或站点设置、分类、关于/接入页面及缓存状态这些最低可编辑数据缺失时，都会拒绝请求；不会在请求中建表或补种子。启动校验不等于完整 schema 结构比对。旧 Blue 库不能直接重放从 0000 开始的迁移，也不能手工伪造 `d1_migrations` 记录。

2026-09-29 又对**当时最新**的 Green 做了受控导出：两份数据文件哈希相同，17 张业务表在本地恢复后行内容摘要全部一致；3 个关联 R2 对象也已下载，大小与 SHA-256 均匹配 D1。加密令牌等真实数据仅保存在仓库外受限目录。此为时点备份，线上随后可能继续写入；未来换库必须重新从届时最新 Green 导出并核对。代码回退只能选经 schema 14 兼容验证且绑定 Green 的 Worker 版本，不能直接用旧 Blue/旧 Worker。操作边界和 dry-run 证据见 [Schema 分歧与回退记录](../docs/plans/2026-09-11-schema-truth-source-divergence.md)。

## 浏览器验收（本机）

需要本地 dev 服务（`npm run dev`）、本机 Edge/Chrome 以及 `site/.env.local` 里的管理员密码：

```powershell
node scripts/browser-vitals.mjs "http://127.0.0.1:3000/" "http://127.0.0.1:3000/posts/<publicId>/<slug>"
node scripts/browser-e2e.mjs
```

- `browser-vitals.mjs` 对每个地址跑冷/热两次，输出 TTFB、FCP、LCP（可采集时）、CLS、传输量与最大资源。dev 未压缩、无边缘缓存，数值只作相对比较；生产量化需部署后实测。
- `browser-e2e.mjs` 覆盖 13 项本机验收：后台登录契约、发布后旧 Slug 永久重定向、弹窗/跳转阅读切换、草稿即时预览显示未保存内容且不写入 D1。正常结束时自行清理创建的测试文章；中断产生的残留可用后台删除或按 `e2e-` 前缀排查。
- 两者只用本机浏览器可执行文件，不下载驱动；因为它们依赖真实 UI 与本地数据，不进 CI，属本地验收工具。

## 项目结构

- `app/`：页面、交互组件、后台和 API。
- `db/`：D1 表结构、初始化与查询。
- `drizzle/`：数据库迁移记录。
- `public/vditor/`：Markdown 编辑器在本地加载的运行资源。
- `.openai/hosting.json`：Sites 使用的 D1 与 R2 绑定声明。

## 数据与安全

- 正式环境的后台身份来自 Sign in with ChatGPT，并由服务端执行管理员校验。
- 本地开发可使用 `.env.local` 中的开发凭据；环境文件不会提交。
- 文章、分类、站点设置和页面内容保存在 D1，图片保存在 R2。
- `ensureDatabase()` 在 Worker 实例内复用初始化结果，并在临时连接失败后允许重试。

后台文章写入契约已加入版本前置条件：`GET /api/posts/:id` 和管理列表返回 `version`；`PATCH`、`DELETE /api/posts/:id` 都必须在 JSON 请求体中带上打开页面或列表时读取的版本。旧客户端需先读取文章并传入该值；收到 `409` 时重新读取、核对后再操作，不可直接重复旧请求。删除时附件保留为私有未绑定资源，其他文章关联数据与文章在同一数据库事务中清理。

文章正文中的 `/api/attachments/att_…` 内部附件链接必须对应存在、且尚未归属其他文章（编辑时也可引用本文章已绑定的附件）。否则创建或编辑返回 `409`，正文、版本与历史 Slug 均不写入；其他普通链接不受此规则影响。旧内容里若保留了已删除或属于别篇文章的内部附件链接，保存前需先修正引用。

单篇正文最多引用 200 个不同的内部附件；超过时返回 `400` 并说明数量限制，不会只绑定前 200 个。附件 ID 列表通过 D1 JSON 参数传入，避免大量引用时超出 SQL 参数数量限制。

文章所选分类还必须在写入时存在；否则创建或编辑返回 `409`，不会留下悬空分类或部分历史地址。分类删除也仅在该分类当前无文章时成功，和并发建文/改分类操作互斥。

私密文章的目标知识空间、子空间的父空间也必须在实际写入时仍存在；空空间删除只有在执行删除的当下确认无子空间、无文章才成功。并发操作若使目标空间失效，会返回冲突或不存在错误，而不会把文章意外放到公开区。

删除已关联文章的附件也会修改文章正文：`DELETE /api/attachments/:publicId` 需携带文章 `version`，成功响应返回递增后的版本；未关联附件不需要版本。旧客户端需要更新请求体和本地编辑表单的版本，否则下一次保存会收到冲突。

## AI Agent / MCP 写作

线上站点提供标准 Streamable HTTP MCP 入口：

```text
https://zhangwansen.click/mcp
```

它直接复用博客的正式 D1 数据库，提供分类查询、文章搜索、完整 Markdown
读取、独立页面读取与更新、创建草稿、更新文章、发布、撤回和 AI 写作记录查询工具。MCP 使用独立的
`MCP_WRITE_TOKEN` Bearer 令牌，不使用后台登录密码。默认工作流是先创建
草稿，只有显式调用发布工具时文章才会上线。

权限采用类似 Notion 的分级方式：

- 分类、搜索、文章与页面读取和写作记录为只读工具，可直接执行。
- 创建草稿、修改文章和公开页面会在执行前由客户端确认。
- 发布、撤回、修改已发布文章和独立页面带有 destructive/open-world 标注，必须重点确认。
- 每次真实写入返回包含操作、修改字段、摘要和时间的 receipt，并持久化到
  `mcp_activity`；无变化的重复调用不会再次写入。

MCP 文章、页面、空间及附件元数据的写入与对应审计记录在同一个 D1 批处理中；审计失败时 D1 变更回滚。未绑定文章的附件仍是私有暂存，但同样有 `attachment:<public_id>` 审计身份及回执。R2 文件对象不属于 D1 事务；若 D1 写入失败，服务会尝试删除本次对象。若回收也失败，服务记录 `attachment_object_cleanup_required` 事件及附件 ID、对象键；后台上传返回 503 与可追查的 `attachmentId`，MCP 返回含该 ID 的错误。删除附件已提交 D1 变更后若 R2 删除失败，也记录同一事件并标记 `operation: delete`，供管理员按精确对象键回收。若 D1 已返回附件记录但审计回执异常缺失，服务保留 R2 对象并报错，避免删除仍被 D1 引用的文件；需人工检查审计记录。不能将这些补偿视为跨存储原子提交。

管理员可通过 `GET /api/attachments?mode=orphan-candidates` 只读查询 R2 中暂时找不到 D1 附件记录的对象；响应按每页最多 100 个 R2 对象扫描，并用 `nextCursor` 继续翻页。这只是**待核对候选**：正常上传时 R2 写入与 D1 提交之间也会短暂出现同样状态。回收前须确认对象已超过合理上传时间、D1 仍无对应 `object_key`，且对象键与故障日志或业务记录相符；然后在 R2 管理界面按精确对象键人工删除。接口不会自动删除对象，也不会返回文件内容。异常量大时应先排查持续性 D1 故障，不要批量删除候选。

`update_post`、`publish_post` 和 `unpublish_post` 的并发保护要求先调用 `get_post`（修改和发布前使用 `view=content`），核对正文后把返回的 `post.version` 作为 `expected_version` 传入。旧客户端若省略该参数，写入会失败；更新 MCP 工具定义并按此流程重试即可。收到版本冲突时应重新读取、人工核对并合并，不能把旧正文直接重试覆盖，也不能跳过确认直接发布。

Codex 可以在 `~/.codex/config.toml` 中这样连接：

```toml
[mcp_servers.xingyu_blog]
url = "https://zhangwansen.click/mcp"
bearer_token_env_var = "XINGYU_BLOG_MCP_TOKEN"
default_tools_approval_mode = "writes"

[mcp_servers.xingyu_blog.tools.list_categories]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.search_posts]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.get_post]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.get_page]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.list_mcp_activity]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.list_attachments]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.download_attachment]
approval_mode = "approve"

[mcp_servers.xingyu_blog.tools.upload_attachment]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.create_draft]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.update_post]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.update_page]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.publish_post]
approval_mode = "prompt"

[mcp_servers.xingyu_blog.tools.unpublish_post]
approval_mode = "prompt"
```

令牌只放入本机 `XINGYU_BLOG_MCP_TOKEN` 环境变量，不要写入仓库或
`config.toml`。

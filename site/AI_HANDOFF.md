# 星屿博客：下一位 AI 开发交接说明

> 最后整理：2026-09-30
> 仓库根目录：`E:\ProjectMyNew\boke`  
> 应用目录：`E:\ProjectMyNew\boke\site`  
> 线上地址：[https://zhangwansen.click/](https://zhangwansen.click/)  
> 最近线上 Worker 版本：`cae07732-de11-4920-b31f-a360b59d6c26`（100% 流量；本候选尚未部署）
> 生产 D1：`xingyu-production-v2`（schema 15，14 条迁移，`migration-only`；旧 `xingyu-production` 仅为历史快照，禁止切回）

这是一个可长期运营的个人博客，而不是展示用静态页面。它的核心目标是：用精致的“苹果感”阅读体验承载真实文章；管理员可以在后台用 Markdown 写作、预览和发布；外部 AI 可以通过 MCP 在有审批语义的前提下协助写作。

## 1. 接手时必须遵守的原则

1. **先读现有代码再改视觉。** 用户对细节、间距、动画触发时机和深/浅色一致性很敏感；不要为了“重做”而复制一套前台。
2. **前台、后台预览、写作实时预览必须复用同一套渲染与配色。** 不能为预览另写一个简化页面，否则很快漂移。
3. **文章的稳定身份是 `public_id`，不是 Slug。** 新地址是 `/posts/:publicId/:canonicalSlug`；改标题/Slug 时必须保留历史跳转。
4. **生产环境不能自动写示例文章。** 正式库只会初始化结构、设置、独立页面和默认“随笔”分类。
5. **写入与发布分开。** 创建草稿、更新、发布、撤回均是独立动作；无论后台还是 MCP，都不能默认替用户发布。
6. **每次上线只用 `npm run deploy:production`。** 该命令固定“构建后部署”，禁止直接对旧 `dist` 执行 `wrangler deploy`。
7. **不要把密钥、真实密码或 Token 提交进仓库。** `.env.local`、Cloudflare Secret、Codex 本机环境变量均应保持本地/平台侧管理。
8. **`package-lock.json` 只能在 `site/` 目录内、用 npm 默认的 peer 解析策略生成。** `site/.npmrc` 已固定 `legacy-peer-deps=false`；若在用户级配置了 `legacy-peer-deps=true` 的机器上重新生成，lock 会静默丢掉 peer 依赖（例如 `react-server-dom-webpack` 的非可选 peer `webpack@^5`）及其整棵子树，CI 会在 `npm ci` 阶段以 `EUSAGE: lock file's ... does not satisfy ...` 失败。生成时 npm 版本也应对齐 CI（Node 22.18 自带 npm 10.9.x）。
9. **`types:worker:check` 必须排在 `build` 之后。** `wrangler types` 的输出包含 `mainModule: typeof import("./dist/server/index")`，只有在 `dist/` 存在时才会生成该段并得出对应 hash。CI 是全新检出（没有 `dist/`），先跑检查必然报 "Types at cloudflare-env.d.ts are out of date"。

## 2. 技术架构

```text
浏览器
  ├─ 前台：首页 / 文章归档 / 文章详情 / 关于 / 接入
  ├─ 后台：设置 / 文章管理 / 分类 / Markdown 写作工作台
  └─ Codex 等 AI：MCP Streamable HTTP 客户端
          │
          ▼
Cloudflare Worker（`worker/index.ts`）
  ├─ Vinext App Router：页面与 API
  ├─ `/mcp`：`worker/blog-mcp.ts`
  ├─ Edge Cache：公开 HTML 120 秒 + stale-while-revalidate
  ├─ D1：站点设置、文章、分类、搜索、阅读数据、MCP 操作记录
  └─ R2 / Assets：图片、前端构建资源、Vditor 本地资源
```

### 核心技术栈

| 范畴 | 实现 |
| --- | --- |
| 前端/SSR | React 19、Vinext、Vite 8、TypeScript |
| 边缘运行时 | Cloudflare Workers，`nodejs_compat` |
| 数据库 | Cloudflare D1 + Drizzle ORM；搜索使用 SQLite FTS5 trigram |
| 文件 | Cloudflare R2（媒体上传）；Worker Assets（构建产物） |
| Markdown | `react-markdown`、GFM、数学公式、指令块、KaTeX、rehype-highlight、Mermaid |
| 编辑器 | Vditor（只在后台加载，资源置于 `public/vditor/`） |
| MCP | `agents/mcp`、`@modelcontextprotocol/sdk`，Streamable HTTP |
| 部署 | Wrangler，生产配置 `wrangler.production.jsonc` |

## 3. 目录地图

```text
site/
├─ app/
│  ├─ page.tsx                     首页
│  ├─ archive/                     大数据量文章归档
│  ├─ posts/                       文章详情、旧链接重定向、阅读体验
│  ├─ about/ / connect/            可编辑的独立页面
│  ├─ admin/                       管理后台、写作工作台、真实前台预览
│  ├─ api/                         文章、分类、设置、媒体、统计、阅读 API
│  └─ globals.css                  前台、后台、Markdown 的共享主题变量与样式
├─ features/
│  ├─ navigation/                  全站顶部“岛”导航与搜索
│  ├─ markdown/                    唯一 Markdown 渲染入口、本地按需 Mermaid 图表与主题
│  └─ admin/                       后台文章面板、写作工作台、Vditor 封装
├─ db/
│  ├─ schema.ts                    Drizzle 表定义
│  ├─ bootstrap.ts                 migration-only 启动校验、环境隔离与旧路径护栏
│  ├─ queries.ts                   首页/归档/后台的读取与 cursor 分页
│  ├─ post-write.ts                文章写入、删除、stable ID、Slug 历史与乐观并发
│  ├─ categories.ts / site-content.ts  分类与站点设置/独立页写入
│  ├─ health.ts                    运维健康探测（16 项关系审计、队列、owner、计数）
│  └─ …                            附件写入与清理补偿、约束错误、空间路径辅助模块
├─ server/
│  └─ auth/admin-auth.ts           管理员会话鉴权与登录限流（共享库，非路由）
├─ worker/
│  ├─ index.ts                     Worker 入口、缓存、安全响应头、MCP 路由
│  ├─ blog-mcp.ts                  MCP 工具接线、Token 校验、写入审计
│  ├─ mcp/                         各工具实现、scope 策略与读取授权
│  ├─ oauth/                       PKCE、授权码、令牌与撤销流程
│  └─ public-document-cache.ts     公开 HTML 的版本化边缘缓存
├─ public/vditor/                  编辑器本地静态资源，不能移到前台全局加载
├─ tests/rendered-html.test.mjs    源码级回归测试
├─ tests/integration/              请求级契约、迁移与写入完整性集成测试
├─ wrangler.production.jsonc       线上 Worker / D1 / 域名配置
├─ vite.config.ts                  本地开发环境绑定与环境选择
├─ package.json                    本地、测试、生产部署脚本
└─ AI_HANDOFF.md                   本文档
```

## 4. 前台功能与体验边界

### 路由

| 路径 | 职责 |
| --- | --- |
| `/` | 首页：Hero、文章筛选、搜索、精选/最新文章 |
| `/archive` | 文章归档：按年份与分类、Cursor 无限加载、左侧时间导航 |
| `/posts/:slug` | 兼容旧 Slug 链接，永久重定向至稳定地址 |
| `/posts/:publicId/:canonicalSlug` | 文章正式地址；旧 Slug/非规范 Slug 会纠正到 canonical URL |
| `/about` | 关于页，由 `content_pages` 管理 |
| `/connect` | “接入”页，说明如何连接 Codex/MCP |
| `/admin` | 管理后台，必须管理员会话 |
| `/admin/article-preview` | 草稿和未保存内容的真实前台预览入口，仅管理员可访问 |

### 导航、阅读与动效

- 顶部导航统一由 `SiteNavigation.tsx` 管理：Logo、当前页面状态、搜索、主题、阅读方式、动效偏好必须在首页、归档、文章和关于页一致。
- “上岛”是滚动时将关键信息收纳到顶部岛的行为。不要过早隐藏标题；没有空间才收纳，且必须保留可点击回顶能力。
- 文章支持**跳转阅读**和**弹窗阅读**。弹窗模式也必须保有目录、阅读进度、上一篇/下一篇和搜索能力，不能变成阉割版。
- 翻页动效可关闭；用户设备弱或选择静态模式时，不应加载/触发重动画。
- 上一篇/下一篇有悬浮预览，并支持键盘方向键。移动端以长按或触摸友好方式替代 hover。
- 深色与浅色均是一级功能，不是单纯反色；任何新组件先补齐两套 token，再进页面。

## 5. Markdown 与写作工作台

### 唯一渲染链路

所有公开文章、弹窗阅读、后台真实预览、草稿预览都必须使用 `features/markdown/MarkdownRenderer.tsx`。

支持内容包括：

- 标准 Markdown、表格、任务列表、删除线（GFM）
- KaTeX 行内/块级数学
- 受控 HTML（先 `rehypeRaw`，再 `rehypeSanitize`）
- `:::tip`、`:::note`、`:::warning`、`:::quote`、`:::details` 指令块
- 代码块语法高亮、语言标签、右上角悬浮复制
- Mermaid 图表
- 图片、视频、音频及受限的原生 HTML 标签

### Mermaid 的当前决策

- `MarkdownMermaid.tsx` 通过 `import("mermaid")` **本地按需加载**；已经移除 jsDelivr 运行时依赖。
- Mermaid 的全图表能力本身较大：普通文章不下载它，含图表的文章首次打开会下载相应分包。这是“全语法支持”与性能的真实取舍。
- 渲染使用 `securityLevel: "strict"`、`htmlLabels: false`，深浅主题通过 `xingyu:theme-change` 重新绘制。
- 不要为了缩小包直接恢复第三方 CDN；若要进一步优化，优先根据真实文章类型裁剪 Mermaid 图表定义，并做实机性能测试。

### 后台写作

- `ArticleWritingStudio.tsx` 提供代码、分屏、阅读三种模式。
- `VditorEditor.tsx` 用于 Markdown 编辑，前台不应加载其 CSS/JS。
- 预览必须携带当前未保存的 draft，并由 `AdminPreviewBridge.tsx` 注入真实页面外观；切勿用“从数据库重新读取”的简化预览替代。

## 6. 数据模型与大数据量策略

### 关键表

| 表 | 用途 | 关键规则 |
| --- | --- | --- |
| `categories` | 分类名称、Slug、颜色 | 默认分类为 `notes` / “随笔”；不要再引入“未分类”作为默认文案 |
| `posts` | 正文、状态、可见性、浏览量 | `public_id` 与 `slug` 都唯一，但公开身份优先 `public_id` |
| `post_slug_history` | 旧 Slug 到文章的映射 | 修改 Slug 时写入；用于永久重定向 |
| `site_settings` | 首页文案、品牌、SEO、展示条数 | 单例 `id = 1` |
| `content_pages` | `about`、`connect` 的完整内容 | 公开页修改立即生效，需明确确认 |
| `post_views` | 每用户每日阅读去重 | 用 `visitor_hash + viewed_on` 主键去重 |
| `mcp_activity` | MCP 写入回执与审计 | 每次真实 MCP 写入记录操作、字段、摘要、客户端 |
| `app_meta` | Schema 版本、环境身份、FTS 版本 | 禁止手工删改，除非理解迁移逻辑 |
| `admin_login_attempts` | 本地密码登录限流 | 防止暴力尝试 |

### 规模设计

- 首页仅取 `site_settings.home_post_limit` 篇，不会尝试加载所有文章。
- 归档与后台使用 cursor 分页：`updated_at/published_at + id`，不会因 1 万篇文章使用 offset 深翻页。
- 查询达到三字以上时切换至 FTS5 trigram 全文搜索；短查询回退到标题/摘要/Slug 的 `LIKE`。
- 左侧年份导航必须是固定高度、可滚动/可压缩的导航；不能把 1 万篇文章等量渲染成无限刻度。

## 7. 环境、登录和安全

### 三套环境

| 环境 | 启动方式 | 数据 | 使用场景 |
| --- | --- | --- | --- |
| 本地开发 | `npm run dev` | 项目内持久化 development D1/R2（schema 18） | 日常真实写作与开发 |
| 本地正式预览 | `npm run dev:production` | 独立的本地 production-preview D1/R2（schema 18） | 检查空库/生产外观 |
| 线上正式 | `npm run deploy:production` | Cloudflare D1 `xingyu-production-v2`（`migration-only`）与线上 R2 | 对公众可见 |

`db/bootstrap.ts` 会校验 `app_environment` / `app_meta.schema_version` 与必需表、索引、触发器和 FTS 结构；环境身份不匹配或结构不满足当前 schema 契约（代码内 `schemaVersion`，现为 **19**）时 fail fast，**绝不在请求期建表或改结构**。若同一个数据库被误接到另一环境，应用同样拒绝启动；**不要为了“先跑起来”而删除这些保护。**

旧 Blue 库 `xingyu-production` 与旧 Worker 版本只是切换前的历史快照；切换后 Green 已产生新写入，**禁止直接切回旧库、旧导出或以旧版本代码对接 Green，否则会丢失切换后的文章、令牌与审计**。任何换库都必须从届时最新 Green 重新导出、逐表核对并在隔离库验证（详见 `docs/plans/` 两份路线图记录）。

### 后台登录

- 线上和本地密码登录的基础逻辑在 `server/auth/admin-auth.ts` 与 `/api/admin/login`。
- 本地/Worker Secret 至少需要：`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`、`MCP_WRITE_TOKEN`。
- 密码尝试受 D1 限流，登录与后台页面设置为 `no-store`，并设置 `noindex`。
- `app/chatgpt-auth.ts` 保留 ChatGPT 平台头部身份集成代码，但公网管理应以已部署的密码会话为可用路径。改动鉴权前先通读 `admin-auth.ts`、`app/admin/login`、`worker/index.ts`。

### Worker 安全与缓存

- `worker/index.ts` 对所有响应补充 `nosniff`、Referrer Policy、Permissions Policy、同源 iframe、HTTPS HSTS。
- `/admin` 和 `/api/admin` 强制 `Cache-Control: no-store`。
- 公开 HTML 使用 Cloudflare Cache：`s-maxage=120`，`stale-while-revalidate=300`。后台/预览/MCP 不得缓存。
- `/mcp` 使用独立 `MCP_WRITE_TOKEN` 的 `Bearer` 校验、constant-time digest 对比、`no-store` 响应，不能复用后台密码。

## 8. MCP：给 AI 的线上写作接口

入口：`https://zhangwansen.click/mcp`

当前工具类别：

- 只读：`list_categories`、`search_posts`、`get_post`、`get_page`、`list_mcp_activity`
- 写入：`create_draft`、`update_post`、`update_page`、`publish_post`、`unpublish_post`

正确工作流：

```text
list_categories → search_posts/get_post → 展示拟修改内容与摘要 → 用户确认
→ create_draft 或 update_post → （用户再次明确要求）publish_post
```

要求：

- `create_draft` 永不自动发布。
- 更新已发布文章、更新公开独立页面、发布、撤回都属于高影响动作，客户端必须要求明确确认。
- 每次真实写入返回 receipt，并写入 `mcp_activity`；内容完全相同的更新不重复写入。
- Codex 配置样例见 `README.md`。Token 仅放入本机环境变量 `XINGYU_BLOG_MCP_TOKEN`，不要复制到仓库。

## 9. 常用命令

在 `site/` 目录执行：

```powershell
# 安装与本地开发
npm install
npm run dev

# 质量检查
npm run lint
npm run typecheck
npm test

# 本地完整检查（含页面、D1、R2）
.\test-local.ps1

# 生产部署：唯一允许的发布命令
npm run deploy:production

# 只校验 Worker 配置与产物，不发布
npx wrangler deploy --dry-run --config wrangler.production.jsonc

# 线上故障排查
npx wrangler tail xingyu-blog --config wrangler.production.jsonc
npx wrangler versions list --config wrangler.production.jsonc
```

生产部署后的最低验证：

```powershell
Invoke-WebRequest -Uri 'https://zhangwansen.click/' -UseBasicParsing
npm audit --omit=dev --registry=https://registry.npmjs.org
```

期望：公开首页 HTTP 200，`npm audit` 为 0 漏洞。若审计再次报出 Next / PostCSS / Sharp / MCP SDK 链路的漏洞，先升级并验证，不要粗暴降级 MCP SDK 或关闭审计。

## 10. 最近完成的安全与交付修复

### 2026-09 生产 D1 切换与写入加固（详见 `docs/plans/` 两份路线图记录）

1. 生产 D1 已从 bootstrap 建出的旧 Blue 库切至 migration-first 的 Green 库 `xingyu-production-v2`：schema 14、13 条编号迁移、`DB_SCHEMA_MODE=migration-only`；17 张业务表逐行核对，FTS、缓存 revision 与 13 项关系审计通过。
2. 文章/附件/空间/分类写入改为 D1 原子批处理 + `expected_version` 乐观并发；MCP 审计与内容写入同批次提交，审计失败则内容回滚。
3. 首页对无效 Server Action 的 `POST /` 返回 405（版本 `1336a528`，100% 流量）。
4. 旧 Blue 库与旧 Worker 版本仅为历史快照，不是无损回退目标；回退演练与远端新库恢复仍待生产维护窗口（见 [切换后跟进清单](../docs/plans/2026-09-29-post-switch-followup-checklist.md)）。
5. `feat/attachment-expiry` 在队列基础上补了未绑定附件过期回收：`attachments.unbound_at` 计时列（迁移 `drizzle/0014_hot_the_stranger.sql`，解绑重置、历史回填 `created_at`）；30 天保留期（`UNBOUND_ATTACHMENT_RETENTION_DAYS`，可调）；每日 03:17 UTC Cron 扫描把过期未绑定附件以 `expired_unbound` 入队，管理员核对 R2 对象已删后 resolve——**任何环节都不自动删除 R2 对象**。生产 Green 仍是 schema 14，详见 [切换后跟进清单](../docs/plans/2026-09-29-post-switch-followup-checklist.md)。
6. `feat/pr04-identity-base` 落地身份底座（迁移 `drizzle/0015_amused_donald_blake.sql`，schema 契约升至 **17**）：`users` / `user_identities`（`provider`+`subject` 唯一，为国内/国际 OAuth 登录预留）/ `site_memberships` 三表，`posts` 增加可空的 `author_id`/`created_by`/`updated_by`。唯一站点 owner（`local`/`owner` 身份，id 1）由迁移和幂等种子建立，历史文章全部归并 owner；后台与 MCP 写入由 `db/site-identity.ts` 在服务端解析归属并写进同一原子批处理，客户端伪造的 identity 字段被入口解析丢弃。**仍保持单管理员密码登录，无多人 UI**；多账号 OAuth 登录与角色授权是下一阶段，接入时只需为 provider 增加身份行与回调路由，不改 schema。
7. `feat/pr05-views-governance` 重做公网浏览计数（迁移 `drizzle/0016_bouncy_luckman.sql`，schema 契约升至 **18**）：`db/view-tracking.ts` 以 `VIEWS_IDENTITY_SECRET` 对服务端来源做键控 HMAC（不存任何明文 IP/客户端标识，`visitor` 请求体忽略）；事件与 `view_count` 同批次原子提交；`view_request_limits` 限流（60 秒 240 次/来源，超限 429+封锁 5 分钟）；草稿/私密/不存在统一 204；每日 Cron 清理 90 天前的 `post_views` 原始事件。**生产必须在部署窗口设置 `VIEWS_IDENTITY_SECRET` 云密钥，否则退化为本地固定密钥**（见 [Runbook](../docs/plans/2026-09-29-production-migration-runbook.md)）。
8. `feat/pr06-csp` 落地 CSP 第一阶段（无 schema 变更）：`domain/security/csp.ts` 三档模式构造器，生产 `CSP_MODE=report-only`；公开 HTML（含边缘缓存命中分支）统一带 `Content-Security-Policy-Report-Only`（严格草案：`script-src 'self'`，无 unsafe-eval/`*`；`style-src` 暂留 `'unsafe-inline'` 供 Mermaid/KaTeX/Vditor 动态样式）；违规上报 `/.well-known/csp-report` 只记结构化日志、204 且 `no-store`。**强制（enforce）前必须依据线上违规报告先修合法资源（如内联脚本哈希化）**，绝不整体放宽。开发环境默认 off。
9. `feat/pr07-ops-gates` 落地运维门禁（无 schema 变更，契约保持 **18**）：`db/health.ts` 的 `collectSiteHealth(db, schemaVersion)` 用单语句只读查询汇总 schema 版本/环境标记、`d1_migrations` 应用数、与 `drizzle/verify-core-relations.sql` 键名一致的 16 项核心关系审计、附件清理队列待处理数、owner 存在性与关键行计数；管理员端点 `GET /api/admin/diagnostics`（`isAdminRequest` + `no-store`）一次核对全量健康。每日 Cron 在附件过期扫描后追加健康门禁：任一审计项非 0 或 owner 缺失即输出 `site_health_anomaly` 事件（含异常计数，不打断清理流程；探测自身失败输出 `site_health_check_failed`）。`db/bootstrap.ts` 的 `schemaVersion` 改为模块导出供健康检查引用。
10. `feat/pr08-consistency-cleanup` 落地 P2 一致性清理（纯重构，无行为与 schema 变更）：删除了半吊子的 `server/services/` 分层——分类写入并入新模块 `db/categories.ts`、站点设置与独立页并入 `db/site-content.ts`、文章管理读取并入 `db/queries.ts`（`getAdminPost`）、删除并入 `db/post-write.ts`（`deleteAdminPost`）；共享鉴权库从 `app/api/admin-auth.ts` 迁至 `server/auth/admin-auth.ts`；跨 feature/domain/server/db 边界的相对导入统一为 `@/` alias，features/worker/app 内部保持相对路径；删除根目录静态原型 `index.html`、`article.html`。导入约定的回归由源码断言守护。

### 提交 `73ad42c`（`fix: harden production delivery and markdown assets`）

1. Next 升至 `16.2.11`，React 升至 `19.2.8`。
2. 通过 `package.json#overrides` 锁定 `postcss@8.5.22`、`sharp@0.35.3`、`@hono/node-server@2.0.11`，生产依赖审计为 **0 漏洞**。
3. Mermaid 从 jsDelivr 外链改成仓库依赖的动态导入。
4. 新增 `deploy:production = npm run build && wrangler deploy --config wrangler.production.jsonc`。
5. 测试增加了“Mermaid 不得回退 CDN”和“生产部署命令必须先构建”的回归断言。

### CI 首次跑通（提交 `2030e50`、`4f006fd`）

GitHub Actions 在此之前从未通过过，两次 `npm ci` 失败都源于本机配置而非代码：

1. lock 是在 `legacy-peer-deps=true`（用户级 `.npmrc`）下生成的，缺失 peer 子树；已在默认 peer 解析下用 npm 10.9.3 重新生成，并新增 `site/.npmrc` 固定该策略。
2. `ci` 与 `test` 脚本把 `types:worker:check` 移到 `build` 之后，修掉全新检出下的假失败。
3. 当前 `overrides`：`@hono/node-server@2.0.11`、`baseline-browser-mapping@2.11.21`、`dompurify@3.4.15`、`fast-uri@3.1.7`、`hono@4.13.7`、`ip-address@10.7.0`、`nanoid@3.3.18`、`postcss@8.5.28`、`qs@6.16.0`、`sharp@0.35.4`。
4. Node 引擎要求抬到 `^22.18.0 || >=24.11.0`（传递依赖 `@babel/*` 8.x 的要求），CI 的 `node-version` 同步为 22.18.0。

## 11. 已知取舍与后续优先级

### 已知取舍

- Mermaid 全量支持会产生较大的按需资源包。当前 Worker startup 约 70ms，普通无图文章不下载 Mermaid；若用户大量使用复杂图表，应继续做 bundle 分析和按图类型拆分。
- `npm test` 目前是类型检查、生产构建和源码级回归断言；它不能替代真实移动端触摸、弹窗阅读、动效帧率和登录流程的浏览器验收。

### 建议下一步

1. 在真实 iOS/Android 尺寸上逐页验收：顶部岛、搜索图标位置、移动导航、弹窗目录、上一篇/下一篇预览。
2. 用浏览器性能工具测量首页、普通文章、Mermaid 文章的 LCP/INP；确认 Mermaid 分包是否需要进一步裁剪。（本机 dev 口径已由 `scripts/browser-vitals.mjs` 测过：暖加载 FCP 约 200-270ms、CLS 全 0，Mermaid 家族分包是含图文章首次访问的主要开销，暂不建议裁剪；生产 LCP/INP 需部署后实测。）
3. 给核心交互补浏览器级 E2E：密码登录、草稿实时预览、Slug 重定向、MCP 写入审计、弹窗/跳转阅读模式切换。（`scripts/browser-e2e.mjs` 已提供 13 项本机验收，含登录、旧 Slug 重定向、阅读切换与草稿即时预览；真机仍待人工逐页验收。）
4. `wrangler` 已处于 4.130.0；后续大版本升级仍需单独验证提交，不与视觉大改混在同一次发布。
5. 如果要改数据结构：先升级 `schemaVersion`，编写兼容 `ALTER/CREATE INDEX/回填`，然后在本地和生产备份上验证；不要只改 `schema.ts`。

## 12. 接手检查清单

- [ ] `git status` 干净，确认当前分支和未推送提交。
- [ ] `npm install && npm test` 通过。
- [ ] 检查 `.env.local` 存在但未提交，且生产 Secret 不出现在日志/代码中。
- [ ] 访问 `/`、`/archive`、`/about`、`/connect`、一篇稳定 ID 文章和 `/admin`。
- [ ] 验证深/浅色、静态/动效、跳转/弹窗阅读均没有布局漂移。
- [ ] 编辑草稿，确认“即时预览”显示当前未保存内容而不是别的文章。
- [ ] 以只读 MCP 工具验证连接；任何公开写入前向用户展示摘要并获得确认。
- [ ] 发布前运行 `npm test` 和 `npx wrangler deploy --dry-run --config wrangler.production.jsonc`。
- [ ] 最终只执行 `npm run deploy:production`，记录 Worker Version ID。

这份交接说明比“重新做一个漂亮博客”更重要：星屿的价值在于内容、链接稳定性、写作流程与细腻的阅读体验同时可持续，而不是某一次视觉截图。

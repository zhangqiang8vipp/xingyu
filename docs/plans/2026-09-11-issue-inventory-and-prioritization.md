# XINGYU 规模化路线图（最大做强）

**日期：** 2026-09-11
**分支：** `feat/scale-readiness`
**范围：** `site/` 全部源码（135 个 ts/tsx，10813 行）
**方法：** 只读审查 + 对每条 P0 结论做代码验证 + 对依赖的技术前提做官方文档验证
**目标形态：** 从"一个写得很好的个人应用"升级为"多人、多 Agent、高流量下依然不会乱数据、不会误授权、不会因为一次重构失控的模块化单体"
**原始状态（2026-09-11）：** 本文件为规划，**当时尚未修改任何业务代码**；当前进展见下方执行看板。

---

## 执行看板（2026-09-29 核对）

上面的日期、分支、代码规模和“尚未修改”描述记录的是 2026-09-11 制订计划时的快照。后文早期调查与待授权段落也保留当时语境；最新执行状态以本节为准。2026-09-28 在用户明确同意当前维护窗口后，已将生产 Worker 从 Blue D1 切至 Green D1；切换证据与尚缺验收如下。

| 阶段 | 当前状态 | 可核验依据 / 尚缺的验收 |
| --- | --- | --- |
| PR-01 · 安全契约测试与 CI | **代码侧已完成** | `.github/workflows/ci.yml` 调用 `npm run ci`；`site/tests/integration/security-contracts.test.mjs` 覆盖原计划四条边界，并加入首页无效 Server Action POST 的 405 回归。2026-09-29 本地完整 `npm run ci` 通过：46 项源码测试、59 项集成测试、lint、类型检查、构建及 Worker 类型检查。[GitHub CI 运行 36211223730](https://github.com/zhangqiang8vip/xingyu/actions/runs/36211223730) 的 `verify` job 成功，但仅覆盖已提交 HEAD `4130970d`；**当前工作区的未提交改动不在该次远端运行范围内**，现已推送隔离分支，须以该分支最新提交的 CI 结果核验。 |
| PR-02 · Schema 单一真相源 | **生产切换完成，观察中** | 2026-09-28 对 Blue 的 17 张业务表筛选导出两次，SHA-256 完全一致；导出文件置于仓库外受限目录。隔离本地与远端 Green 均应用 13/13 条迁移、导入真实副本并运行幂等种子；17 张表原有列逐行相等，FTS 当时为 28 篇，13 项关系审计均为 0。Green 标记为 schema 14 / production，缓存 revision 10 高于 Blue 的 1。切换时 Worker 版本为 75bc1406-ee91-49fd-a430-d15ad0769d5b；现役版本见下文发布补验，DB 继续指向 xingyu-production-v2、模式为 migration-only。首页、归档、关于、接入、公开文章及附件可读，未登录后台跳转，私密文章与匿名 reader API 返回 404，匿名 MCP 返回 401。用户确认生产后台登录及临时草稿创建、修改、删除成功；之后又有线上写入，现有 Blue 仅是历史快照，不能直接切回。最新 Green 的真实数据已在受控窗口完成两次相同导出、隔离本地恢复及 17 表逐行摘要核对，3 个 R2 对象已下载并核对大小和 SHA-256；仍需持续观察，远端新库恢复/切换未在本轮演练。 |
| PR-03 · 原子写入与乐观并发 | **生产 MCP 并发及后台写入通过，隔离故障注入通过** | 文章创建/编辑、Slug 历史、Markdown 附件绑定及删除关联状态已改用 D1 原子批处理；后台和 MCP 写入按 version / expected_version 拒绝旧操作。本地故障注入和并发请求级测试通过，跨当前/历史 Slug 的数据库触发器已在 Green 迁移建立。2026-09-28 线上 MCP 临时未发布草稿创建成功；同版本两次并发更新恰好一次成功，Green 中版本为 2、正文与成功请求一致，审计 2 条。临时草稿按精确 ID 删除，审计保留。用户在生产后台完成未发布临时草稿创建、修改和删除；只读复查该标题无残留。3 条已有附件的 R2 对象均可读取且大小与 D1 一致；独立探针对象的远端精确键读回、删除与不存在确认通过。2026-09-29 隔离 Workerd 中给真实上传请求接入故障 R2 服务绑定：D1 拒绝写入且 R2 删除失败时，响应 503 与附件 ID，D1 无附件行，管理员清单找到孤儿对象，精确键重试后对象消失。此为本地故障注入，不是生产 R2 故障。 |
| PR-04 · Identity / ownership | **暂缓，待必要性确认** | 当前 `site/db/schema.ts` 没有路线图要求的 `users`、`site_memberships` 及文章 owner 建模。用户决定 PR-04 及之后没有必要的工作先暂缓；若恢复此阶段，正式开发前仍须确认多用户场景及迁移验收用例。 |
| PR-05 · 公网抗滥用与浏览量 | **用户要求暂缓** | `site/app/api/views/[slug]/route.ts` 仍接受客户端提供的 `visitor` 并写入 `post_views`；验收草案见下文。本阶段不实施，恢复时再确认限流、服务端身份及保留期。 |
| PR-06 · CSP | **用户要求暂缓** | 场景草案见下文；线上首页响应目前没有 CSP。用户恢复此阶段前不实施。 |
| PR-07～08 · 审计、结构清理 | **暂缓非必要部分** | 用户决定 PR-04 及之后没有必要的工作先暂缓；仅在具体问题证明必要时推进。原始计划中的调查结论不是当前完成证明，恢复时重新核验代码与生产约束。 |

**2026-09-29 再次只读核验：** Cloudflare API 当前部署列表显示版本 `75bc1406-ee91-49fd-a430-d15ad0769d5b` 承担 100% 流量；该版本的 D1 绑定仍指向 `xingyu-production-v2`，`APP_ENV=production`、`DB_SCHEMA_MODE=migration-only`。对该库的只读查询显示 schema 14、13 条迁移、29 篇文章、3 条附件、3 条历史 Slug、FTS 29 行、42 条原始浏览记录及累计浏览量 42；`verify-core-relations.sql` 的 13 项计数均为 0。D1 查询元数据均为 `rows_written: 0`、`changed_db: false`。公开首页、归档、关于、接入均返回 HTTP 200，未登录后台返回 307。这些是查询时刻的状态，不是新的迁移源快照。本机 Wrangler 4.130.0 的一次远端 D1 查询曾返回 API 7403；随后 `whoami` 确认 OAuth 会话与 D1 权限正常，重试最小只读查询成功，当前未复现。后续如需再次迁移，仍须在写入冻结窗口重新核对最新 Green，不能沿用旧 Blue 或这次计数。

**2026-09-29 真实数据隔离恢复：** 用户确认约 15 分钟维护窗口后，从当时最新的生产 Green 一次性筛选导出 17 张普通业务表，写入仓库外受限目录；导出前后 17 张表计数一致，再次独立导出的文件 SHA-256 相同。该快照含 29 篇文章、3 条附件元数据、349 对 OAuth access/refresh 令牌；没有沿用旧 Blue 的 28 篇文章快照。新建本地隔离 D1 应用 13 条迁移后导入 1157 条 SQL 命令，17/17 张表的行内容摘要与源库相等；FTS 29/29、SQLite 完整性 `ok`、外键违规 0、13 项关系审计全 0。幂等种子后将本地缓存 revision 从源库的 10 提到 11，最后写入 schema 14 / production 标记；实际 `migration-only` Worker 的首页、归档、公开 reader 为 200，未登录后台 307、私密 reader 404。两次导出、清单与隔离库在 `C:\Users\Administrator\AppData\Local\XingyuMigrationBackups\20260929-green-recovery-110001` 及同级恢复工作目录中，验收后所有文件已收紧为仅本机管理员可访问。**此为当时点的 D1 快照与本地恢复**；线上 Green 未切换或写入，远端新库恢复也未在本轮验证。用户已获通知恢复写入；未来切换必须从届时最新 Green 重新导出并核对。Wrangler 在导出时曾把临时签名下载地址打印到本地命令输出，地址有效期一小时，不应复制到报告或提交中。

**同日 R2 备份补验：** 再次只读查询确认生产 D1 的 3 条附件记录与前述导出时逐行相同；随后按记录中的精确对象键只读下载 3 个 R2 对象，总计 3474 字节，每个文件的大小及 SHA-256 均与 D1 元数据相符。文件与键映射置于同一受限备份目录，未修改线上 R2。此验证证明该时点 D1 附件记录有对应字节副本；没有把对象导入另一远端桶，也不证明之后新增的附件已备份。

**2026-09-29 运行观察补验：** Cloudflare GraphQL `workersInvocationsAdaptive` 对 `xingyu-blog` 从 2026-09-28 13:35:46 UTC 切换至 2026-09-29 12:50:00 UTC 的统计为 1343 次调用、0 次 Worker 执行错误。此指标不等于所有应用层 HTTP 错误。同期只读探测首页和归档为 200、未登录后台为 307；Green D1 仍为 schema 14、13 条迁移、29 篇文章、FTS 29 行、3 条附件，查询元数据为 `rows_written: 0`、`changed_db: false`。观察覆盖切换后约 23 小时 14 分钟，仍保留后续观察和交付整理。GraphQL 字段及错误语义参考 [Cloudflare Workers 指标文档](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) 和 [GraphQL 查询示例](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/observability/)。

**2026-09-29 首页 POST 500 排查与修复：** 补查 Cloudflare 边缘 HTTP 指标，在上述区间发现首页 HTTP 500 两次，说明 Worker 执行错误为 0 不等于全部响应成功。Workers Logs 同一批次有四条 500 调用，时间集中在 2026-09-28 14:51:42～45 UTC（切换约 76 分钟后），均为携带 `Next-Action` 的匿名首页 POST，Worker outcome 为 `ok`；未读取或记录请求中的敏感头和值。隔离 Workerd 用无效 action ID 复现了 `POST /` 返回 500，普通首页 GET 正常；代码中首页没有 Server Action。入口现对 `POST /` 返回 405、`Allow: GET, HEAD` 与 `no-store`，并沿用安全响应头。完整本地 CI 通过 46 项源码和 59 项集成测试；最后微调安全头后，lint、类型检查、构建及相关 5 项集成测试再次通过。Wrangler 4.130.0 dry-run 确认候选仍绑定 Green 且为 `migration-only`，随后发布版本 `1336a528-25a2-4c46-acda-03833585e0b9`；Cloudflare 部署列表确认 100% 流量，版本元数据确认 D1 绑定仍为 Green。线上首页/归档 200、未登录后台 307，相同无效 action POST 405。未迁移或修改生产 D1；该边界修复不证明任意 Server Action 输入都已覆盖。

**提交前 PR-01～03 交付边界复核：** 当时主工作区有 56 个已修改或未跟踪路径；本地 `npm run ci` 再次以退出码 0 完成 lint、类型检查、构建、Worker 类型检查、46 项源码测试和 58 项集成测试。与 PR-01～03 无关的 Markdown/Mermaid 呈现改动主要在 `site/app/globals.css`、`site/features/markdown/`；`site/features/admin/VditorEditor.tsx` 同时包含 PR-03 的附件删除版本传递与 Mermaid 主题修改，`site/tests/rendered-html.test.mjs` 同时包含迁移/写入契约与 Mermaid 断言。整理交付时须按变更片段区分，保留这些已有用户改动，不能整文件丢弃。当时尚未 commit 或 push；旧 GitHub CI 只覆盖旧 HEAD，不能证明这 56 个工作区变更已经通过远端 CI。兼容 schema 14 的代码回退检查与已验证的 dry-run 见 Schema 分歧报告；现役版本本身有缺陷时仍需前向修复。

**2026-09-29 隔离交付候选：** 基于相同的 Git HEAD `4130970d` 建立 Codex 工作树 `C:\Users\Administrator\.codex\worktrees\pr01-03-delivery\boke`。将当前 PR-01～03 文件复制到隔离目录，排除 `site/app/globals.css`、`site/features/markdown/` 的四个纯 Mermaid 路径；在 `VditorEditor.tsx` 与 `rendered-html.test.mjs` 中按片段保留文章/附件版本改动，去掉 Mermaid 呈现片段。主工作区原文件未改写。拆分时隔离目录含 54 个已修改或未跟踪路径；独立 `npm ci` 后 `npm run ci` 以退出码 0 通过 lint、类型检查、构建、Worker 类型检查、46 项源码测试和 59 项集成测试，`git diff --check` 通过。用户授权后，这份候选已提交到 `codex/pr01-03-delivery` 分支并推送；它不是线上已部署源码的逐字副本（线上包含现有 Mermaid 改动）。当前主工作区仍保留原有改动，远端 CI 是否通过须以该分支最新提交对应的 GitHub Actions 结果为准。

**2026-09-29 交付复核：** 隔离候选已建立[草稿 PR #1](https://github.com/zhangqiang8vip/xingyu/pull/1)，来源为 `zhangqiang8vipp:codex/pr01-03-delivery`，目标为上游 `main`。原提交 `22af5e4b` 的 [push CI](https://github.com/zhangqiang8vip/xingyu/actions/runs/36574869649) 成功；此后若文档提交更新，须以最新提交重新核验。fork 触发的 PR 工作流显示 `action_required`、没有 job，需由上游仓库有写权限的维护者批准后运行；不可把该状态记作 PR CI 通过。Cloudflare 部署 API 再次确认生产版本 `1336a528-25a2-4c46-acda-03833585e0b9` 承担 100% 流量。该版发布后截至 2026-09-29 13:31 UTC 的站点边缘 HTTP 指标共 41 次请求、无 5xx；Worker 执行错误指标为 0，样本量仍少。Green D1 只读复查为 schema 14、13 条迁移、29 篇文章、3 条附件，查询没有写入。未来如需再次迁移，仍须从届时最新 Green 导出并核对，不能使用旧 Blue 或先前备份。

**当前阶段进度口径（2026-09-28）：生产 PR-02/PR-03 切换与原子写入约 97%，不代表整条多人化路线图完成。**真实生产数据已复制到 Green 并逐表核对，生产 Worker 已切换。切换后复查首页、关于、归档均为 200，匿名 MCP 为 401，Green 仍为 schema 14、13 条迁移、28 篇文章和 3 条附件。用户确认生产后台登录和未发布临时草稿创建、修改、删除成功；Green 只读复查该标题无残留。旧 Worker 版本仍能查询到，绑定旧 Blue D1；Blue 当前为 schema 12、28 篇文章和 3 条附件。但 Green 比 Blue 多 2 对 OAuth 令牌及 2 条 MCP 审计，直接回切会丢失这些切换后状态，因此不能把旧版本可用等同于无损回退，须先设计增量同步或明确可接受的数据损失。

**2026-09-29 新增线上写入：**用户说明切换后又在线上写入。只读复查当前 Green 为 schema 14、13 条迁移、29 篇文章、3 条附件、3 条历史 Slug、348 对 OAuth 令牌、168 条 MCP 审计；文章数已比前次增加 1。前述 2026-09-28 导出和 Blue 库都是旧快照，不能再作为当前数据的无损回退目标；任何再次迁移都必须从最新 Green 开始重新核对写入，并防止导出期间并发变化。当前没有执行重新导出或切换。

稍后同日只读复查 Green 仍为 29 篇文章、3 条附件、13 条迁移；`post_views` 为 42 行，文章累计 `view_count` 合计 42，最早浏览日期 2026-07-23，当前没有超过 90 天的原始浏览记录。该计数只是查询瞬间的状态，不是再次迁移的源快照。用户随后明确要求暂缓 PR-05，现阶段不修改公网浏览量实现。

同日对最新 Green 直接执行 `verify-core-relations.sql` 中完整的 13 项只读关系审计，全部为 0；文章与 FTS 均为 29 行。CLI 元数据报告 `rows_written: 0`、`changed_db: false`。旧提交 `4130970d` 的初始化代码只识别 schema 12，若将旧 Worker 重新绑定 schema 14 的 Green，会落入请求期初始化路径，因此也不能把旧代码改绑 Green 当作安全回退；详见 Schema 分歧报告。用户明确要求暂缓 PR-06，CSP 场景仅作草案保留。

又以切换时保存的代码快照重建部署候选源码，和当前工作区逐文件比较：除文档、本地 Vite 绑定与集成测试外，生产业务源码没有新的文本差异。当前构建与保存的部署候选 Worker bundle 在归一化构建生成的随机 UUID 后一致；这些是本地快照证据，不能代替从 Cloudflare 远端下载运行中代码的逐字比较。本轮测试改动本身不要求重新部署生产 Worker。

最新 Green→新 Green 的本地隔离恢复演练另写入 Schema 分歧报告：合成源库包含切换后新增文章、附件元数据、历史 Slug、浏览、审计和 OAuth 令牌，按 17 表导出/导入后逐行相等；FTS 3/3、完整性 `ok`、13 项关系审计全 0，目标缓存 revision 7 > 来源 6，目标 schema 14 / production。恢复库启动 `migration-only` Worker 后，公开页/新增文章 reader 为 200 且 reader 返回最新正文，私密文章匿名读取为 404。此演练不包含生产最新数据导出或 R2 对象复制，不证明线上可无损立即切库。

用户确认本地迁移场景后，日常开发与本地正式预览库从 schema 12 的快照分别复制到新 schema 14 库，旧库文件未覆盖。两库各执行 13 条迁移，17 张业务表原有列逐行一致，文章/FTS 分别为 45/45 与 1/1，13 项关系审计均为 0，SQLite 完整性均为 `ok`。Vite 两种模式现均绑定新库并设为 `migration-only`；实际启动后开发环境首页、关于、归档、公开文章为 200，正式预览环境首页、关于、归档为 200，匿名 MCP 均为 401。本机端口 3000/3011 被系统拒绝监听，验收分别改用 8789/8790；这不是页面或 D1 故障。Wrangler 4.130.0 的 `createTestHarness` 在带 D1 绑定时 `worker.getEnv()` 持续挂起，已在隔离集成测试环境新增同库绑定的 Worker 桥接查询，保留真实 Worker 请求和 D1/R2 执行；2026-09-29 本地完整 `npm run ci` 通过，含 46 项源码测试和 58 项集成测试。余下仍需持续观察和无损回退方案的隔离验收；未完成这些证据前不宣称整轮修复完成。

2026-09-27 本地完整 `npm run ci` 复跑通过：lint、typecheck、build、Worker types check、46 项源码测试和 49 项集成测试。另在全新临时本地 D1 用 Wrangler 4.130.0 复跑了 13 条编号迁移、两份独立种子与只读关系审计：13 项问题计数均为 0，`d1_migrations=13`、站点设置 1 行、独立页面 2 行、预设 OAuth 客户端 1 行。手工演练命令已补齐种子步骤。该结果仅覆盖当前本地工作区及合成空库，不替代未提交改动的远端 CI、真实生产数据迁移或线上验收。

PR-03 又补到一项数据完整性回归：正文中的内部附件 ID 若不存在或已归属别篇文章，原实现的绑定 `UPDATE` 会影响 0 行，却仍返回文章创建/编辑成功。现在文章 `INSERT` / `UPDATE` 与历史 Slug 写入都在同一 D1 batch 中按附件可绑定数量设条件，不满足时返回 409；可用附件仍正常绑定。隔离测试覆盖缺失、混合有效/缺失、他文已占用及编辑失败后正文、版本、历史地址不变。此行为会拒绝以前可保存但引用坏附件的 Markdown，属于有意收紧的内部附件链接契约；外部链接不受影响。

继续核对入口时发现正文附件 ID 在超过 200 个时被静默截断，且用逐 ID SQL 参数绑定会触发本地 D1 的参数数目错误。现改为拒绝第 201 个不同的内部附件引用，并用 `json_each(?)` 接收完整 ID 数组；本地请求级测试确认 201 个返回 400、未写入文章或绑定附件，200 个有效引用则全部保存并绑定。尚未在生产 D1 验证，未部署。

同一检查又发现分类无外键：文章只检查 `categoryId > 0`，可直接保存指向不存在分类的文章；分类删除采用“先查用量，再删”的两次写入，和建文并发时可能产生孤儿。现已让文章创建/编辑及历史 Slug 写入在 SQL 条件中检查目标分类存在，并把删除分类改为单条“无文章引用才删除”的条件语句。隔离请求级测试覆盖不存在分类、编辑不留部分历史地址、并发建文/删分类后没有孤儿。

空间归属也已按同一原则补护栏：文章创建/编辑与历史地址写入在 SQL 执行时重新确认目标空间存在；创建、移动子空间在实际写入时确认父空间仍存在；空空间删除以单条语句确认既无子空间也无文章；“移动后删除”在同一 batch 内重新确认接收空间存在并检查原空间已真正删除。隔离请求级测试覆盖无效空间、并发建文/删空空间、建子空间/删父空间，以及正常移动和编辑。由于并发测试不能枚举每种调度顺序，核心保证来自写入条件与 D1 单语句/批处理的原子性；直接绕过服务层的任意 SQL 写入仍须靠迁移审计发现孤儿。

空间层级移动还关闭了另一个并发窗口：预检查目标不在源空间子树后，其他请求可能改变层级。现在单空间改父级、删除空间并迁移子内容的每条写入 SQL 都在执行时重新检查目标不在源子树内；本地双请求测试覆盖相互改父级、目标进入源空间与迁移删除竞态，确认无环、无不可达空间，且正常移动仍可用。

历史异常层级的读取也已加边界：空间路径先按 ID 去重，再检查循环或缺失父级；空间内文章、后台文章列表与后台阅读接口共用记录已访问节点的路径查询，遇到成环、断开的父级或文章引用不存在的空间时标为“层级异常”。隔离 D1 注入两节点环及一篇空间 ID 无效的文章后，关系审计报出 2 个从根不可达的空间和 1 篇缺失空间的文章，子树文章列表可返回而非无限递归；健康的两级路径顺序保持不变。此改动只防止异常数据拖垮读取，不代替修复历史脏数据。

对异常层级的递归删除现在先校验待删空间的上级链：成环或父级缺失时返回 409，不进入删除批处理。隔离回归先复现了原实现会返回 200 并删除环中全部空间及文章，修复后验证节点、文章保留；健康树的递归删除仍通过。

附件上传原先只在写入 R2 前检查文章存在；若文章随后被删除，最终 D1 插入仍可能写入悬空的 `post_id`。现在保留前置检查以尽早报错，并在最终 `INSERT ... SELECT` 中重新确认归属文章存在；条件不满足时尝试回收刚上传的对象并拒绝成功响应。隔离请求级测试覆盖正常上传及上传/删文并发后无悬空归属；并发测试不能穷尽每种调度顺序，正确性仍依赖最终 SQL 条件与删文事务。

迁移后管理端写入覆盖又发现 `PATCH /api/settings` 和 `PATCH /api/pages/about` 对未传字段写入默认值或空串：隔离库分别复现了只改站点名称会清掉标语、只改关于页标题会清掉 Markdown 正文。现由 `site-content` 服务只更新请求明确提供的字段；同一迁移库的请求级回归确认原内容保留。分类的 `PATCH` 也曾把未传的 Slug 与颜色改成默认值，现仅更新显式字段；删除不存在的分类返回 404，不再误报成功。分类新增、局部修改、删除及重复删除均有迁移后请求级覆盖。此外，分类保存原把所有 D1 异常都报成 Slug 冲突（409）；现只将真实唯一约束冲突映射为 409，其余存储故障由接口返回 500，创建与编辑均由隔离请求测试验证。这些测试不代替真实生产数据导入校验。

站点设置另有一次写入假成功：若 `site_settings` 的固定行缺失，旧 `UPDATE` 影响 0 行仍返回 200 和默认设置。现在用 `RETURNING` 确认确有更新，缺行则返回服务端错误；隔离库的请求级测试先复现了误报，再确认修复后不会声称保存成功。

MCP 空间工具的无变化调用也已对齐现有 README 契约：`update_space` 的名称/父级不变，或 `move_space` 的目标就是当前父级时，不再触发空间 UPDATE 或新增审计记录，返回明确的“未执行写入”回执。请求级测试先复现了原来重复调用会产生新 `activity_id`，修复后确认空间行与审计计数不变，同时真实改名和移动仍写入并记录审计。这不解决下面的“实际写入成功但审计失败”问题。

空间创建/编辑也曾把任意 D1 写入异常捕获成“同名空间”409。隔离库用触发器注入实际存储故障后先复现误报，现与分类服务共用唯一约束识别：只有同层 Slug 唯一冲突仍返回 409，其他 D1 故障由接口返回 500；根空间及同级子空间创建与编辑均有请求级回归。

PR-02 启动校验曾只按名字检查必需索引。隔离迁移库把 `categories_slug_uidx` 替换成同名普通索引、在错误列上建唯一索引、或用部分条件只保护部分 Slug 时，请求仍会返回 200；现在 `migration-only` 模式核对必需索引的唯一性、列顺序及必要的部分索引谓词，发现漂移就拒绝启动，且不在请求期修复结构。也验证了根空间索引的谓词不能反向。该校验尚不等于逐项比对所有表列、触发器 SQL 和非关键索引；切换前仍须用完整结构审计确认 Green 与已审核迁移目标一致。

必需索引还必须属于正确的表：隔离库将 `categories_slug_uidx` 建成 `content_pages(slug)` 上的同名唯一索引时，旧启动逻辑仍返回 200，无法保护分类 Slug。现逐项核对 `sqlite_master.tbl_name` 与预期表；复现用例及正常迁移库启动均通过。

同一启动校验原本遗漏了迁移链额外建立的 `posts_public_id_required_insert` / `posts_public_id_required_update` 触发器：任一被删除后，即使库标记为 schema 14，请求仍返回 200。现将两者纳入必需对象；隔离库测试分别删除两道约束，确认启动拒绝服务且不在请求期重建。这里只核对存在性，触发器内容仍须在切换前的完整结构审计中比对。

全文搜索也不能仅凭 `posts_fts` 对象名验收：把它替换成同名普通表或未关联文章的 FTS5 表时，旧启动检查均放行。现要求其定义为文章 `posts`/`id` 的 trigram FTS5 索引；隔离库故障注入确认两类伪结构均拒绝启动，正常迁移库仍能服务。启动检查仍非全部列、选项和触发器内容的完整结构比对。

乐观并发依赖的 `posts.version` 曾不在启动校验内：schema 14 的隔离库将该列改名后，`/connect` 仍返回 200，随后文章写入无法按版本执行。现检查该列为 `INTEGER NOT NULL DEFAULT 1`；缺失或不兼容时拒绝启动且不请求期补列。此项只覆盖关键写入列，不宣称所有表列已完成结构比对。

迁移链与运行期建库的本地结构对照现在还比较触发器定义和索引的部分条件，而不只比较对象名称、列与唯一性；两套结构在规范化后仍一致。触发器 SQL 的格式归一化保留单引号字符串原值，测试确认 `published` 与 `Published` 不会被误判相同。`site/README.md` 的 Node 版本下限也修正为与 `package.json` 一致。此对照覆盖本地合成库，仍不能替代真实生产 schema 盘点。

文章创建/编辑的批处理错误也曾把任意 D1 故障包装成 Slug/附件冲突 409。附件绑定与文章写入故障注入先复现误报；现在仅真实的当前或历史 Slug 冲突返回 409，其余数据库故障由接口返回 500。请求级测试确认失败后正文、版本、历史地址和附件绑定不变；正常重复 Slug 仍返回 409。

附件上传的 D1 元数据插入故障也曾统一包装为 409。隔离库触发器注入先复现误报；现在保留真正的 `AttachmentError`（如文章已删除）为冲突，其余存储异常交给上传接口返回 503。本地请求级测试确认失败时没有附件行，且在本地 R2 删除了本次上传的对象。若实际 R2 清理本身失败，仍需在后续补偿设计中明确回收记录；本修复不宣称跨 D1/R2 的原子事务。

### PR-03 MCP 审计回执验收（已确认；本地实现及故障注入已通过）

原问题是 `recordActivitySafely` 等辅助函数在内容写入**之后**单独插入 `mcp_activity`，失败后仍可能返回 `ok: true` 和空回执；未绑定文章的上传没有审计。现已移除这些吞错写入路径：MCP 文章、页面、空间和附件元数据写入均将审计纳入同一 D1 `batch()`；无变化调用仍不写审计。未绑定附件使用 `attachment:<public_id>` 私有暂存身份，也持久化回执。隔离请求级故障注入确认审计插入失败时创建、编辑、发布、撤回、页面更新、空间创建/编辑/移动/空删除/迁移删除/递归删除及绑定/未绑定附件上传均不留下成功内容或审计；空间迁移/递归删除另有批处理末尾条件断言，避免后置删除影响 0 行而提交前面的移动。正常空间迁移与递归删除、上传后回执可查也通过。**这仍是本地证据，不代表生产 D1/R2 已演练或部署。**

| 场景 | 前置条件与操作 | 建议验收结果 |
| --- | --- | --- |
| 文章写入成功 | 已授权客户端创建草稿、编辑文章、发布或撤回；版本有效 | 文章及其历史 Slug、Markdown 附件绑定与一条审计记录一起提交；`ok: true` 的 `activity_id`、`recorded_at` 非空，`list_mcp_activity` 可查到同一记录。 |
| 文章审计失败 | 隔离 D1 故障注入让审计插入失败，执行上述任一写入 | 整个 D1 写入失败，文章正文、状态、版本、历史地址、附件归属和公开缓存 revision 均不改变；不得返回成功或建议盲目重试。 |
| 页面与空间写入 | 更新公开页面；创建、重命名、移动、删除空间（包括递归删除） | 页面或空间变更与对应审计记录在同一 D1 事务；审计失败时内容及子孙文章的状态全部不变，删除成功后仍可查到指向已删除空间的审计记录。 |
| 并发与无变化请求 | 旧版本文章写入、移动空间竞态，或提交与当前内容相同的更新 | 失败或无变化时不产生“成功写入”的审计记录；无变化应明确告知未执行写入。文章并发时仍只有符合版本的一方成功。 |
| 已绑定文章的附件 | R2 对象写入后，D1 附件元数据或审计插入失败 | 工具不返回成功；D1 附件和审计均不留半条记录，尝试清理本次新建的 R2 对象；清理失败须有可定位的补偿/回收记录，不把跨 R2/D1 操作宣称为天然事务。 |
| 未绑定文章的附件 | 客户端上传暂未关联文章的私有附件 | 已按独立 `attachment:<public_id>` 审计身份返回持久 receipt，仍为私有暂存；长期未绑定附件的自动过期/回收策略尚未实施，须另行设计。 |

**已确认的关键取舍：** D1 内容写入与审计同事务，审计失败就回滚内容。R2 对象上传发生在 D1 前；D1 失败时尝试删除本次对象。清理失败会返回含附件 ID 的错误，并写入 `attachment_object_cleanup_required` 结构化事件（含对象键）；后台接口现在也向已认证管理员返回可追查的 `attachmentId`。原捕获路径曾在 D1 已返回附件行、仅审计回执异常缺失时仍删除 R2 对象，可能制造“D1 指向不存在文件”；现只在 D1 批处理失败或确认未插入附件行时清理，已返回行但回执异常则保留 R2 并记录待查事件。删除附件在 D1 已提交后 R2 清理失败也输出相同结构化事件。现补了管理员只读的 `/api/attachments?mode=orphan-candidates`：分页扫描 R2 对象并对照 D1 `object_key`，本地验证了鉴权、正常对象排除、候选定位及跨页读取；对象自身在 R2 持久保留，管理员可经核对后按精确键人工回收。候选可能包含正在上传的对象，绝不能自动删除。本地纯函数故障注入验证 R2 删除失败会保留对象、给出附件 ID 与对象键，精确键重试可回收；**这不等于真实 R2 绑定的失败注入**。尚未建立独立孤儿队列，也未对真实 R2 清理失败做故障注入，因此跨存储补偿的运维闭环仍待验证。生产写入语义未切换。

### 下一阶段：PR-02 的可执行关口

**本地迁移演练（2026-09-26～27）：** Wrangler 的迁移文件模式仅包含编号 SQL；`seed-app-defaults.sql` 和 `seed-chatgpt-oauth.sql` 须单独执行。迁移完成后不能直接启用 `migration-only`：先运行种子、核对对象和数据，最后再为已验证的目标库写入 `app_meta.schema_version=14` 与对应 `app_environment`。隔离 D1 上的请求级测试已证明这一顺序可服务公开页面、后台登录、草稿创建及编辑、MCP 文章读取及更新、发布及撤回，公开读权限也随状态切换；空间创建、空间内已发布文章的公开不可见与管理员可读、私密附件上传及匿名不可下载/管理员可下载也通过迁移库请求级测试。迁移库中的私密文章删除后，附件解除归属、匿名仍不可下载、管理员仍可取回；随后删除该附件时，D1 记录与本地 R2 对象均移除，且请求前后结构快照不变。站点设置、默认分类、独立页面及 OAuth 客户端与旧初始化路径的默认行内容一致（排除时间戳），重复种子不覆盖已编辑内容。另以保有文章及历史链接的 schema 13 本地库演练旧初始化路径升级到 14：正文、状态、公开 ID 与历史地址保持不变，历史链接仍跳转，四个保护触发器建立，重复请求不改写结构；有跨文章 Slug 冲突时升级前拒绝。未完成所有写入和权限路径的迁移后覆盖。`migration-only` 对缺少标记的空库 fail fast，不会在请求里建表。生产配置目前明确保持 `legacy-bootstrap`，不等于生产迁移已完成。

中断恢复的隔离演练还覆盖了 schema 13 加部分种子数据的状态：`migration-only` 拒绝请求且不修改结构或版本标记；手动补完 0012、重跑幂等种子并在验证后更新标记，同一个 Worker 恢复服务，原文章及既有分类不被覆盖。另用 Wrangler 4.130.0 在系统临时目录的独立本地 D1 做两步迁移故障注入：第二个 SQL 文件先插入、后报错时，仅第一个迁移和其记录保留；修正第二个文件重试后只补跑第二个，数据无重复。这个实验验证了 CLI 的本地失败/重试行为，**不等同于对本站全量迁移链或生产 D1 中断的验证**。Cloudflare [D1 Wrangler 命令文档](https://developers.cloudflare.com/d1/wrangler-commands/) 同样说明失败的单个迁移会回滚，前面已成功的迁移保留。

**日常开发库边界：** `site/vite.config.ts` 的本地绑定只有 `APP_ENV`，没有 `DB_SCHEMA_MODE`；`npm run dev` 仍走旧初始化，且其持久化状态承载正在撰写的文章。隔离的 Wrangler `--persist-to` 演练不迁移也不覆盖这份数据。日后要让日常开发走 `migration-only`，先另建可识别的本地绑定与持久化目录，完成迁移、种子、校验和内容转移，再显式切换；不能仅修改默认模式，让现有开发库在启动时被当成已迁移库。

1. **代码与空库验证（不碰生产）**：补齐 `db/schema.ts`、`drizzle/` 和触发器的迁移表达；从空 D1 运行完整迁移链；用结构化 schema 对比及现有 CI 证明新库可承载应用。不得把“生成了 SQL”当作验收通过。
2. **生产基线确认（只读、受控备份）**：本站含 FTS5 虚拟表，Wrangler 4.130.0 的隔离本地实验确认整库 export 和 `--no-data` 都失败；不能直接照旧方案执行。先取得真实生产 D1 的只读 schema 盘点，再按审核后的普通业务表清单 `--table` 导出数据并安全保存、不得进入 Git；核对对象、行数、唯一约束及历史漂移。本站当前迁移链的 16 张业务表筛选导出/导入（加一张非空登录限制表的单表演练）已在合成本地 Blue/Green 通过，**不代表真实生产数据和远程环境已经验证**。无法取得完整、可核对的数据副本时可继续代码侧工作，**不可切换生产**。详见 [修订后的 Blue/Green Phase A–E](2026-09-11-schema-truth-source-divergence.md)。
3. **Green 库迁移演练**：按 [修订后的 Blue/Green 方案 Phase A–E](2026-09-11-schema-truth-source-divergence.md) 导入并验证数据，尤其检查文章公开 ID、Slug 历史、空间权限、附件归属、OAuth、FTS 与缓存。请求级隔离测试现在按普通业务表清单逐行复制本地旧初始化库的 17 张表，先导入可编辑行、再补幂等种子，逐表比对全部列；同时验证公开/私密文章、历史地址、附件、OAuth、FTS 和页面路径。另用 Wrangler 对本站当前迁移链建出的合成 Blue 做 16 张业务表 `--table --no-schema` 导出、导入新 Green、补幂等种子，并单独验证非空 `admin_login_attempts` 的复制。CLI 演练中 16 张表行数一致、8 张非空表逐行一致、FTS 搜索和 13 项关系审计通过。针对真实生产 `posts` 缺 `version` 的差异，隔离库另以 0011 之前的旧表建 Blue、完整迁移建 Green，按旧表的显式列名复制一篇文章，确认公开 ID、Slug、正文和发布状态保留，Green 的 `version` 默认补为 1；Wrangler 4.130.0 本地 `--no-schema` 导出也确认为显式列名 INSERT，但**未以真实生产库执行导出/导入**。本地故障注入还验证了失败 SQL 文件回滚、修正后重试成功，以及前一个成功文件在后一个文件失败时仍保留；**仍不等于真实生产数据、远程导出或远程导入中断恢复演练**。`public_cache_state` 不导入，但最终切换时 Green 缓存 revision 必须超过 Blue 最新值，避免复用旧边缘缓存键。只读 `site/drizzle/verify-core-relations.sql` 可检查十三项关系问题，包括断链、不可从根到达的空间（孤儿或循环）、OAuth 客户端缺失及历史 Slug 与其他文章现用 Slug 的碰撞。该 SQL 不覆盖 R2 对象存在性或所有业务关系。失败时保持现有 Blue 库承载服务。
4. **独立生产切换关口**：只有验收通过、明确安排写入冻结/最终同步、回退路径和生产 smoke test 后，才执行 Phase F–I。生产数据写入、创建云资源和部署属于单独授权范围，不能因为本路线图更新而自动执行。
5. **退出条件**：迁移链能从空库重建完整 schema；与真实生产 schema 的每处差异都有解释；数据校验通过；切换后关键读写与权限链路通过；`ensureDatabase()` 退出请求期 DDL 并对不满足的版本 fail fast。未同时满足这些条件，不宣称 PR-02 完成。

### PR-02 验收场景（本地改造与演练已获确认；生产操作须另行授权）

| 场景 | 前置条件 | 操作 / 输入 | 预期行为与可观察结果 |
| --- | --- | --- | --- |
| 空环境启动 | 全新本地 D1，无业务表 | 执行全量迁移，再启动应用并运行请求级契约测试 | 所需表、索引、FTS、触发器均存在；首页、文章、后台、MCP 关键路径可运行；请求本身不执行 DDL。 |
| 真实旧数据保全 | 已取得生产结构盘点和逐表数据导出，Green 库与 Blue 库隔离 | 按验证后的顺序向 Green 导入普通业务表数据，重建派生数据，执行结构化 schema 与业务数据校验 | 文章及公开 ID、Slug 历史、空间层级、附件归属、OAuth 和缓存状态有可核对的结果；差异为零或逐项解释并解决；Blue 不受影响。 |
| 校验失败或迁移中断 | Green 库缺表、数据不一致，或迁移过程报错 | 中止演练并重新运行校验 | 不切换 Worker binding，不放行新版本；Blue 继续提供服务；记录失败原因和可恢复的重试入口。 |
| 切换窗口中的写入 | Green 全部预检通过，已安排冻结与最终同步 | 冻结写入、完成最终同步、确认两库数据，再切换 binding | 冻结前已接受的写入不丢失；切换后文章读写、后台鉴权、MCP 权限与公开/私密边界通过 smoke test；必要时有明确回退决策。 |
| 版本不匹配 | 应用要求的 schema 版本高于绑定库版本 | 启动应用或发送业务请求 | 应用明确失败并报告版本不匹配；不在请求中补建表、修改 schema 或静默继续。 |

用户已确认先完成本地改造与演练；**这不是生产操作授权**。生产库创建、数据写入、绑定切换和部署均需另行确认；若真实生产结构与原始调查不符，先更新方案与场景。

**2026-09-28 生产基线只读核查（不含数据导出）：** 已核对 `wrangler.production.jsonc` 绑定的 `xingyu-production` 与远端 D1 身份一致。远端 `app_meta.schema_version=12`、`app_environment=production`；首次计数时 `posts` 为 26 行、`spaces` 11 行、`attachments` 3 行，OAuth 令牌等其他业务表也有数据。随后只读计数中 `posts` 已增至 28 行，说明这些数字不是一个冻结快照，最终迁移必须安排写入冻结或可靠的最终同步，不能把本轮分时读数作为可校验副本。远端 `posts` 缺少当前代码所需的 `version` 列，因此**当前工作区不能直接部署到该库**。按目标 Drizzle 快照对 18 张普通表的列名、类型、可空性和默认值进行只读对照，共发现 9 项差异：`posts.version` 缺失，以及 `site_settings` 的 8 个文本列远端默认值为空、目标迁移默认值为站点文案。后一组是 schema 默认值差异，尚须确认现有数据复制与种子策略，不能靠它判断实际站点设置值。目标 37 个显式索引与生产的显式及 SQLite 自动索引按所属表、唯一性、列顺序和部分索引条件做逻辑签名对照，37 个约束均有远端等效索引；其中 6 个目标显式唯一索引在线上以 `UNIQUE` 自动索引实现，仅名称不同。目标 19 个触发器中，线上 13 个同名定义经保留字符串字面量的规范化对照均一致；线上明确缺少 `posts_public_id_required_insert/update`、`posts_history_slug_guard_insert/update`、`history_current_slug_guard_insert/update` 共 6 个目标触发器。远端 `posts_fts` 定义为关联 `posts.id`、使用 trigram 的 FTS5，与目标迁移的核心定义相同。另只统计空值，远端文章公开 ID、当前 Slug、历史 Slug 与附件公开 ID 的 NULL/空串计数均为 0，未读取这些字段的原值。这些结构对照没有涵盖全部表级 `CHECK`/外键约束或真实数据复制结果。将 `verify-core-relations.sql` 的 13 项只读关系计数拆成单独的远端 `SELECT` 执行后均为 0，包括空间不可达、文章/附件断链、Slug 跨文章碰撞与 OAuth 客户端断链。**这些结果只证明已检查的关系项目前没有异常，不代替逐表数据副本和 Blue/Green 演练。**远端整份 SQL 通过 Wrangler `--command` 曾返回 `incomplete input`，改用分组 SELECT；`--file` 虽为 SELECT-only 且报告业务行写入 0，却未返回结果并显示 `changed_db: true`，因此后续只读审计不再使用 `--file`。本次未导出内容行、未建 Green、未迁移或切换生产库。

为防止误把工作区版本直接部署到上述 schema 12 库，`legacy-bootstrap` 现对生产环境缺少标记或版本不是 14 的 D1 **先拒绝请求，不执行请求期建表/升级**；隔离测试覆盖空生产库和标记为 12 的库，校验应用表结构与版本标记均不变。原有 `npm run dev:production` 使用明确仅在本地 Vite 绑定配置的 `local-preview-bootstrap`，隔离测试确认仍可初始化独立空站库。这是数据安全护栏，不代表可以跳过 Green 迁移；若误部署到旧库，站点会返回 500，因此正式切换前仍须先完成数据迁移并验证。

**本轮工作区边界：** 2026-09-26 核对时已有 Markdown / Mermaid 相关未提交改动；它们不属于本路线图更新，不在 PR-02 范围内，后续分支或提交应先核对并妥善保留。

### PR-04 待确认的身份与归属验收草案（尚未授权实现）

当前密码会话只证明持有管理员密码，`getAdminIdentity()` 返回固定的 `password-admin`，MCP OAuth 的 owner subject 也是固定值；它们都不能证明多个自然人的身份。因此第一阶段建议只建立 `users`、`site_memberships` 和文章的 `author_id` / `created_by` / `updated_by` 数据底座，保留现有单管理员权限。**不展示虚假的多人审计、不开放邀请与角色菜单，也不把共享密码会话冒充为不同用户。**真正的多人登录、身份验证、角色授权和会话撤销作为下一阶段单独验收。

| 场景 | 前置条件与操作 | 预期可观察结果 |
| --- | --- | --- |
| 历史数据回填 | 已有文章、空间私密文章、OAuth 连接和管理员密码会话；在隔离副本运行迁移与回填 | 建立唯一的站点 owner；历史文章作者归该 owner，记录明确标记为历史归属，不能伪造具体创建/修改人；公开 ID、Slug、权限和附件关系不变；重复执行不改写人工指定的作者。 |
| 新建文章归属 | 单管理员通过后台或已授权 MCP 创建文章 | 作者/创建者指向同一个持久 owner；`updated_by` 可归于 owner，但 MCP 客户端标识继续单独记在操作审计中；请求失败不能留下只有部分归属字段的文章。 |
| 编辑与发布 | 后台或 MCP 以现有版本契约编辑、发布、撤回 | `author_id` 和 `created_by` 保持不变；成功的修改更新 `updated_by`，版本冲突不改动归属或正文；私密空间的公开边界不变。 |
| 迁移失败与旧客户端 | 迁移中断、归属存在 NULL，或旧客户端不发送新增字段 | 不提前启用 `NOT NULL` / FK，不静默接受未归属的新文章；旧 API/MCP 请求格式保持兼容，主体由服务端可信会话解析，不信任客户端提交的 `author_id`。 |
| 后续多用户接入 | 将来增加第二位作者、暂停成员或撤销其访问 | 此阶段只验证 schema 能表达成员和角色；在真正实现独立登录、权限执行和撤销前，不允许宣称这些能力已上线。 |

**待用户确认的产品边界：** 第一阶段是否只做身份/归属数据底座，继续保持单管理员登录和现有权限？若要本阶段就开放多人使用，必须先另定登录方式、邀请与账号恢复、角色对空间/文章/MCP 的精确权限，以及会话/令牌撤销场景，再开发。

### PR-05 待确认的公网浏览量验收草案（尚未授权实现）

现状：公开 `/api/views/[slug]` 允许任意客户端提交 `visitor`；更换该值即可重复增加浏览量。一次成功计数需要先写 `post_views`、再单独更新 `posts.view_count`，两步之间出错可能造成计数不一致。`post_views` 没有保留期。前端的独立阅读页和弹窗阅读器均会发送此请求，现有源码测试只检查 SQL 文本，不证明并发或滥用边界。

| 场景 | 前置条件与输入 / 操作 | 预期行为与可观察结果 |
| --- | --- | --- |
| 正常公开阅读 | 已发布、非私密空间的文章；读者打开独立页或弹窗 | 两种入口均能记录阅读；同一服务端识别键对同一文章同一天至多计一次；文章显示的累计浏览量与数据库一致。匿名读者无需登录。 |
| 客户端伪造与高频请求 | 同一来源反复 POST，并任意改变旧版 `visitor` 请求体 | 不能靠更换客户端字符串刷出新的独立读者；超限返回明确的限流响应，不新增原始事件或累计数。旧客户端带 `visitor` 仍能请求，但该字段不再决定身份。 |
| 并发与部分故障 | 同一识别键并发计数、或 D1 在写入期间报错 | 至多产生一条当日记录及一次累计数增加；写入失败不留下事件和累计数不一致的状态；客户端不收到虚假的 `counted: true`。 |
| 非公开与非法目标 | 草稿、私密空间文章、不存在的公开 ID 或旧 Slug | 不泄露私密文章存在性，不产生计数；公开文章的旧 Slug 若继续可读，按同一篇文章去重。 |
| 保留期与历史数据 | 现有 `post_views` 已有旧记录，含过期数据；定时清理或重复运行清理 | 只清理超过约定期限的原始去重事件；长期累计数保持不变，清理可重试且不会重加旧计数；验证清理前后关联审计与页面数字。 |
| 隐私和缺失来源信息 | 代理、共享网络、无可信 IP、禁用 Cookie 等情况 | 不持久化明文 IP 或任意客户端标识；把浏览量明确视为近似指标。来源信息缺失时采用保守、可限流的处理，不能降级为无限制写库。 |

**待用户确认的取舍：** 浏览量按“同一来源、同一文章、同一天的一次阅读”做近似去重，原始去重记录建议保留 90 天，累计浏览量长期保留。共享网络可能合并不同读者，清除 Cookie 或更换网络也可能被当作新读者；这不是精确人数统计。实施前还需核对 Cloudflare 当前的边缘限流配置和服务端来源信号，并把应用级限流、身份摘要与 D1 原子计数一同验收。

### PR-06 待确认的 CSP 验收草案（尚未授权实现）

当前 `worker/index.ts` 在应用响应上设置了若干安全头，但没有 CSP；公开文档经过 Worker 自建边缘缓存，缓存命中分支直接返回已缓存响应。阅读器、后台、Vditor、Mermaid/KaTeX、实时预览 iframe 和多处动态 style 都会影响策略。Cloudflare 文档也指出静态资源 `_headers` 不会自动覆盖 Worker 生成的响应，因此策略要按实际响应路径验证。

| 场景 | 前置条件与操作 | 预期行为与可观察结果 |
| --- | --- | --- |
| 先观察后强制 | 在隔离环境为 HTML 发送 Report-Only，遍历真实公开页、登录页、后台编辑与预览 | 记录策略违规的指令和资源来源，修正合法资源后再强制；观察阶段不破坏页面。最终生产 HTML 响应含生效 CSP，而非只有 Report-Only。 |
| 公开内容 | 含普通 Markdown、受允许的图片/附件、代码高亮、数学式和 Mermaid 的已发布文章 | 页面可读、图表和公式正常；文章中的恶意脚本/事件处理器不能执行。不得为了通过页面检查放宽为全局 `unsafe-inline`、`unsafe-eval` 或 `*`。 |
| 管理操作 | 管理员登录，编辑、上传附件、预览、发布或撤回文章 | 核心操作正常，Vditor 与预览 iframe 可用；登录/后台响应仍为 `no-store`，私密内容不因报告上报或策略配置泄露。 |
| 缓存和导航 | 公开页缓存 MISS/HIT、旧 Slug 跳转、直接刷新、客户端导航 | 每条 HTML 路径均执行同等策略；nonce/hash 与缓存 HTML 一致，不出现命中缓存后策略失效或脚本被错误阻断。 |
| 资源与接口边界 | 静态 JS/CSS、R2 附件、图片优化、OAuth/MCP/API 请求 | HTML 所需资源按最小来源白名单加载；JSON 与二进制接口保持既有协议和权限语义，不把报告接收或策略变化变成公开数据接口。 |
| 回退与兼容 | 策略生效后发现重要浏览器或编辑器功能被阻断 | 可仅回退 CSP 策略发布而不回退 D1 数据；修复后重新走 Report-Only 与浏览器关键路径验收。 |

**实施前待确认：** 以上场景是否作为 PR-06 验收标准。具体指令、nonce/hash 方案及报告采集方式要先以当前 vinext 构建产物和浏览器运行结果确定；公开页边缘缓存尤其不能直接套用每次响应随机 nonce。

---

## 0. 验证结论（本文件与初版的关键差异）

初版清单（8 条）方向正确，但更像一次代码审查。补充复核后，**新增 2 个 P0 结构问题，且均已通过代码验证属实**：

| 新发现 | 验证结果 | 关键证据 |
| --- | --- | --- |
| **P0-2 数据库迁移双轨制** | **属实，比描述更严重** | `deploy:production` 仅 `build && wrangler deploy`；`wrangler.production.jsonc` 无 `migrations_dir`；`bootstrap.ts` 在请求期手写 13+ `CREATE TABLE` / 16+ `CREATE INDEX`；`ensureDatabase()` 被 **10 个请求路径**调用 |
| **P0-3 核心写入非原子** | **属实** | `db/post-write.ts:132` 存在提示语 `"文章已保存，但附件关联失败；请再次保存完成关联"` —— 系统自己承认允许半成功状态 |

### 一处自我纠正

初版称 `AI_HANDOFF.md`"最后更新 2026-09-01"——那是**文件系统 mtime**。文档**自己的头部写的是"最后整理：2026-07-24"**。以文档自述为准，它比所述更陈旧。判断文档新鲜度应读头部声明，而非 mtime。

### 已验证的技术前提（方案立论基础）

1. **`wrangler d1 migrations apply / list / create` 确实可用**（本地 wrangler 4.130.0 实测）。
2. **`batch()` 就是事务原语**。Cloudflare 官方文档（最后更新 2026-06-22）原文：
   > "Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence."
3. **D1 的 Worker API 没有交互式事务**——没有 `BEGIN` / `COMMIT`，只有 `batch()`。**这条约束会改变修复方案的设计**（见 P0-3）。
4. 项目**本来就会用原子写**：`db/spaces.ts:236`、`db/spaces.ts:272` 已使用 `env.DB.batch([...])`。**能力存在，只是没用在文章写入上**——与"限流能力存在但没用在公开接口上"是同一类问题。

---

## 1. 最终优先级

排序原则：**变更安全 → 数据正确性 → 身份与权限 → 公网抗滥用 → 安全纵深 → 代码一致性**。

| 优先级 | 项目 | 与初版关系 |
| --- | --- | --- |
| **P0-1** | 请求级契约测试 + CI | 原 A2 + A3 合并 |
| **P0-2** | 迁移单一真相源，退出请求路径 | **新发现** |
| **P0-3** | 文章写入原子化 + 乐观并发 | **新发现** |
| **P0-4** | 正式 identity / ownership 模型 | 原 A1 升级 |
| **P0-5** | 公网限流 + 浏览量体系重构 | 原 B1 升级 |
| **P1-1** | CSP（Report-Only → enforce） | 原 B2 |
| **P1-2** | 数据约束 / 审计 / 运维门禁 | 随规模建立 |
| **P2** | services / import / 文档 / 原型清理 | 原 C1–C3 |

**P0-1 ～ P0-5 全部完成前，不进行大规模功能扩张。**

---

## 2. P0-1 · 请求级契约测试 + CI

### 正名

不是"测试很差"，而是：**缺少能证明安全边界的请求级契约测试。**

项目**并非没有真实测试**：`mcp-read.test.mjs` 直接执行真实函数，PKCE 测试真的调用 `verifyS256()`。问题在于**最危险的鉴权边界仍靠源码文本存在性证明**——`rendered-html.test.mjs` 读取生产源码后 `assert.match(source, /isAdminRequest/)`、`assert.match(source, /requireScope/)`。

### 处置

**保留现有源码级测试**——它们对架构约束（如"生产不得自动写示例文章"）仍有价值，只是不能当作安全证明。**新增一个 integration 层**：

1. `/api/posts`：anonymous → 401；admin → 成功**且 D1 真落库**。
2. `/mcp`：坏 token → 401；read scope 调 write tool → **必须拒绝**。
3. `/admin`：anonymous → 登录/拒绝。
4. **发布后公开 GET 可读；private space 文章公开 GET 永远读不到。**

第 4 条价值最高——它同时覆盖"发布语义"与"公开/私密读取边界"。

### CI 固定流水线

```text
lint → typecheck → integration → build
```

现状：仓库无 `.github/`，`deploy:production` 只是 build 后 deploy。

**这是所有后续 P0 的前置条件。**

---

## 3. P0-2 · 迁移单一真相源

### 问题

当前存在**两套并行的 schema 真相源**：

```text
db/schema.ts ──→ drizzle/0000-0008.sql        （生成链路，无人执行）
db/bootstrap.ts ──→ 手写 CREATE TABLE / INDEX （运行时执行，真正生效）
```

`ensureDatabase()` 在**请求生命周期内**做：检查 `app_meta.schema_version` → 不符则 `CREATE TABLE` → 建索引 → `PRAGMA table_info` → 必要时 `ALTER TABLE` → 数据 backfill → FTS rebuild → 写版本号。

而它被 **10 个请求路径**调用，包括每个 MCP 请求、OAuth token 请求、`/api/views` 请求。

### 风险

两个人分别改 `schema.ts` 和 `bootstrap.ts` 时极易出现：本地 schema 对、migration 对、新环境对，**但老生产库升级错**。规模化后这是最难排查的一类故障，且一旦出错影响的是数据本身。

### 目标

```text
db/schema.ts
    ↓
versioned migrations（drizzle/ 直接接入）
    ↓
CI 验证
    ↓
deploy-time migration（wrangler d1 migrations apply）
    ↓
application rollout
```

`ensureDatabase()` 最终**只做**：
- binding 是否存在
- environment 是否正确（保留现有"串库拒绝启动"保护）
- schema version 是否满足最低要求
- **不满足则 fail fast**

**禁止再在用户请求里改 schema。**

### 实施要点（已按前置调查修正）

前置调查见 `docs/plans/2026-09-11-schema-truth-source-divergence.md`，结论改变了实施方式：

- **不能**把现有 `drizzle/` 直接接入作为唯一真相源——它无法从空库重建可运行的数据库（缺 `admin_login_attempts`、`public_cache_state`、10 个 `public_cache_*` 触发器）。
- **不能**就地升级老生产库：生产库 `d1_migrations` 为空，重放会从 0000 开始并在首条 `CREATE TABLE` 失败。
- **禁止**"把老库标记为基线已应用"、手工改 `d1_migrations`、或用 `app_meta` 伪装迁移已执行。
- 采用 **Blue/Green D1**：先补齐 `db/schema.ts` 建模与迁移链，再用 `xingyu-production-v2` 新库完成切换，见分歧报告第 5 节的 Phase A–I。
- **真实生产结构盘点与可校验的逐表数据导出是 cutover 前置条件**；FTS5 使整库 export 不可用。本地结论只证明"当前代码想要的运行期 schema"，不能替代真实生产 D1 的结构与数据验证。

这是本路线图中**风险最高**的一步，建议单独 PR、单独验证、可回滚。

---

## 4. P0-3 · 文章写入原子化

### 问题

`createPostRecord`（`db/post-write.ts:41-67`）：

```text
INSERT posts
→ bindAttachmentsOrThrow()      ← 非原子
```

`updatePostRecord`（`db/post-write.ts:83-129`）：

```text
查旧 slug
→ INSERT post_slug_history
→ UPDATE posts
→ bindAttachmentsOrThrow()      ← 非原子
```

第二步失败时，代码主动返回：**"文章已保存，但附件关联失败；请再次保存完成关联"**（`db/post-write.ts:132`）——系统明确允许半成功状态。

### 规模化后的后果

单人写作时只是偶发麻烦；多人 / AI agent / 自动发布 / 并发编辑一上来会变成：
- slug history 已写，文章未改
- 文章已成功，附件未绑定
- 客户端 retry 导致部分步骤重复执行
- 两个编辑者同时保存产生 **lost update**
- **"接口报错"不等于"没有修改数据"**

这会直接破坏 API / MCP 的写入语义。

### 标准

> **成功 = 所有数据库状态完成。失败 = 数据库保持原状态。**

### 方案（受第 0 节约束 3 影响）

**关键约束：D1 Worker API 没有交互式事务**，只有 `batch()`。因此：

- **能收进 `batch()` 的必须收进去**：`posts` 写入 + `post_slug_history` + `attachment` 归属/绑定 + 相关 metadata，作为**一个原子数据库写入单元**。
- **跨存储（R2）不做 ACID**，继续用现有补偿策略。
- **"先查后写"的竞态无法靠事务消除**。`getWritablePost` → 检查 → 写入之间存在 TOCTOU 窗口，而 D1 无法持有跨读写的锁。**正确解法是让数据库用唯一约束强制**，代码只负责把约束冲突翻译成 409，而不是靠"先查一遍"来保证。这意味着 `post_slug_history.slug` 的唯一约束要真正承担正确性责任。

### 乐观并发

给 `posts` 增加 `version INTEGER NOT NULL DEFAULT 1`：

```sql
UPDATE posts SET ..., version = version + 1 WHERE id = ? AND version = ?
```

`0 rows affected` → `409 Conflict`。这样两个管理员 / AI 同时改一篇文章不会静默覆盖。

---

## 5. P0-4 · 正式 identity / ownership 模型

### 问题

`posts`（`db/schema.ts:27-54`）**完全没有主体归属**：字段为 `id, publicId, title, slug, excerpt, content, categoryId, spaceId, status, featured, viewCount, publishedAt, createdAt, updatedAt`。

同时当前 admin identity 本质是：
```ts
{ displayName: "星屿管理员", email: "password-admin" }
```
**不是持久化的用户实体。** `.env.example` 的 `ADMIN_EMAILS` 只是配置，不是 domain identity。

### 目标底座

```text
users              id, email, display_name, status, created_at
site_memberships   user_id, role (owner/admin/editor/author)
posts              author_id, created_by, updated_by
```

**`author_id` / `created_by` / `updated_by` 一开始就分开**——它们以后不是一回事。

### 分阶段（不可跳步）

```text
1. users + memberships
2. posts 增 nullable author_id / created_by / updated_by
3. 回填历史数据
4. 新写入 dual-write
5. 验证无 NULL
6. 再加 NOT NULL / FK / index
7. 最后才开放"作者只能改自己的"权限
```

一次建立 identity primitive 后，多作者、RBAC、投稿、作者主页、审计、多 AI 身份、API token ownership 均可自然长出。**不要半年后从 `author_id` 二次重构成真正的 users。**

---

## 6. P0-5 · 公网限流 + 浏览量体系重构

### 问题

`app/api/views/[slug]/route.ts`：公开 POST、无需登录、**无限流**、每次 2 次 D1 写入。去重键 `sha256(payload.visitor)` 中 `visitor` 由**客户端任意提供**（≤160 字符），无服务端秘密——换个字符串即一次新"访客"。

`post_views` 主键 `(post_id, visitor_hash, viewed_on)` 且无 retention，是**持续增长的高基数事件表**。

### 三层防护

```text
Cloudflare edge / WAF / rate-limit
        ↓
应用级 abuse guard（复用已有的 admin_login_attempts / oauth_rate_limits 模式）
        ↓
D1 唯一性约束
```

visitor key 改为：
```text
HMAC(rotating_server_secret, coarse_client_identity + date)
```
**不接受客户端直接声明自己的唯一身份。**

### Retention

```text
post_views 原始事件：保留 30/90 天
posts.view_count / 日聚合：长期保存
```
否则流量越成功，事件表越大。

---

## 7. P1

### P1-1 CSP

Worker 已设置 nosniff / Referrer-Policy / Permissions-Policy / X-Frame-Options / HSTS，**缺 CSP**。项目含 Markdown raw HTML、Mermaid、KaTeX、Vditor、管理后台。

路线：`Report-Only → 收集 violation → 修资源来源 → nonce/hash → enforce`。

**不要长期保留 `script-src 'unsafe-inline' 'unsafe-eval' *`**——那等于把 CSP 的价值抹掉。

### P1-2 数据约束 / 审计 / 运维门禁

随规模建立：DB 层约束补齐、统一 change/audit metadata、关键指标告警。项目已有 `observability: enabled` 与 `Server-Timing`，是良好起点。

---

## 8. P2 · 一致性清理

### C1 `server/services/` 半吊子分层

全仓库仅 **6 处**引用（`admin-posts`、`categories`、`site-content`）；其余路由与 MCP 工具直接 import `db/*`（`worker/mcp/*` 有 14+ 处）。

**采纳方案 A**：承认 `db/*.ts` 事实上就是服务层（`db/post-write.ts` 已是写入核心），把三个模块的独特逻辑并入对应 `db/` 模块，删除 `server/services/`。

**不要为"大项目感"人为造 service layer。当前 modular monolith 是对的。做大 ≠ 多层。** 当某个 use case 真需要 auth / transaction / audit / event / permissions 时，再建立 application 层。别把所有 `db/*` 包一层一行函数。

### C2 导入路径

机械统一即可：**跨 feature/domain/server/db 边界用 alias，模块内部用 relative**。

`app/api/admin-auth.ts` 不是路由而是共享库，却被 **19 处**引用（含 `app/admin/*` 页面），应迁至 `server/auth/`。

### C3 文档与原型

- `AI_HANDOFF.md` 头部自述"最后整理：2026-07-24"，目录图仍把 `SiteNavigation.tsx`、`MarkdownRenderer.tsx` 等写在 `app/`（实际已迁至 `features/navigation/`、`features/markdown/`）。
- 根目录 `index.html` / `article.html` 仍在，站名仍为"林屿"（现站名"星屿"）。

不影响线上数据，故 P2。

---

## 9. 执行计划：8 个 PR

**不要一个超级 PR 全干。**

| PR | 内容 |
| --- | --- |
| **PR-01** | CI + 4 条请求级安全集成测试 |
| **PR-02** | 迁移单一真相源；deploy 显式 migrate |
| **PR-03** | 文章写入原子化 + 乐观并发 |
| **PR-04** | users / memberships / ownership + 数据回填 |
| **PR-05** | 公网 abuse guard + view identity + retention/aggregation |
| **PR-06** | CSP Report-Only → enforce |
| **PR-07** | DB 约束、统一 change/audit metadata、关键指标告警 |
| **PR-08** | services / import / AI_HANDOFF / 原型清理 |

**原始排期的第一刀是 PR-01，现已在代码侧落地；下一刀不是 `author_id`，而是把数据库迁移与写入原子性收干净（PR-02 / PR-03）。当前验收边界见文首执行看板。**

---

## 10. 明确不要做的事

**不要拆微服务。不要换数据库。不要上 Redis。不要上消息队列。不要 GraphQL 化。不要重做前端架构。不要重写 `domain/`。**

项目已有且应当保留：edge HTML cache、FTS5、cursor pagination、R2、精确复合索引（`posts` 10 个游标索引）、domain isolation、共享 `post-write`、OAuth / scope、public/private read boundary、revision-based edge cache、生产 observability。

**XINGYU 缺的不是"更重的架构"，而是"更强的正确性控制面"。**

---

## 附 · 已确认健康的部分

| 项目 | 证据 |
| --- | --- |
| `domain/` 层真正纯净 | 全目录唯一非相对 import 是 `#domain/admin/location`（域内引用） |
| 前后台包体边界干净 | 前台页面均不引用 `features/admin` / `admin-auth` / `db/admin-session` |
| 写入核心共享 | 后台与 MCP 都走 `db/post-write.ts`；slug 归一化统一走 `domain/posts/post-input` 的 `slugify`；`public_id` 与 slug 历史无重复实现 |
| 索引设计优秀 | `posts` 10 个精准复合索引，与游标分页一一对应；`spaces` 使用 `WHERE parentId IS NULL` 部分唯一索引 |
| 鉴权防护扎实 | 登录有失败计数 + 窗口 + 锁定 + 429/Retry-After + Origin 校验（`app/api/admin-auth.ts:118-139`）；scrypt(N=16384) / pbkdf2-sha256（迭代 ≥210000）；会话 HMAC-SHA256 |
| OAuth 完整 | PKCE、授权码、refresh token、scope 策略、限流齐备（`worker/oauth/`） |
| 已有原子写能力 | `db/spaces.ts:236`、`db/spaces.ts:272` 已用 `env.DB.batch([...])` |
| API 路由薄 | 23 个路由共 827 行，平均约 36 行 |
| 代码卫生 | **零** TODO/FIXME/HACK；最大源文件 419 行 |

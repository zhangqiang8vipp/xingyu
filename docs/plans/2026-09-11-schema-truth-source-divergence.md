# XINGYU Schema 真相源分歧报告（PR-02 前置调查）

**日期：** 2026-09-11
**分支：** `scale-readiness`
**性质：** 只读调查。**未修改任何业务代码。**
**目的：** 为 PR-02（迁移单一真相源）确定迁移基线，并回答一个必须先回答的问题：

> `bootstrap.ts` 建出的 schema，与 `drizzle/0000-0008` 累积出的 schema，**是同一个东西吗？**

**答案：不是。而且分歧比预想更严重——真相源有三处，不是两处。**

> **本报告的结论边界（重要）**
>
> 本报告证明的是：**当前代码希望得到的运行期 schema**，与 drizzle 迁移历史所描述的结构，两者不一致。
>
> 它**不能**证明真实生产 D1 没有历史漂移、旧版本遗留或手工改动。生产库经历过多个版本的 `ensureDatabase()` 迭代，其实际结构未必等于"今天这份 bootstrap 代码在空库上的结果"。
>
> 因此 **PR-02 切换前必须对真实生产 D1 做结构盘点与可校验的逐表数据导出**（见第 5 节 Phase A；FTS5 使整库 export 不可用）。本地结论只能用来指导迁移链的重建，不能替代生产验证。

---

## 1. 调查方法（可复现）

用 wrangler 的 `createTestHarness` 起两个**互相独立**的本地 workerd + D1：

- **harness A**：正常发一次 `GET /`，触发 `ensureDatabase()`，得到**请求期建出的真实 schema**。
- **harness B**：**不发任何请求**（关键——否则预热也会跑 bootstrap），得到空库；按文件名顺序读取 `drizzle/0000`–`0008`，以 `--> statement-breakpoint` 拆分语句逐条执行，得到 **drizzle 累积 schema**。

两侧均用**结构化 PRAGMA 对比**（`table_info` / `index_list` / `index_info` / `sqlite_master`），而非文本对比，避免格式差异干扰。忽略 `sqlite_*`、`_cf_*`、`posts_fts_*` 内部对象。

**两个操作陷阱（会直接导致错误结论）：**

1. **`db.exec()` 按换行符拆分语句**（官方文档："multiple queries separated by `\n`"）。用它执行多行 DDL 会**只执行第一行**，得到 `incomplete input` 并让后续对比全盘失真。必须用 `prepare(statement).run()`。
2. **`openTestHarness()` 里的预热请求会触发 bootstrap**，使"空库"不空，所有 `CREATE` 全部报 `already exists`。

---

## 2. 已确认的三处真相源

| # | 位置 | 是否被执行 | 内容 |
| --- | --- | --- | --- |
| 1 | `db/schema.ts` → `drizzle/0000-0008.sql` | **否**（无任何环节执行） | 大部分表 |
| 2 | `db/bootstrap.ts` | **是**（请求期） | 大部分表 + `admin_login_attempts` |
| 3 | `db/public-cache-schema.ts` | **是**（请求期，被 bootstrap 引用） | `public_cache_state` + **10 个触发器** |

**关键事实：**

- `admin_login_attempts` **只存在于 `bootstrap.ts`**。`db/schema.ts` **没有建模它**，`drizzle/` 也没有它的迁移。
- `public_cache_state` 在 `db/schema.ts` 里**有声明**（第 127 行），但 **`drizzle/` 里没有任何迁移创建它** → 说明 `drizzle/` 相对 `db/schema.ts` **已经过期**（最新 schema 变更后没跑 `db:generate`）。
- 10 个 `public_cache_*` 触发器是 `public-cache-schema.ts` 里的裸 SQL，**既不在 `db/schema.ts`，也不在 `drizzle/`**。

**结论：`drizzle/` 是三者中记录最不完整的一份。**

---

## 3. 差异清单（已逐项复核）

### 3.1 真实差异

| 项 | bootstrap（生产实际） | drizzle | 影响 |
| --- | --- | --- | --- |
| `admin_login_attempts` 表 | **有** | **无** | **严重**：只跑 drizzle 的全新库，登录限流会直接报错（`getAdminLoginLimit` 查此表） |
| `public_cache_state` 表 | **有** | **无** | **严重**：公开缓存版本表缺失 |
| 10 个 `public_cache_*` 触发器 | **有** | **无** | **严重**：公开 HTML 缓存的失效机制失效，会持续返回陈旧页面 |
| `app_meta.key` | `key TEXT PRIMARY KEY`（**允许 NULL**） | `... PRIMARY KEY NOT NULL` | 中：SQLite 历史行为允许非 INTEGER 主键为 NULL，bootstrap 侧更宽松 |
| `oauth_rate_limits.identifier` | `TEXT PRIMARY KEY`（允许 NULL） | `... NOT NULL` | 中：同上 |
| `admin_login_attempts.identifier` | `TEXT PRIMARY KEY`（允许 NULL） | 无此表 | 中：同上 |
| `posts.public_id` | **`NOT NULL`** | **可空** | 中：`public_id` 是文章稳定身份，bootstrap 侧更严格（更正确）。drizzle 侧可空是因为 `public_id` 是后续 `ALTER TABLE ADD` 加入的，当时无法声明 NOT NULL |
| `site_settings` 多列默认值 | `''`（空串） | `'星屿 · 思考与创造'` 等真实文案 | 低：seeded 行有真实值，但"省略该列插入"时行为不同 |

### 3.2 我一度误报、复核后撤回的差异（重要陷阱）

初次对比时，脚本报出 **6 个唯一索引"只存在于 drizzle、bootstrap 缺失"**：

```text
attachments_public_id_uidx / attachments_object_key_uidx
oauth_access_tokens_hash_uidx / oauth_authorization_codes_hash_uidx
oauth_clients_client_id_uidx / oauth_refresh_tokens_hash_uidx
```

**这是误报。** 复核 `bootstrap.ts` 后确认，这些表全部使用了**内联 `UNIQUE`** 约束：

```sql
public_id TEXT NOT NULL UNIQUE
token_hash TEXT NOT NULL UNIQUE
code_hash  TEXT NOT NULL UNIQUE
client_id  TEXT NOT NULL UNIQUE
```

SQLite 会为内联 `UNIQUE` 生成**隐式** `sqlite_autoindex_<table>_<n>`，而对比脚本**主动跳过了 `sqlite_autoindex_*` 名字**，于是把"同一个唯一性、两种索引命名"误判为"缺失"。

**唯一性在生产库中是被强制的，不存在正确性缺口。** 真实差异仅为索引命名（隐式 vs 显式命名）。

> 教训：对比 schema 时必须把隐式索引与显式命名索引按**列组合 + 唯一性**归一化后再比，不能按索引名比。

### 3.3 确认无差异的项（不需要处理）

- `INTEGER PRIMARY KEY AUTOINCREMENT` 列的 `notnull`：PRAGMA 报 bootstrap=0 / drizzle=1，但该列是 rowid 别名，**永不为 NULL**，属 PRAGMA 表现差异，非语义差异。
- `oauth_clients.enabled`（`1` vs `true`）与 `posts.featured`（`0` vs `false`）：SQLite 自 3.23 起把 `true`/`false` 视为 1/0，**语义等价**。

---

## 4. 对 PR-02 的直接影响

### 4.1 不能简单地"改用 drizzle 作为唯一真相源"

若直接把 `drizzle/` 作为真相源并让新环境只跑它，**新库会缺 `admin_login_attempts`、`public_cache_state` 和 10 个触发器**——登录限流报错、公开缓存永不失效。这是**功能级破坏**，不是风格问题。

### 4.2 迁移链必须能从空库完整重建结构

唯一真相源必须满足这条硬标准：

```text
空数据库
+
migration history
=
可以运行完整 XINGYU 的数据库
```

禁止依赖 `GET /`、`ensureDatabase()` 或 `public-cache-schema.ts` 的请求期 DDL 才能让数据库可用。

迁移链必须能建立（当前遗漏的部分）：

```text
admin_login_attempts
public_cache_state
全部 public_cache_* triggers（10 个）
所有当前正式表
所有正式 index
所有 uniqueness
所有需要保留的 FTS 对象
当前 schema 所需的 backfill / invariant
```

配套工作：

```text
1. 让 db/schema.ts 补全缺失建模
   - 新增 admin_login_attempts（目前完全没有建模）
   - public_cache_state 已有声明，需确认与 public-cache-schema.ts 的实际 DDL 一致
   - 触发器无法用 Drizzle DSL 表达 → 作为自定义 SQL 迁移纳入版本管理

2. 之后的 schema 变更只走 drizzle generate

3. 加一个 CI 步骤：把迁移应用到空库，再与请求期建库做结构化对比，
   差异数必须为 0 —— 让分歧不可能再悄悄出现
```

### 4.3 既有生产库不能就地升级（最高风险点）

- 生产库由 bootstrap 建出，其结构与 drizzle 历史**不一致**（见 §3.1）。
- 直接对生产库 `wrangler d1 migrations apply` **不安全**。生产库的 `d1_migrations` 表是空的（从未跑过迁移），wrangler 会**从 0000 开始重放全部迁移**，第一条 `CREATE TABLE categories` 即以 `table categories already exists` 失败——实测已复现。
- 即使绕过 `CREATE TABLE`，后续的 `ALTER TABLE posts ADD space_id` 也会以 `duplicate column name` 失败（实测复现）。drizzle 的迁移历史**无法重放于生产库**。

**因此不采用"就地升级老库"的路线**，改为第 5 节的 Blue/Green 新建库。

### 4.4 明确禁止的做法

```text
禁止：把老生产库标记为"baseline 已应用"
禁止：手工修改 d1_migrations 表
禁止：用 app_meta 伪装某条 Wrangler migration 已执行
```

`app_meta` **只能**继续用于**应用自己的 schema compatibility 检查**（例如运行环境身份、schema 版本下限），**不能**代替 `Wrangler d1_migrations` 来表示迁移执行状态。

```text
禁止：在切换完成并验证稳定之前，删除 request-time schema mutation
```

### 4.5 `ensureDatabase()` 的收敛（放到最后一步）

切换并验证稳定之后，`ensureDatabase()` 才收缩为：

- binding 是否存在
- 环境身份是否正确（保留现有"串库拒绝启动"保护）
- schema 版本是否满足最低要求 → **不满足则 fail fast**

**禁止再在用户请求里改 schema。** `public-cache-schema.ts` 的触发器同样走请求期，必须一并迁出去。

这一步在 Blue/Green 中是 **Phase I**，不是开头。

---

## 5. PR-02 实施方案：Blue/Green D1

### 5.1 目标结构

```text
xingyu-production        当前生产库，暂时保持不动（Blue）
xingyu-production-v2     migration-first 新生产库（Green）
```

切换靠**改 Worker D1 binding**，不靠就地改老库。

### 5.2 实施阶段

| 阶段 | 内容 |
| --- | --- |
| **A** | 只读盘点真实生产 schema；按审核后的普通业务表清单分别导出数据，并在安全位置保存结构盘点与导出文件。FTS5 虚拟表不能用整库 export。 |
| **B** | 让 migration chain 从空 D1 完整创建全部 schema |
| **C** | 将 migration 建出的 schema 与真实生产 schema 做结构化比较 |
| **D** | 按外键与触发器依赖顺序将普通业务表数据导入 migration 建出的 `production-v2`；FTS 等派生结构由 Green 的迁移/触发器重建，不导入影子表。默认种子行与导入行的冲突须逐表决定保留/替换，不能盲目重复 INSERT。 |
| **E** | 校验：row count / unique / foreign key / slug / publicId / cache / OAuth / 文章 smoke test |
| **F** | 短暂冻结写入，执行最终增量同步或最终重新导入 |
| **G** | 在 Green 验证、版本/环境标记和缓存 revision 关口全部通过后，作为同一次受控发布把 Worker D1 binding 指向 `production-v2`，并将 `DB_SCHEMA_MODE` 设为 `migration-only`；不能沿用当前生产的 `legacy-bootstrap` 在新库上处理请求。 |
| **H** | 生产 smoke test |
| **I** | 持续观测、核对写入与权限，满足退出条件后再决定 Blue 的保留/下线；请求期不执行 DDL 的约束从 Phase G 起生效，而不是切换稳定后才开启。 |

### 5.3 生产 export 是切换前置条件

不再把"是否有生产副本"当作设计选择。**正式 cutover 前必须取得可恢复、可校验的真实生产数据副本及独立的结构盘点。**

本项目的 `posts_fts` 是 FTS5 虚拟表。Cloudflare D1 的整库 `wrangler d1 export`（包括 `--no-data`）不能导出含虚拟表的库；Wrangler 4.130.0 的隔离本地 D1 已实测失败，报错 `cannot export databases with Virtual Tables (fts5)`。因此以下旧命令**不可作为本站生产备份/迁移步骤**：

```bash
wrangler d1 export xingyu-production --remote --output=<安全的本地路径>   # 不可用：FTS5
wrangler d1 export xingyu-production --remote --no-data --output=<安全的本地路径>   # 同样不可用
```

本地最小实验验证 `--table posts --table notes --no-schema` 可导出普通表数据，`wrangler d1 execute --file` 可导入已建好 FTS5 的 Green，触发器会索引导入文章。进一步在**本站当前 0000～0012 迁移链**建出的两份隔离本地 D1 上演练：Blue 先种默认内容并写入两篇示例文章（含私密空间、历史 Slug、附件关系）；按下列 16 张业务表 `--no-schema` 导出，Green 先运行相同迁移、导入数据、最后运行幂等种子。16 张表行数一致；有样本数据的 8 张表逐行一致；FTS 命中两篇文章，`verify-core-relations.sql` 的 13 项计数全为零。再以单表导出/导入验证合成的 `admin_login_attempts` 行可保留。这个演练只证明**当前本地结构和少量合成数据**，不证明真实生产数据或远程导出的行为。

当前本地候选业务表清单（实际执行前必须以生产只读盘点为准）：

```text
categories, spaces, posts, post_slug_history, attachments,
content_pages, site_settings, post_views, mcp_activity, post_preview_tokens,
oauth_clients, oauth_access_tokens, oauth_authorization_codes,
oauth_consents, oauth_rate_limits, oauth_refresh_tokens,
admin_login_attempts
```

2026-09-28 以远端 `sqlite_master` 只读查询核对：生产 D1 的普通业务表与上述 17 张清单一致；其余表为 `app_meta`、`public_cache_state`、`posts_fts` 及其影子表、`sqlite_sequence` 和 Cloudflare 内部表。`app_meta` 只含 `app_environment`、`posts_fts_version`、`schema_version` 三个已知键。该核对确认导出对象清单，没有形成跨表一致的数据副本。

**2026-09-28 实施记录（覆盖上段的未导出状态）：** 用户确认当前可进行维护操作后，按上述 17 张普通业务表一次性筛选导出 Blue；初次与切换前第二次导出文件的 SHA-256 均为 `243EDF3458CD80E869F91802D73C15F68468F16658F6F4E4A71DDB15C526847C`，各表行数与导出后只读计数一致。文件保存在仓库外、仅当前 Windows 用户可访问的 `C:\Users\Administrator\AppData\Local\XingyuMigrationBackups\20260928-212051`，未提交 Git。隔离本地和远端 `xingyu-production-v2`（D1 ID `ef27f3c6-349a-44ea-ae09-0cc9dccca691`）均运行 13 条迁移、导入同一份数据和幂等种子；再从远端 Green 筛选导出，与 Blue 导出文件逐表逐行比较原有列，17/17 张表一致，13 项关系审计均为 0，FTS 为 28 行。Green 的 `app_meta.schema_version=14`、环境为 `production`，切换前缓存 revision 10 > Blue 的 1。Worker 版本 `75bc1406-ee91-49fd-a430-d15ad0769d5b` 已部署，DB 绑定为 Green、`DB_SCHEMA_MODE=migration-only`；公开与私密读取的线上烟测结果见执行看板。Blue 未删；原配置、数据库导出及未提交代码差异均另存受限目录供恢复。生产 MCP 临时草稿创建和同版本并发更新已验证，草稿清理后保留审计；后续验收状态以执行看板为准。

**2026-09-29 回退边界更新：** 用户确认生产后台草稿创建、编辑、删除均成功，且切换后又在线上写入内容。只读复查 Green 为 29 篇文章、3 条附件、13 条迁移；Blue 与 2026-09-28 导出均是旧时点数据。保留 Blue 及旧 Worker 只能提供历史参照，不能直接部署旧版本或把 Green 时间旅行到切换前；这些操作会舍弃切换后的文章、令牌和审计等写入。[Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) 是将库恢复到较早时点的能力，并非自动把较新写入合并到旧库。事故中优先修复代码并继续使用当前 Green；确需换库时，先冻结写入、从**当时最新 Green**重新导出和逐表校验，在隔离库验证迁移/兼容性后才切换。未经核对的旧导出、旧 Blue 或旧 Worker 版本均不作为无损回退入口。合成数据的本地端到端演练见下文；生产最新数据的远端恢复与切换尚未演练。

旧提交 `4130970d` 的 `site/db/bootstrap.ts` 还在代码层面排除了“旧 Worker 改绑 Green”的捷径：它只将 schema 12 视为已初始化；面对 Green 的 schema 14 标记，会进入请求期建表/初始化路径，存在把版本标记写回 12 的风险。此判断来自隔离检出的旧源码，**未在生产 Green 上试运行**。可以考虑的代码回退只能是基于现行 schema 14 契约构建、经过隔离验证的兼容修复版本。

**首页 POST 修复前的代码回退基线与执行关口（2026-09-29）：** 当时 Cloudflare 版本元数据确认，`75bc1406-ee91-49fd-a430-d15ad0769d5b` 绑定 Green D1、`APP_ENV=production`、`DB_SCHEMA_MODE=migration-only`，并在当时承接 100% 流量；旧版 `5925a729-c2f9-45ac-8621-9cae0045bd2e` 仍绑定旧 Blue 且无 `DB_SCHEMA_MODE`，不是无损回退候选。当时源码构建在最新 Green 数据的隔离本地恢复库上通过首页、归档、公开 reader、私密 reader 与未登录后台烟测；从部署时的代码快照对照，生产业务源码与当时源码一致（构建生成值除外）。本机 Wrangler 4.130.0 已对 75bc 版本执行 `versions deploy 75bc1406-ee91-49fd-a430-d15ad0769d5b@100% --dry-run --yes`，成功识别该版本；复查部署 ID/时间未变，**那一步没有真的回滚或重新部署**。[Cloudflare Workers 版本部署文档](https://developers.cloudflare.com/workers/wrangler/commands/workers/)支持指定版本与 dry-run；[回滚文档](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)明确代码回滚不会回滚所连接资源中的数据，数据结构变化还可能让旧代码失效。

后续版本若发生**仅代码回归、数据库仍兼容 schema 14**，先只读确认当前版本及候选版本的 D1/R2 绑定、应用环境和 schema 模式，确认最新 Green 的 schema/迁移/关系审计，再用最新数据的隔离副本验证候选代码的关键读写与权限路径。候选版本必须是已上传且经验证的 Green/schema 14 版本；执行 `wrangler versions deploy '<候选版本ID>@100%' --config wrangler.production.jsonc --dry-run --yes` 并复查目标后，才可在事故窗口实际部署该版本，随后核对部署列表及页面、后台、MCP、附件。2026-09-29 首页 POST 修复已将现役版本更新为 `1336a528-25a2-4c46-acda-03833585e0b9`，100% 承流并绑定 Green/schema 14/migration-only；前一版本 `75bc1406-ee91-49fd-a430-d15ad0769d5b` 同样绑定 Green，可作为新版本**仅代码回归**的隔离验证候选，但会恢复已确认的无效首页 Server Action POST 500 行为，不能用它修复该缺陷。若现役版本自身有缺陷，优先构建兼容 schema 14 的前向修复。若新版本已经改变数据库契约，须先重新证明旧版兼容，不能套用本步骤。

若故障涉及 D1 数据或 schema，代码版本切换不是数据库回退。不得直接切旧 Blue、旧导出或执行旧时点 Time Travel 来宣称无损；先冻结全部写入（含浏览量、OAuth 与 MCP）、从当时最新 Green 取得一致导出并核对 R2，再在隔离目标验证 17 表、FTS、关系审计、缓存 revision 与权限，满足条件后才考虑换库。[Cloudflare D1 Time Travel 文档](https://developers.cloudflare.com/d1/reference/time-travel/)明确其 restore 会就地覆盖数据库，当前也不提供直接克隆/分叉到新库的能力。本轮真实数据的本地恢复和 3 个 R2 对象备份见执行看板；这些快照只覆盖导出时点，不能代替未来切换前的新快照。

`admin_login_attempts` 虽然是短期安全状态，也不能不经决定就清空；演练已验证非空行可复制。`app_meta` 包含新库自己的 schema/环境/FTS 标记，不可盲目覆盖：生产只读盘点若发现未识别的键，应先确认语义；Green 的 `schema_version` 与 `app_environment` 只能在数据和结构验证后显式写入。`public_cache_state` 由迁移创建且随导入触发器递增，不直接导入 Blue 行；最终写入冻结后，必须确认 Green 的公开缓存 `revision` **严格大于** Blue 已使用的最新值（或经验证升级缓存键契约版本），防止 Green 复用旧边缘缓存键。合成本地演练中 Blue/Green 起初同为 `5`，把 Green 提升到 `6` 后再写入 schema/环境标记，验证了该顺序；生产值必须在冻结后重新读取，不能写死为 `6`。`_cf_METADATA`、`d1_migrations`、SQLite 内部表、`posts_fts` 与其影子表均不导入。Green 先导入 Blue 的可编辑默认行，后运行 `INSERT OR IGNORE` 种子，避免与已有站点内容冲突。

**本地导入失败恢复演练（Wrangler 4.130.0）：** 在另一个已完成 13 条迁移的隔离 Green 中，第一份 SQL 文件先写两行、再故意写入冲突主键；`d1 execute --local --file` 返回失败后，这两行均不存在。修正该文件并重试，两行成功落库。第二份文件再写新行、随后触发跨文件的主键冲突；失败后，新行不存在，而第一份已成功文件的两行仍在。可观察结论仅是**当前本地 CLI 对失败文件回滚，但整批多个文件并非一个全局事务**。成功文件不是幂等导入，不能盲目重跑。每份文件都要记录来源、校验值、执行结果及导入后的表计数；中断后先盘点 Green 状态。若仅确认某一失败文件已完整回滚，可修正该文件后重试；若完成边界不清或远程行为未验证，应废弃该 Green，保留 Blue 服务，并在新的 Green 上重做已审核的完整导入。不得把本地文件级回滚推定为生产远程 D1 的保证。

**2026-09-29 最新 Green→新 Green 的隔离恢复演练：** 在系统临时目录建两个独立的 schema 14 本地 D1，各应用 13 条编号迁移。源库先运行种子，再写入“切换前”和“切换后”的合成文章、私密空间文章、历史 Slug、附件元数据、浏览记录、MCP 审计、OAuth access/refresh 令牌及登录失败计数。导出前确认源库有 3 篇文章、FTS 3 行，新增文章正文和 version 3 均存在。用 Wrangler 4.130.0 按当前 17 张业务表 `--no-schema` 导出源库，导入已迁移的新库，再运行幂等种子；17/17 张表逐行相等，FTS 3/3，SQLite 完整性均为 `ok`，13 项关系审计全为 0。新库缓存 revision 设为 7，严格大于源库的 6，并在核验后标记 schema 14 / production。用新库启动本地 `migration-only` Worker：首页、归档及新增文章的 reader API 为 200，API 返回最新正文；私密文章匿名页面和 reader API 均为 404。该演练**只使用合成数据和本地 R2 绑定**；附件元数据虽复制成功，未在此演练复制或验证对应 R2 对象。生产换库仍需以当时最新 Green 导出，单独核对 R2，冻结写入并做完整验收，不能把本地成功当作可直接切换线上库的证明。

本轮还发现 Wrangler 4.130.0 的两个实际 CLI 边界：`d1 execute --local --command` 对一串分号分隔的写入返回成功，但在本地只执行了第一条；多语句合成写入改用临时 SQL 文件后逐表核对成功。`d1 export --local` 不接受 `--persist-to`，因此把源库状态复制到临时独立项目的默认 `.wrangler/state`，先查询确认是 3 篇文章才执行筛选导出。这些观察只对应当前安装版本；生产操作必须按每步的实际结果、表计数和校验值放行。

Wrangler 4.130.0 的本地导出文件并未按命令行 `--table` 的顺序排列 `INSERT`（示例中 `posts` 早于 `spaces`）。不能仅凭参数顺序推断导入顺序；每次都要检查生成的 SQL、目标约束和触发器，再执行整批导入及关系审计。

生产执行前仍须：

1. 只读查询生产 `sqlite_master`、表列、索引和触发器，逐项与迁移目标结构比对；明确真实普通业务表清单，排除 `posts_fts`、FTS 影子表、SQLite 内部表和迁移记录等不应复制的对象。`--table` 逐表筛选后导出的 SQL 不代替完整 schema 快照。
2. 以**生产结构和代表性脱敏副本**复跑审核清单与依赖顺序的逐表导出/导入；校验外键、触发器副作用、已有种子数据冲突、行数及内容摘要、公开/私密权限、历史 Slug、OAuth、附件关系、FTS 查询和缓存。上面的合成样本不足以放行生产 Green。
3. 生产导出前安排一致性窗口，并明确站点请求可用性安排；Cloudflare [D1 导入导出文档](https://developers.cloudflare.com/d1/best-practices/import-export-data/)说明正在运行的导出会阻塞该数据库的其他请求。导出期间不允许写入变化造成跨表快照不一致，也不能在正常流量时把逐表导出当成无副作用的只读检查。最终切换前冻结写入并重做完整导出/导入或经过验证的增量同步；重复导入须在全新 Green 副本或有明确去重/回滚语义的流程上演练。FTS 及其他派生数据在 Green 重建并单独核对，R2 对象需另行验证，不包含在 D1 导出内。

这里的 `--table` 路径已在本站本地迁移链和合成数据上得到 CLI 验证，**尚未证明真实生产数据、历史漂移或远程导出可行**；若真实生产 schema 无法安全盘点/导出，停止切换而不是跳过备份。Cloudflare [D1 导入导出文档](https://developers.cloudflare.com/d1/best-practices/import-export-data/)也明确列出虚拟表限制。

安全要求：

```text
数据库导出文件绝对不能提交 Git
绝对不能放进 docs/
绝对不能 push 到远端
```

若当前环境没有 Cloudflare 登录权限：可以**继续做 PR-02 的代码侧 migration reconstruction 工作**，但**禁止执行生产切换**。

### 5.4 验收

```text
空库 + migration history = 可运行完整 XINGYU 的数据库
migration schema 与真实生产 schema 的结构化差异 = 0（或对每一处差异有书面解释）
数据校验（Phase E）全部通过
Worker 切到 v2 后生产 smoke test 通过
```

---

## 6. 结论

1. **P0-2 的严重性得到实测确认，且比初判更高**：真相源是**三处**，`drizzle/` 是最不完整的一份，无法重建可运行的数据库。
2. **不存在"唯一索引缺失"导致的正确性缺口**——唯一性由内联 `UNIQUE` 保障，初次误报已撤回。
3. **PR-02 采用"先对齐、再切换"，但不是"标记基线已应用"**：先补齐 `db/schema.ts` 建模与迁移链，再用 **Blue/Green 新建库**完成切换，不就地升级老库。
4. **真实生产结构盘点和可校验的逐表数据导出是 cutover 的前置条件**；FTS5 使整库 export 不可用。本报告只证明"当前代码想要的运行期 schema"，不能证明真实生产 D1 无历史漂移。

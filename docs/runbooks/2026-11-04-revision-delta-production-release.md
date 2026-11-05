# XINGYU 版本差异存储：schema 28 生产发布与清理

版本历史现在通过 `document_revisions` 保存每一版完整标题和正文，相关正文还被多人共创的三方合并、历史预览与回滚直接读取。因此不得直接 `DELETE FROM document_revisions` 或清空 `content`。

## 存储与行为

- 当前文档的正文依然在 `posts.content`，用于普通阅读、搜索和写作。
- 原有历史的版本号、标题、修改人、来源、时间全部保留。历史正文优先保存经过完整回环验证的**反向差异补丁**（相邻新版本重建旧版本），若补丁没有明显小于旧正文，则保留完整历史快照。
- `document_revisions` 中任意旧版本的读操作都从最近可用的全量锚点读取，逐版本重建并校验。版本缺失、长度不匹配、补丁损坏都会失败关闭，绝不静默返回错误内容。
- **这是无损压缩历史正文，不是删除历史版本。** 对特别小、改动范围太大的内容，留下少量完整快照是正常且必要的。
- 已修改的历史正文内容的原始字符数写入 `original_content_length`，供 UI 的历史列表使用。
- 数据库文件实际缩减量不一定等于正文逻辑字节节省；SQLite 页可能需要存储回收，不能保证 D1 账单立即下降。

## 两阶段上线

### 阶段 1：schema 28 + Worker（不修改旧历史正文）

在 [PR #84](https://github.com/zhangqiang8vipp/xingyu/pull/84) 审查与全部 CI 通过并合并到 main 后，运行 `.github/workflows/release-revision-delta-schema-28.yml`。必须选择 `main` 并填写：

- `confirm = RELEASE-REVISION-28`
- `migrate = D1-REVISION-28`

受保护 `CLOUDFLARE` Environment 通过后，工作流先检查生产实例身份和已应用的 26 条历史 migration，再构建待发布 Worker、确认 D1 Time Travel 书签可用、应用 **唯一新增**的 `0026_revision_delta_storage.sql`（只加三列）、二次校验、将 `app_meta.schema_version` 27→28，最后部署 Worker 并执行匿名 HTTP 冒烟测试。**没有任何历史正文清理操作，`revision_delta_compaction_enabled` 默认不启用。**

由于 Worker 严格要求正确的数据库 schema，新旧版本切换中可能短暂返回 500。选择低流量发布窗口；迁移完成后不可直接回退至旧 schema27 Worker。必要时使用兼容 schema28 的修复 Worker；切勿依赖自动 D1 回滚（会覆盖书签后的业务写入）。

### 阶段 2：只读统计 → 单独批准有界清理

先运行 `.github/workflows/revision-delta-compaction-optin.yml`，选择 `mode=audit`，**仅读取**旧版本数、正文字符和已转换记录数，不输出正文。确认备份和可重建抽样结果后，单独运行：

- `mode = enable`
- `confirm = ENABLE-REVISION-DELTAS`
- `backup_ack = TIME-TRAVEL-IS-TEMPORARY`

**新增加密备份门槛（2026-11-05）**：本流程需先建立一个单独的私有 R2 桶（名称以 `xingyu-private-` 开头），不得绑定公开域名或开启 r2.dev，也**不能复用**现有的 `xingyu-production-media` 媒体桶。确认桶不会自动过期删除后，在 GitHub 受保护环境 `CLOUDFLARE` 中增加变量 `REVISION_BACKUP_BUCKET`（桶名）与 Secret `REVISION_BACKUP_KEY_B64`（`openssl rand -base64 32` 生成的独立 256 位密钥）。**密钥还必须单独保存到密码管理器或离线介质**，不能只保留在 GitHub；私有仓库文件和 Issue 都不能存储密钥。

- 先独立执行 `mode=backup`，此模式会校验生产 D1 身份，完整导出数据库 SQL，使用 AES-256-GCM 加密上传到单独私有 R2 桶，再从 R2 下载、验证认证标签和完整明文 SHA-256 回环。只读 D1；失败关闭、不启用压缩。不上传任何 SQL 或加密文件到公开 GitHub Artifact。
- 此后执行 `mode=enable` 仍会**重新进行同样的全量加密备份及下载验证**，成功后再检查 Cloudflare Time Travel bookmark，最后才启用每日有界压缩。未配置 R2 变量或密钥、R2 不可读写、D1 导出异常、密钥错误、下载损坏时，不允许设置压缩标志。
- 历史压缩不会删除版本行；保留原始内容的 R2 备份是可长期保存的单独副本，但与 D1 同在 Cloudflare 账户中，仍需另建跨账户/供应商的灾难恢复备份，以抵御账户级风险。
- 如需恢复，需要从私有 R2 下载 `revision-history/*.sql.aes256gcm`，用保存的原始 32 字节密钥通过 AES-256-GCM 解密，还原到隔离测试库核验后才考虑生产恢复；绝不能覆盖运行中的库。

工作流重新校验生产实例与 schema28，并确认 Time Travel 书签后才写入启用标记。现有每日 cron 将最多处理 25 条未压缩历史；每次更新都经过版本、全文、快照一致性及补丁回环校验。失败或未完成可安全重新执行，**不删除版本行**。

需要停止：选择 `mode=disable`、`confirm=DISABLE-REVISION-DELTAS`，将标记设为 0，即停止未来批次；已转换的记录仍可正常重建。

## 验收与备份警告

1. 完整 CI、schema28 DB 迁移、多人共创的独立修改自动合并、同一位置冲突、历史预览与旧版本恢复，必须在真实隔离 D1 中测试通过。
2. 生产上线后只读检查 `app_meta` 身份、`document_revisions` 新列及样本历史的可读取性，再启用清理；任何不一致停止。
3. Cloudflare Time Travel 是**有期限**的恢复能力（通常 Workers Paid 30 天、Free 7 天，具体以实际计划为准），不能替代长期加密的离线/私有数据库备份。两个工作流会在操作前把可用于按时间点恢复的 UTC 时间戳记录在 Actions notice，数据库内容和临时 bookmark JSON 不写入公开日志。若要跨恢复保留期仍能灾难恢复，应先建立**不上传到公开 GitHub artifact 或公共 R2**的长期备份方案，再扩大历史清理量。
4. 不应在日志中输出 Markdown 私有正文、OAuth 密钥或完整用户内容。复核摘要或行数即可。
5. 不要直接运行普通 `Deploy production` 去部署 schema28 代码到 schema27 库；旧的 schema27 专项发布入口也不适用于 schema28。

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

先运行 `.github/workflows/revision-delta-compaction-optin.yml`，选择 `mode=audit`，**仅读取**旧版本数、正文字符和已转换记录数，不输出正文。确认可重建抽样结果，并接受 Time Travel 有时限、没有独立备份的风险后，单独运行：

- `mode = enable`
- `confirm = ENABLE-REVISION-DELTAS`
- `backup_ack = TIME-TRAVEL-IS-TEMPORARY`

**2026-11-06：按站点所有者明确授权，生产差异压缩可仅依赖 D1 Time Travel，不要求新建 R2 桶。**

- `mode=enable` 仍需在 `main` 的受保护 `CLOUDFLARE` Environment 中运行，填写 `confirm=ENABLE-REVISION-DELTAS`、`backup_ack=TIME-TRAVEL-IS-TEMPORARY`，检查生产 D1 身份、schema28、站点健康，并**取得 Time Travel 书签**后才能写入开关。
- 此选择**不创建独立备份**，D1 Time Travel 只能在 Cloudflare 实际提供的有限保留窗口内使用。超过期限、遇到账户级故障或恢复点不可用，可能再也无法取得旧版本原始完整快照；用户已明确要求先执行精简方案。
- `mode=backup` 仍为**可选**。今后需要独立备份时，可单独创建未开放公网访问的 `xingyu-private-*` R2 桶，并在 GitHub `CLOUDFLARE` Environment 设置 `REVISION_BACKUP_BUCKET` 和 `REVISION_BACKUP_KEY_B64`，执行完整导出、AES-256-GCM 加密、R2 上传下载及回环校验。
- 无论是否启用可选备份，都不会删除历史版本行；老版本正文存储只有经过相邻差异往返与重建校验才会从全量快照转换为差异。每日 cron 最多处理 25 条候选。
- 若发现任何旧版预览、恢复或共创合并异常，应立即运行 `mode=disable`，先停止后续压缩并核查 D1；**不要直接回滚整库**，否则会丢失恢复点之后的新文章和编辑。

工作流重新校验生产实例与 schema28，并确认 Time Travel 书签后才写入启用标记。现有每日 cron 将最多处理 25 条未压缩历史；每次更新都经过版本、全文、快照一致性及补丁回环校验。失败或未完成可安全重新执行，**不删除版本行**。

需要停止：选择 `mode=disable`、`confirm=DISABLE-REVISION-DELTAS`，将标记设为 0，即停止未来批次；已转换的记录仍可正常重建。

## 验收与备份警告

1. 完整 CI、schema28 DB 迁移、多人共创的独立修改自动合并、同一位置冲突、历史预览与旧版本恢复，必须在真实隔离 D1 中测试通过。
2. 生产上线后只读检查 `app_meta` 身份、`document_revisions` 新列及样本历史的可读取性，再启用清理；任何不一致停止。
3. Cloudflare Time Travel 是**有期限**的恢复能力（通常 Workers Paid 30 天、Free 7 天，具体以实际计划为准），不能替代长期加密的离线/私有数据库备份。启用工作流必须在操作前取得 Time Travel bookmark，并将恢复时间戳记录在 Actions notice，数据库内容和临时 bookmark JSON 不写入公开日志。如果未来扩大清理范围或需要跨保留期恢复，建议单独建立私有长期备份。
4. 不应在日志中输出 Markdown 私有正文、OAuth 密钥或完整用户内容。复核摘要或行数即可。
5. 不要直接运行普通 `Deploy production` 去部署 schema28 代码到 schema27 库；旧的 schema27 专项发布入口也不适用于 schema28。

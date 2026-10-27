# XINGYU · 全站 P0 审计与产品优先级看板

**日期**：2026-10-27  
**审计快照**：`main` [`a1cf5eb738bc`](https://github.com/zhangqiang8vipp/xingyu/commit/a1cf5eb738bc01553137ca673939a158b1b13f78)  
**覆盖范围**：公开站点、注册/登录、个人知识、AI/MCP、团队/组织、性能、运维安全、增长。  
**状态**：已完成当前代码/发布记录的全局只读审计，待执行修复与真实用户验收；**不等于 P0 已交付**。

> 产品原则：不要围着最近一次共创需求反复开发。先明确用户为何来到 XINGYU、如何第一次成功使用、为何会再次回来；技术与组织能力为这条路径服务。

## A. 已核验的事实与尚未核验的事项

1. **发布可靠性：已有通过证据**。基线附近的 [20 项完整 CI](https://github.com/zhangqiang8vipp/xingyu/actions/runs/40483860205) 及 [Cloudflare 生产发布](https://github.com/zhangqiang8vipp/xingyu/actions/runs/40484546020) 均成功（发布 SHA `b38bfd3ac5c39526c4d48fad60abb14ea32c9d8a`）。此后 `main` 新增了 MCP 图标兼容提交，本次不等于对其重新部署。
2. **已确认的导航落差**。[账号侧栏](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/features/admin/AdminSidebar.tsx#L50-L55) 中“知识空间”与“组织与团队”链接分别是 `/workspace` 和 `/organizations`；但 [前者](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/app/workspace/page.tsx) 与 [后者](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/app/organizations/page.tsx) 都重定向到 `/admin`。其中旧 `WorkspaceClient` 仍存在于代码，并不代表线上有第二套正在运行的编辑器；问题是**入口与用户期待不一致**。
3. **产品入口偏内容阅读**。[公开首页主 CTA](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/features/home/BlogHomeExperience.tsx#L112-L120) 为“开始阅读”，[主导航](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/features/navigation/nav/nav-destinations.ts) 是首页/文章/问答/接入/关于；个人知识产品没有同等清晰的起始路径。是否添加产品入口要与“博客 + 知识产品”定位一并设计，不能强行把原博客改成营销页。
4. **部分基础能力齐备**。[AI 首次价值阶段](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/domain/admin/activation.ts) 已识别“知识→连接→真实私有写入”；[AI 后台](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/features/admin/AdminIntegrationsPanel.tsx) 已展示阶段及证据；[站点健康审计](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/db/health.ts) 与 [定时任务异常日志](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/worker/index.ts#L199-L257) 也存在。后续首先复用。
5. **历史性能证据不可冒充当下**。[2026-09-02 的旧实验室结果](https://github.com/zhangqiang8vipp/xingyu/blob/main/docs/plans/2026-09-02-performance-optimization.md) 中移动首页 LCP 3.463 秒、归档 3.305 秒、富文章 3.993 秒。此后已发生优化，**不代表 2026-10-27 当前生产速度**。
6. **数据恢复有时点证据，不代表持续受保护**。[9 月底迁移与恢复记录](https://github.com/zhangqiang8vipp/xingyu/blob/main/docs/plans/2026-09-11-issue-inventory-and-prioritization.md) 有 D1 与 R2 备份/校验，但必须重新证明当前生产数据的最近备份与恢复。
7. **本轮访问限制**：审计环境不能访问线上域名的实时 HTML、Web Vitals 和用户行为统计；当前生产注册是否开放、邮件投递、Cloudflare 告警配置、用户留存率与当前 API P95 **均待核验**。不能写成“通过”或虚构指标。
8. **看板存放方式**：GitHub Issues 功能被仓库禁用（创建返回 HTTP 410）；因此直接把这份行动看板保存在 `docs/plans`，不增设临时功能分支。

## B. 产品结构判断

| 层级 | 存在的能力 | 应承担的产品角色 |
| --- | --- | --- |
| 公开内容 | 博客首页、归档、阅读、公开问答 | 发现、信任和搜索入口 |
| 个人知识 | 私有空间、文档、附件、导入与版本 | 核心个人资产，首次使用需非常顺畅 |
| AI / MCP | OAuth/PAT、受控读写、知识问答、写入审计 | XINGYU 的差异化：知识真正能被 AI 使用 |
| 团队与组织 | 邀请、空间权限、共创、组织授权 API | 使用需求成熟后扩大；不应阻碍个人用户 |
| 平台底座 | Workers、D1/R2、CI、Cron、诊断 | 稳定、安全、可观测、可恢复 |

**建议的统一价值主张**：让个人和团队的知识，成为 AI 可以安全读取、协作更新、长期沉淀的资产。

## C. 按优先级排序的行动看板

| 编号 | 等级 | 项目 | 证据性质 | 状态 | 通过标准 |
| --- | --- | --- | --- | --- | --- |
| 01 | **P0** | 账号导航和旧路由语义 | 确认的源码问题 | ☐ 待执行 | 入口与文案一致、无误导回跳 |
| 02 | **P0** | 注册→私有知识→AI 首次价值 | 完整生产路径待测 | ☐ 待执行 | 5 名独立测试者可走通并有耗时记录 |
| 03 | **P0** | 当前生产速度与错误率基线 | 历史瓶颈，当前未知 | ☐ 待执行 | 7 日可追溯分设备/地域指标及告警 |
| 04 | **P0** | 当前 D1/R2 备份、隔离恢复和健康告警 | 时点历史，当前待验证 | ☐ 待执行 | 最近备份、恢复、RTO/RPO、告警证据 |
| 05 | **P0** | 激活漏斗、留存与隐私指标 | 有基础激活代码，缺产品漏斗 | ☐ 待执行 | 连续 2 周样本与漏斗趋势 |
| 06 | P1 | AI 问答和 MCP 的任务质量 | 代码已有防护，缺整体评测 | ☐ 待执行 | 30–50 个实际/合成任务报告 |
| 07 | P1 | 公开内容发现、分享、增长 | 缺真实流量与转化证据 | ☐ 待执行 | 一处改善有前后数据 |
| 08 | P1 | 无效入口与遗留模块去重 | 存在兼容路由/历史实现 | ☐ 待执行 | 仅删无引用代码，测试/回滚完备 |
| 09 | P2 | 企业级计费、Agent 市场、架构大改、全站重设计 | 无当前需求证明 | ☐ 暂缓 | 有用户证据及成本收益再决定 |

### P0-01 · 导航与功能边界（最先动手）

- [ ] 对照 `/`、`/login`、`/register`、`/admin`、`/ai-connections`、`/workspace`、`/organizations`、邀请链接，输出用户角色×入口×目标页面清单。
- [ ] “知识空间”应直接进入现有知识管理入口，例如 `/admin?section=spaces`；“组织与团队”若当前 UI 不公开，避免显示点击后只回到后台的伪入口。**保留兼容 URL、组织权限 API/MCP**。
- [ ] 用普通账号/站点管理员/未登录访客，在桌面/手机验证登录返回、导航和邀请。
- [ ] 不擅自把已退休的 `WorkspaceClient` 当成线上活跃界面，不在本次导航修复中改数据库。

**验收**：所有可见导航都有实际可用目标；无无提示回跳；不影响现有公开文章、OAuth/MCP 和权限。

### P0-02 · 第一次使用的完整成功路径

- [ ] 核实 [注册开关 `REGISTRATION_ENABLED` 和邮件配置](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/server/auth/identity-email.ts#L11-L25) 在生产是否真的启用；通过授权的测试邮箱验证送达、时效和错误提示。
- [ ] 新用户从公开站点 → 注册/验证 → 登录 → 新建或导入私有文档 → 连接 AI → AI 受控创建/更新 → 看懂历史/审计 → 撤销连接。
- [ ] 使用现有 [激活阶段](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/domain/admin/activation.ts)，改已有入口/引导，不制造第二套工作台。
- [ ] 保留公开博客“开始阅读”路径；若决定让首页承担获客，再补明确、克制的产品次要 CTA。

**验收**：5 名内部或受邀新用户无需开发者口头帮助完成真实任务；每个失败节点都有错误与下一步指引，记录成功率及耗时，且不把 Token、验证链接、私有文章写入日志。

### P0-03 · 性能、错误监控、线上体验

- [ ] 对首页、归档、文章、Ask、Connect、注册登录、后台知识空间，分别在桌面/移动、冷/热缓存、主要地区采集样本。
- [ ] 独立记录 TTFB（分网络/Worker/D1）、LCP、CLS、INP、前端 JS/CSS、API P95 和 HTTP 5xx；**GitHub CI 的时长不是用户速度**。
- [ ] 复用 [浏览器性能脚本](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/scripts/browser-vitals.mjs)，必要时加入隐私友好聚合监控；不能追踪私有正文、提示词、邮箱或凭据。
- [ ] 测试异常告警实际到达、可复现，确认维护责任；只有具体瓶颈证据足够时才创建性能修复 PR。

**验收**：当前生产的 7 天基线可复查；方向性目标 p75 LCP≤2.5s、INP≤200ms、CLS≤0.1；无法满足时说明样本量、测量条件、原因及后续方案。

### P0-04 · 当前数据能否真正恢复

- [ ] 获取当前生产 D1/R2 的最近备份时间、范围、保留周期、加密保护、恢复权限；不能把 9 月时点的 D1/R2 校验当成现在的数据保障。
- [ ] 在**隔离**环境恢复 D1 与 R2，验证文档、附件、空间路径、数据库关系和身份标记；不覆盖现役生产资源。
- [ ] 检查 Cloudflare 部署审批、Secret 范围、Cron 异常到实际告警的接收/响应流程。
- [ ] 明确代码回滚与数据恢复的不同限制；生产数据动作需单独授权。

**验收**：有最近可核验的备份、隔离恢复日志、RTO/RPO 目标与实测、至少一次告警投递成功的证据。

### P0-05 · 知道用户在哪里失去兴趣

- [ ] 复用已存在的知识写入、MCP 审计与激活状态；定义访客→注册→验证→私有知识→首次 AI 写入→第 7 日回访的分母分子。
- [ ] 区分普通、受邀、管理员角色；事件去重、避免跨账号计数。
- [ ] 聚合/最小化数据，不收集提示词、文章正文、邮箱明文、密钥和分享 Token；建立保留期和访问权限。
- [ ] 一周一次根据实际数据改善一个漏斗瓶颈，不靠猜测放大功能。

**验收**：连续两周能看到有效样本量、阶段转化和留存趋势；样本不足须标明“不可判断”，不编造增长百分比。

## D. 后续 P1（P0 之后）

- **AI 任务质量**：为 [Ask 来源检索与降级](https://github.com/zhangqiang8vipp/xingyu/blob/main/site/app/api/ask/route.ts) 及 MCP 建 30–50 题授权/合成评测：准确性、来源引用、授权范围、写入冲突、超时与降级。
- **公开内容增长**：关注从阅读/搜索/公开问答到有意注册、私有内容复用的路径，不把私有内容开放给搜索引擎。
- **界面减负**：旧组件与兼容路由需先做引用检索和场景回归；不为减少行数而改变功能或权限。
- **暂缓**：大量组织/企业功能、计费、Agent 市场和大规模视觉重构，没有实测需求不展开。

## E. 30 天先后顺序（不是保证的交付时间）

| 阶段 | 主任务 | 出口条件 |
| --- | --- | --- |
| 第 1–7 天 | 导航与入口语义、注册冒烟、当前生产基线 | 问题已验证、缺失指标清楚、最小代码修复有回归 |
| 第 8–14 天 | 首次价值链路、当前备份与隔离恢复、告警验证 | 5 人完整走通、可恢复数据与告警证据完备 |
| 第 15–30 天 | 两周漏斗样本、AI 问答/MCP 质量评测启动 | 后续投入按用户价值/故障数据排序 |

## F. 审查与发布规则

每个实施 PR 都应回答：影响哪条真实用户路径、为何优先、当前数据是什么、完成后如何测量、权限/数据风险是什么、测试和回滚怎样做。不能把一个模糊目标拆成十个外观相近的 Demo；也不应把性能、身份、数据库、设计与增长一起改成无法归因的巨型 PR。**源码与 CI 通过，不等于真实线上体验、数据恢复和产品增长均通过。**

**当前审计结论**：XINGYU 的能力覆盖已经较广；下一阶段优先补足入口一致性、第一次使用成功、真实可观测性和恢复保障。共创只是其中一个模块，不再主导全局排期。

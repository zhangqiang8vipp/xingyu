# 星屿 AI 文档组件：MCP 使用指南（v1）

> 适用版本：包含 `feature/ai-document-blocks-v1` 的部署版本。旧的线上 MCP 和旧页面不一定支持本指南；请在部署验证后再用于真实知识。
>
> **核心规则：** 星屿的网站外观不变，普通 Markdown 继续照常显示。只有明确的 `xingyu-block` 围栏代码块经过严格数据校验，才会在阅读页、弹窗与共享 Markdown 预览中变成卡片。

## 最快开始：你可以直接这样告诉 AI

- **测验：**「将下面五道 Java 泛型题的批改结果保存到星屿知识空间 `我的学习 / Java`，题目结果用 `quiz_result` 卡片展示，并保留每题原始解析。先确认空间，创建草稿，不要公开发布。」
- **统计：**「整理我提供的本周学习数据，用 `metric_grid` 显示实际数字，文字分析仍用普通 Markdown。没有来源的数字不要编。」
- **进度：**「把以下任务的已完成、进行中、待开始、受阻状态整理为 `status_list`；缺少状态时先问我。」
- **时间线：**「按我给出的事件顺序做一个 `timeline`，时间标签原样保留，其他说明使用 Markdown。」

AI 通过已有 `create_draft` / `update_post` 工具写入 `content_markdown`。**没有新增独立的 MCP 工具，也不需要新建数据库表。**

## 标准流程（知识空间）

1. 使用 `list_spaces` 核对知识空间路径和权限范围，必要时通过 `list_categories` 确认分类。
2. 让 AI 先展示将要保存的内容或摘要；保留原始段落、原始数据来源、图片及附件，不进行未经确认的覆盖。
3. 调用 `create_draft`，传入 `title`、`content_markdown`、`space`（完整空间路径）及 `change_summary`。**指定 `space` 才是私有知识写入；未指定会变成普通博客草稿。**
4. 以后修改已有文章：先 `search_posts` 定位，`get_post(view=content)` 读取**完整正文和 version**，获得用户确认，再通过 `update_post(identifier, expected_version, content_markdown, change_summary)` 保存。**更新整篇 Markdown 时不要丢弃原来的其他内容。**
5. 在网站的 Knowledge Space 阅读页或管理阅读窗口里检查展示结果。普通博客草稿不会因为包含组件而自动发布，**`publish_post` 仍需独立的明确批准**。

### 手动编辑也可以

不使用 MCP 时，在星屿现有 Markdown 写作编辑器里直接粘贴下面的代码块，保存后通过阅读预览查看；代码编辑模式仍保留原始 JSON，方便以后修改。

## 支持的四种内容格式

每个块都是一个 **JSON 对象**，保留外层 Markdown 围栏代码语言名 `xingyu-block`。`version` 固定为数字 `1`。标题 `title` 可选。

### 1. 批改结果（`quiz_result`）

```xingyu-block
{
  "version": 1,
  "type": "quiz_result",
  "title": "Java 泛型小测",
  "items": [
    {"title": "泛型作用", "status": "partial", "explanation": "回答了用途，还需说明编译期类型检查。"},
    {"title": "编译期检查", "status": "correct"},
    {"title": "原始 List", "status": "incorrect", "explanation": "原始类型会丢失部分泛型检查。"},
    {"title": "泛型 T", "status": "correct"},
    {"title": "泛型与继承", "status": "partial"}
  ]
}
```

状态：`correct` 正确、`partial` 部分正确、`incorrect` 需要纠正。卡片显示「2 正确 / 2 部分正确 / 1 需要纠正」，数字由每个 `item.status` **自动计算**。每题 `explanation` 可选，可展开查看。

### 2. 指标统计（`metric_grid`）

```xingyu-block
{
  "version": 1,
  "type": "metric_grid",
  "title": "本周学习摘要",
  "items": [
    {"label": "学习时长", "value": "12.5 小时", "note": "来源：手动记录"},
    {"label": "完成练习", "value": "8 题"},
    {"label": "复习章节", "value": "3 章"}
  ]
}
```

`value` 是保留用户提供格式的**字符串**，不是系统实时计算或联网抓取的数据；`note` 可选。

### 3. 任务进度（`status_list`）

```xingyu-block
{
  "version": 1,
  "type": "status_list",
  "title": "知识整理计划",
  "items": [
    {"title": "整理学习资料", "status": "done"},
    {"title": "核对笔记内容", "status": "active", "detail": "正在补充示例"},
    {"title": "形成最终复习提纲", "status": "pending"},
    {"title": "等待老师反馈", "status": "blocked"}
  ]
}
```

状态：`done` 已完成、`active` 进行中、`pending` 待开始、`blocked` 受阻。`detail` 可选。

### 4. 时间线（`timeline`）

```xingyu-block
{
  "version": 1,
  "type": "timeline",
  "title": "项目开发记录",
  "items": [
    {"label": "第一阶段", "title": "确定产品方向"},
    {"label": "第二阶段", "title": "实现结构化组件", "detail": "沿用现有 Markdown 数据结构"},
    {"label": "第三阶段", "title": "独立测试与视觉验收"}
  ]
}
```

顺序保持原样，`label` 可以是日期、阶段名称或相对时间，不会擅自转为日历日期。

## 安全和边界

- 一律不凭空创造分数、金额、任务完成状态或事件日期；如果来源不足，先使用普通 Markdown 或向用户确认。
- 单个块最多 16,384 个字符；测验最多 60 题、指标最多 12 项、状态最多 40 项、时间线最多 30 项。多余或不符合格式的输入会**退回显示为原始代码块**，不会执行代码。
- 块中不支持自定义 HTML/JavaScript、任意网络请求或自定义 CSS；不会改变私有知识空间的访问权限。
- 已发布的**公开博客**调用 `update_post` 会立即改变公网文章；先预览并获得明确批准。
- 这是一个**显式结构化数据**功能；还不是读取任意旧 Markdown、自动理解并改写为卡片的「AI 自动文档编排器」。

## 部署与验收

只有 PR #9 的变更通过全部 CI 且合并至待部署分支后，才能让服务器提供新的 MCP 说明和文档组件。完整验收包括：原生 `npm run ci`、公开博客阅读、Knowledge Space 私有阅读、弹窗阅读、暗色模式、移动端、编辑器预览、异常 JSON 回退，以及部署后的 MCP 重新连接/刷新工具元数据。

如需生产部署，始终使用仓库约定的 `cd site && npm run deploy:production`（该命令先 build 再执行 Wrangler）；**不要直接 wrangler deploy 旧的 dist**。部署前先执行 `npm ci && npm run ci`，失败则不部署。

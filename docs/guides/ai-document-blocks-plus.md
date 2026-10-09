# 星屿 AI 文档组件 Plus — 新增 5 种（独立候选 PR）

> 这是已有 AI Blocks v1（4 种）的**后续增强**。当前正式部署批次 #7 / #10 / #9 不依赖本功能；此分支不是生产版。
>
> **星屿原有 Web 风格保持不变。** 普通 Markdown 用于叙述；仅当来源清晰且数据确实适合结构化时，才使用 `xingyu-block` 围栏 JSON。原始 Markdown 可继续编辑、保存和回退。

## 快速使用（MCP 或普通 Markdown 编辑器）

在已更新的 MCP 连接中，你可以说：

> 「帮我将这篇技术选型笔记保存为星屿知识空间的草稿。把技术差异整理为知识对比卡，把关键问题整理为闪卡；只使用我提供的数值制作图表，有操作流程时使用分步教程，最后列出我确认过的 HTTPS 参考链接。普通说明保持 Markdown。保存前让我审阅，不要发布。」

MCP 仍然使用现有 `create_draft` / `update_post` 工具，往 `content_markdown` 写入原样的 JSON 代码围栏；**不新增 MCP 工具，不在阅读时调用 AI**。旧版本 MCP 工具说明和线上阅读器暂时不识别这些新增类型。

## 01 · 技术对比卡 `comparison`

用于 2–3 个技术方案的横向比较（最多 12 行）。移动端可横向滚动。

```xingyu-block
{
  "version": 1,
  "type": "comparison",
  "title": "ArrayList 和 LinkedList",
  "columns": [
    {"name": "ArrayList", "note": "动态数组"},
    {"name": "LinkedList", "note": "双向链表"}
  ],
  "rows": [
    {"label": "随机访问", "values": ["通常较快", "通常较慢"]},
    {"label": "存储开销", "values": ["连续引用存储", "节点有额外指针开销"]},
    {"label": "中间插入", "values": ["可能需要移动元素", "定位到节点后修改链接"]}
  ],
  "takeaway": "一般列表场景通常先评估 ArrayList。"
}
```

## 02 · 记忆闪卡 `flashcards`

1–30 张，通过点击「查看答案」揭示内容，可用键盘操作，上下张切换会自动收起答案。它是浏览器本地的临时交互，不收集用户作答。

```xingyu-block
{
  "version": 1,
  "type": "flashcards",
  "title": "Java 泛型复习",
  "items": [
    {"question": "泛型的主要作用是什么？", "answer": "在编译期增强类型检查，降低不安全类型转换风险。"},
    {"question": "什么是类型擦除？", "answer": "编译器会擦除大部分泛型参数信息。", "hint": "关注编译阶段。"}
  ]
}
```

## 03 · 数据图表 `chart`

采用轻量 SVG，不引入额外图表依赖。支持 `bar` 柱状图、`line` 折线图、`pie` 饼图。图表下提供可展开的原始数据表。

```xingyu-block
{
  "version": 1,
  "type": "chart",
  "title": "示例：学习时长",
  "kind": "bar",
  "unit": "小时",
  "items": [
    {"label": "周一", "value": 1.5},
    {"label": "周二", "value": 2},
    {"label": "周三", "value": 2.5}
  ]
}
```

`value` 必须为明确来源的非负有限数字（不是带单位的字符串），范围 0～1,000,000,000；柱状/折线最多 12 项，饼图最多 8 项。饼图总和不能为零。不同项目名称不得重复。没有足够的数值时使用普通表格或 Markdown，不应编造图表。

## 04 · 分步教程 `steps`

用于逐步操作、配置流程。可提供代码片段，但片段始终作为**文本**展示，永远不会在阅读器中执行。

```xingyu-block
{
  "version": 1,
  "type": "steps",
  "title": "本地检查",
  "items": [
    {"title": "查看 Node 版本", "description": "先确认运行环境。", "command": "node --version"},
    {"title": "安装依赖", "description": "在项目 site 目录内安装锁定的依赖。", "command": "npm ci"},
    {"title": "执行项目检查", "description": "检查输出并修复失败项。", "command": "npm run ci"}
  ]
}
```

每组最多 15 步，文本与命令有长度限制。执行命令前须自行确认可信来源、当前路径与运行权限。

## 05 · 来源证据卡 `sources`

集中列出作者提供的可核查资料，最多 15 条。安全起见，链接只支持 HTTPS，禁止凭据、`javascript:`、`data:`、`file:`、不安全 URL 或未经授权的私有附件直链。**来源卡不会自动验证内容真实性**，因此界面会明确标注「未经自动核验」。

```xingyu-block
{
  "version": 1,
  "type": "sources",
  "title": "Java 技术参考",
  "items": [
    {"label": "Oracle Java 官方文档", "url": "https://docs.oracle.com/en/java/", "note": "查看 Java 基础资料。"},
    {"label": "OpenJDK 官方网站", "url": "https://openjdk.org/", "note": "查看开放 JDK 项目信息。"}
  ]
}
```

来源链接只在用户**主动点击**后打开，使用新的浏览器标签和 `noopener noreferrer`，不自动抓取网页，不自动上传私有知识。用户需要能自行核对外部站点。

## 必须保持的边界

- 同一篇文章可以混用任意数量的普通 Markdown 段落、已有 Mermaid/KaTeX/附件和不同的 `xingyu-block` 组件。
- 单块 JSON 最多 16,384 字符；超限、缺字段、字段多余、未知类型或格式错误，保留原始代码块而不是执行内容。
- 闪卡状态只保存在页面内存里，不上传回答、不写入数据库；图表无第三方 JS 依赖，渲染器不会联网取数据。
- Knowledge Space 的私有 ACL、实例身份、草稿/发布权限、正文版本控制完全沿用当前系统。对旧文章修改前先 `get_post(view=content)`，带 `expected_version` 更新整篇正文；不得意外覆盖或公开。
- 不自动把所有文字变成组件；内容来源不足时维持正常 Markdown。

## 集成与验收

此分支基于 PR #9 的 `feature/ai-document-blocks-v1`。请**先发布当前已审查的 #7/#10/#9 批次**，把本次新组件视作下一批候选功能。待 PR #9 合并后将本分支以主分支最新代码为基础进行重新集成，并运行 `cd site && npm ci && npm run ci`，覆盖亮暗模式、手机、桌面、阅读弹窗、后台预览、私有 Knowledge Space、链接安全与撤销/回退，再决定是否合并部署。

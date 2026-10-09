# XINGYU 语法与写作示例

> 这不是一份枯燥的语法清单。它是一块写作试验场：把光、结构、公式与思考都放进去，再选择真正属于文章的部分。✨

![星屿的光](/images/xingyu-past-present-future.webp)

---

## 0. 写作前的小约定

你不必一次使用所有能力。**Markdown 的价值是让内容有结构，而不是让页面变复杂。**

- 适合强调的地方，用 `**粗体**`
- 适合停一下的地方，用引用或提示块
- 适合推演的地方，用公式、表格或图
- 适合延展的地方，放进折叠块

:::tip[一个很轻的建议]
先写完整，再整理结构。工具应该跟着想法走，而不是让想法排队等待工具。
:::

## 1. 标题、文字与链接

# 一级标题

## 二级标题

### 三级标题

这是普通段落。这里有 **重要文字**、*轻微强调*、~~已经删去的念头~~、`inline code`，还有 <mark>一小块高亮</mark>。

你可以用 [星屿首页](/) 链回文章入口；也可以按 <kbd>Ctrl</kbd> + <kbd>K</kbd> 快速搜索。

> “真正的留白，不是什么都不放，而是只让必要的事出现。”
> 
> — 写给未来的自己

:::note[旁注]
如果某句话并不推动文章，就把它删掉。克制会让真正重要的句子更亮。
:::

:::warning[注意]
不要把密码、令牌或私人数据写进公开文章。即使只有自己维护，也可能在未来被截图、分享或导出。
:::

:::quote[摘录]
写作不是保存每一个瞬间，而是替瞬间找到一个以后还能辨认的位置。
:::

## 2. 清单与任务

- [x] 有一个值得写下来的问题
- [x] 给它一个清晰的标题
- [ ] 删除不必要的句子
  - [ ] 检查链接
  - [ ] 检查图片说明
- [ ] 发布前再读一遍

1. 先观察
2. 再记录
3. 最后编辑

## 3. 表格与对齐

| 场景 | 更合适的表达 | 原因 |
| :-- | :--: | --: |
| 一段心情 | 引用 | 让节奏慢下来 |
| 一组比较 | 表格 | 让差异看得更清楚 |
| 一条流程 | Mermaid | 让关系可以被扫读 |
| 一个推导 | 公式 | 让逻辑不靠猜 |
| 一段补充 | 折叠块 | 不打断主线 |

## 4. 数学公式

行内公式：当专注被不断切碎时，可以把可用时间近似看成 $T_{usable}=T_{total}-T_{switching}$。

块级公式：

$$
\text{清晰度} = \frac{\text{真正完成的事}}{\text{同时打开的事}}
$$

公式不必为了“显得专业”而存在。只有当文字开始含糊，才让它上场。

## 5. 代码块

```ts
type Thought = {
  question: string;
  nextStep: string;
};

const keepWriting = ({ question, nextStep }: Thought) => {
  return `先回答：${question}\n再去做：${nextStep}`;
};
```

```bash
# 把今天的一点想法放进草稿
git status
```

## 6. Mermaid 图表

```mermaid
flowchart LR
  A[一闪而过的念头] --> B{值得继续吗？}
  B -->|是| C[写成草稿]
  B -->|暂时不是| D[留下一行备注]
  C --> E[整理结构]
  E --> F[发布或继续等待]
```

## 7. 折叠的补充内容

:::details[展开：一份简短的发布检查单]

- 标题有没有准确表达文章真正想说的事？
- 摘要能否在三秒内说明“为什么值得读”？
- 图片是否有替代文字？
- 链接是否能打开？
- 最后一段有没有留下一个仍想继续的问题？
  :::

也支持原生写法：

<details>
  <summary>展开：这是一段受控 HTML</summary>
  <p>可以使用 <code>details</code>、<code>summary</code>、<code>figure</code>、<code>mark</code>、<code>kbd</code> 等安全排版标签。</p>
</details>

<figure>
  <img src="/images/xingyu-past-present-future.webp" alt="星屿主题的未来感插画" loading="lazy" />
  <figcaption>图：留给未来的光。</figcaption>
</figure>


## 8. XINGYU 智能文档组件

普通叙述继续使用 Markdown；下面九类组件适合把结构清晰的内容整理成卡片。每节先展示效果，再提供可复制的完整写法。

**以下题目、数字、状态和阶段均为演示数据，不代表本站运营统计或真实学习记录。** 实际写作只使用有来源的事实。

语言名写成 `xingyu-block`，JSON 的 `version` 固定为数字 `1`。不需要填写 HTML、CSS 或脚本。

### 8.1 测验反馈 · `quiz_result`

```xingyu-block
{
  "version": 1,
  "type": "quiz_result",
  "title": "示例：Java 泛型小测",
  "items": [
    {
      "title": "泛型作用",
      "status": "partial",
      "explanation": "回答了用途，还需说明编译期类型检查。"
    },
    {
      "title": "编译期检查",
      "status": "correct"
    },
    {
      "title": "原始 List",
      "status": "incorrect",
      "explanation": "原始类型会丢失部分泛型检查。"
    },
    {
      "title": "泛型 T",
      "status": "correct"
    },
    {
      "title": "泛型与继承",
      "status": "partial"
    }
  ]
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "quiz_result",
  "title": "示例：Java 泛型小测",
  "items": [
    {
      "title": "泛型作用",
      "status": "partial",
      "explanation": "回答了用途，还需说明编译期类型检查。"
    },
    {
      "title": "编译期检查",
      "status": "correct"
    },
    {
      "title": "原始 List",
      "status": "incorrect",
      "explanation": "原始类型会丢失部分泛型检查。"
    },
    {
      "title": "泛型 T",
      "status": "correct"
    },
    {
      "title": "泛型与继承",
      "status": "partial"
    }
  ]
}
```
````

:::

### 8.2 统计指标 · `metric_grid`

```xingyu-block
{
  "version": 1,
  "type": "metric_grid",
  "title": "示例：本周学习摘要",
  "items": [
    {
      "label": "学习时长",
      "value": "12.5 小时",
      "note": "来源：手动记录"
    },
    {
      "label": "完成练习",
      "value": "8 题"
    },
    {
      "label": "复习章节",
      "value": "3 章"
    }
  ]
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "metric_grid",
  "title": "示例：本周学习摘要",
  "items": [
    {
      "label": "学习时长",
      "value": "12.5 小时",
      "note": "来源：手动记录"
    },
    {
      "label": "完成练习",
      "value": "8 题"
    },
    {
      "label": "复习章节",
      "value": "3 章"
    }
  ]
}
```
````

:::

### 8.3 进度清单 · `status_list`

```xingyu-block
{
  "version": 1,
  "type": "status_list",
  "title": "示例：知识整理计划",
  "items": [
    {
      "title": "整理学习资料",
      "status": "done"
    },
    {
      "title": "核对笔记内容",
      "status": "active",
      "detail": "正在补充示例"
    },
    {
      "title": "形成最终复习提纲",
      "status": "pending"
    },
    {
      "title": "等待老师反馈",
      "status": "blocked"
    }
  ]
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "status_list",
  "title": "示例：知识整理计划",
  "items": [
    {
      "title": "整理学习资料",
      "status": "done"
    },
    {
      "title": "核对笔记内容",
      "status": "active",
      "detail": "正在补充示例"
    },
    {
      "title": "形成最终复习提纲",
      "status": "pending"
    },
    {
      "title": "等待老师反馈",
      "status": "blocked"
    }
  ]
}
```
````

:::

### 8.4 时间线 · `timeline`

```xingyu-block
{
  "version": 1,
  "type": "timeline",
  "title": "示例：项目开发记录",
  "items": [
    {
      "label": "第一阶段",
      "title": "确定产品方向"
    },
    {
      "label": "第二阶段",
      "title": "实现结构化组件",
      "detail": "沿用现有 Markdown 数据结构"
    },
    {
      "label": "第三阶段",
      "title": "独立测试与视觉验收"
    }
  ]
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "timeline",
  "title": "示例：项目开发记录",
  "items": [
    {
      "label": "第一阶段",
      "title": "确定产品方向"
    },
    {
      "label": "第二阶段",
      "title": "实现结构化组件",
      "detail": "沿用现有 Markdown 数据结构"
    },
    {
      "label": "第三阶段",
      "title": "独立测试与视觉验收"
    }
  ]
}
```
````

:::

### 8.5 知识对比 · `comparison`

```xingyu-block
{
  "version": 1,
  "type": "comparison",
  "title": "示例：ArrayList 和 LinkedList",
  "columns": [
    {
      "name": "ArrayList",
      "note": "动态数组"
    },
    {
      "name": "LinkedList",
      "note": "双向链表"
    }
  ],
  "rows": [
    {
      "label": "随机访问",
      "values": [
        "通常较快",
        "通常较慢"
      ]
    },
    {
      "label": "存储开销",
      "values": [
        "连续引用存储",
        "节点有额外指针开销"
      ]
    },
    {
      "label": "中间插入",
      "values": [
        "可能需要移动元素",
        "定位到节点后修改链接"
      ]
    }
  ],
  "takeaway": "一般列表场景通常先评估 ArrayList。"
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "comparison",
  "title": "示例：ArrayList 和 LinkedList",
  "columns": [
    {
      "name": "ArrayList",
      "note": "动态数组"
    },
    {
      "name": "LinkedList",
      "note": "双向链表"
    }
  ],
  "rows": [
    {
      "label": "随机访问",
      "values": [
        "通常较快",
        "通常较慢"
      ]
    },
    {
      "label": "存储开销",
      "values": [
        "连续引用存储",
        "节点有额外指针开销"
      ]
    },
    {
      "label": "中间插入",
      "values": [
        "可能需要移动元素",
        "定位到节点后修改链接"
      ]
    }
  ],
  "takeaway": "一般列表场景通常先评估 ArrayList。"
}
```
````

:::

### 8.6 记忆闪卡 · `flashcards`

```xingyu-block
{
  "version": 1,
  "type": "flashcards",
  "title": "示例：Java 泛型复习",
  "items": [
    {
      "question": "泛型的主要作用是什么？",
      "answer": "在编译期增强类型检查，降低不安全类型转换风险。"
    },
    {
      "question": "什么是类型擦除？",
      "answer": "编译器会擦除大部分泛型参数信息。",
      "hint": "关注编译阶段。"
    }
  ]
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "flashcards",
  "title": "示例：Java 泛型复习",
  "items": [
    {
      "question": "泛型的主要作用是什么？",
      "answer": "在编译期增强类型检查，降低不安全类型转换风险。"
    },
    {
      "question": "什么是类型擦除？",
      "answer": "编译器会擦除大部分泛型参数信息。",
      "hint": "关注编译阶段。"
    }
  ]
}
```
````

:::

### 8.7 数据图表 · `chart`

```xingyu-block
{
  "version": 1,
  "type": "chart",
  "title": "示例：学习时长",
  "kind": "bar",
  "unit": "小时",
  "items": [
    {
      "label": "周一",
      "value": 1.5
    },
    {
      "label": "周二",
      "value": 2
    },
    {
      "label": "周三",
      "value": 2.5
    }
  ]
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "chart",
  "title": "示例：学习时长",
  "kind": "bar",
  "unit": "小时",
  "items": [
    {
      "label": "周一",
      "value": 1.5
    },
    {
      "label": "周二",
      "value": 2
    },
    {
      "label": "周三",
      "value": 2.5
    }
  ]
}
```
````

:::

### 8.8 分步教程 · `steps`

```xingyu-block
{
  "version": 1,
  "type": "steps",
  "title": "示例：本地检查",
  "items": [
    {
      "title": "查看 Node 版本",
      "description": "先确认运行环境。",
      "command": "node --version"
    },
    {
      "title": "安装依赖",
      "description": "在项目 site 目录内安装锁定的依赖。",
      "command": "npm ci"
    },
    {
      "title": "执行项目检查",
      "description": "检查输出并修复失败项。",
      "command": "npm run ci"
    }
  ]
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "steps",
  "title": "示例：本地检查",
  "items": [
    {
      "title": "查看 Node 版本",
      "description": "先确认运行环境。",
      "command": "node --version"
    },
    {
      "title": "安装依赖",
      "description": "在项目 site 目录内安装锁定的依赖。",
      "command": "npm ci"
    },
    {
      "title": "执行项目检查",
      "description": "检查输出并修复失败项。",
      "command": "npm run ci"
    }
  ]
}
```
````

:::

### 8.9 来源证据 · `sources`

```xingyu-block
{
  "version": 1,
  "type": "sources",
  "title": "示例：Java 技术参考",
  "items": [
    {
      "label": "Oracle Java 官方文档",
      "url": "https://docs.oracle.com/en/java/",
      "note": "查看 Java 基础资料。"
    },
    {
      "label": "OpenJDK 官方网站",
      "url": "https://openjdk.org/",
      "note": "查看开放 JDK 项目信息。"
    }
  ]
}
```

:::details

#### 复制完整写法

````markdown
```xingyu-block
{
  "version": 1,
  "type": "sources",
  "title": "示例：Java 技术参考",
  "items": [
    {
      "label": "Oracle Java 官方文档",
      "url": "https://docs.oracle.com/en/java/",
      "note": "查看 Java 基础资料。"
    },
    {
      "label": "OpenJDK 官方网站",
      "url": "https://openjdk.org/",
      "note": "查看开放 JDK 项目信息。"
    }
  ]
}
```
````

:::

测验统计由每题状态计算；指标保留提供的文字格式。闪卡可以揭示答案并切换卡片，不会记录学习成绩。图表支持 `bar`、`line`、`pie`，可展开原始数据；请只填真实的非负数值。教程里的命令仅展示文本。来源卡只接受 HTTPS 链接，资料内容需要自己核对。

## 9. 图片、附件与 MCP 写作

图片沿用标准 Markdown：

```markdown
![星屿的光](/images/xingyu-past-present-future.webp)
```

附件先在编辑器上传，或通过 MCP `upload_attachment` 上传，再把返回的 Markdown 链接插入正文；不要编造附件地址。公开文章中的附件供读者访问，私有知识空间保持原有权限。

可以这样告诉 AI：

> 把我提供的内容整理成 XINGYU Markdown。说明使用普通段落，适合比较时用 comparison，有明确数据时用 chart，有问题与答案时用 flashcards。保留原始资料，只使用我给出的数字和状态。先给我审阅，再保存到我指定的私有知识空间草稿，不要公开发布。

更新已有文章时先读完整正文，再保存，避免丢失原来的内容。组件不会改变文章的公开或私有属性。

## 10. 选择合适的结构

| 想表达什么 | 建议使用 |
| :-- | :-- |
| 思考、解释、故事 | 普通段落和引用 |
| 有限几项事实的比较 | 表格或 comparison |
| 关系与流程 | Mermaid |
| 多题批改反馈 | quiz_result |
| 少量关键指标 | metric_grid |
| 任务状态 | status_list |
| 事件顺序 | timeline |
| 自测与记忆 | flashcards |
| 有来源的数字变化 | chart |
| 分步操作 | steps |
| 参考资料 | sources |

格式错误、未知组件或超长 JSON 会显示为普通代码块。单块最多 16,384 个字符；组件里的文本不会当作 HTML 或 JavaScript 执行。

## 11. 一点结尾

写作并不是为了把生活解释清楚。

有些内容只需要留下一盏小灯：以后回来的时候，知道自己曾经在这里，认真地想过什么。🌌

---

<sub>XINGYU · 语法与写作示例</sub> · <sup>持续更新</sup>



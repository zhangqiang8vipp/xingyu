/**
 * XINGYU Document Blocks capability catalog.
 * Pure metadata: no React, authorization, network I/O or dynamic code.
 * New block types are registered here for MCP discovery after their
 * parser and renderer have been explicitly whitelisted.
 */
import type { XingyuBlock } from "./schema";

export type DocumentBlockCapability = {
  type: XingyuBlock["type"];
  label: string;
  guide: string;
};

export const XINGYU_DOCUMENT_BLOCK_CATALOG = [
  { type: "quiz_result", label: "测验反馈", guide: "items[{title,status(correct/partial/incorrect),explanation?}]" },
  { type: "metric_grid", label: "统计指标", guide: "items[{label,value,note?}]；数值必须有依据" },
  { type: "status_list", label: "进度清单", guide: "items[{title,status(done/active/pending/blocked),detail?}]" },
  { type: "timeline", label: "时间线", guide: "items[{label,title,detail?}]；事件日期必须真实" },
  { type: "comparison", label: "知识对比", guide: "columns[{name,note?}] 和 rows[{label,values[]}]；2～3 列，每行 values 数量一致" },
  { type: "flashcards", label: "记忆闪卡", guide: "items[{question,answer,hint?}]；浏览器本地揭示答案" },
  { type: "chart", label: "数值图表", guide: "kind=bar/line/pie，unit?，items[{label,value}]；value 必须是明确的非负有限数字" },
  { type: "steps", label: "分步教程", guide: "items[{title,description,command?}]；command 仅为文本、不执行" },
  { type: "sources", label: "来源证据", guide: "items[{label,url,note?}]；只接受无凭据的 HTTPS URL，未经自动核验" },
] as const satisfies readonly DocumentBlockCapability[];

export function getXingyuBlockShortList(): string {
  return XINGYU_DOCUMENT_BLOCK_CATALOG.map(({ type, label }) => `${type} ${label}`).join("、");
}

export function xingyuBlockMcpInstructions(): string {
  return [
    "星屿文档支持版本化的 xingyu-block JSON（version 必须为 1，可选 title），以下是可用组件及其字段：",
    XINGYU_DOCUMENT_BLOCK_CATALOG.map(({ type, guide }) => `${type}: ${guide}`).join("；"),
    "模型自行决定是否使用组件，普通叙述仍用 Markdown；只使用有依据的事实，不凭空生成数字、状态、日期或参考来源。缺少依据先询问用户。",
    "整个内容存储为 Markdown；不得输出任意脚本或可执行 HTML，不得自动请求外部来源地址；Knowledge Space 的权限和发布边界不改变。",
    "更多 JSON 示例：docs/guides/ai-document-blocks-mcp.md 以及 docs/guides/ai-document-blocks-plus.md。",
  ].join(" ");
}

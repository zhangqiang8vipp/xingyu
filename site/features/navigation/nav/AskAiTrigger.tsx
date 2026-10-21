"use client";

export default function AskAiTrigger() {
  return <button type="button" className="xy-ai-nav-trigger" aria-label="打开全局 AI 知识助手"
    aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event("xingyu:ask-open"))}>
    <span aria-hidden="true">✦</span>询问 AI
  </button>;
}

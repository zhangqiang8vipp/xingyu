"use client";

import { usePathname } from "next/navigation";

export default function AskAiTrigger() {
  const pathname = usePathname();
  return <button type="button" className="xy-ai-nav-trigger" aria-label="打开全局 AI 知识助手"
    aria-haspopup={pathname === "/ask" ? undefined : "dialog"}
    onClick={() => {
      if (pathname === "/ask")
        document.querySelector<HTMLTextAreaElement>(".xy-ai-chat--page textarea")?.focus();
      else window.dispatchEvent(new Event("xingyu:ask-open"));
    }}>
    <span aria-hidden="true">✦</span>询问 AI
  </button>;
}

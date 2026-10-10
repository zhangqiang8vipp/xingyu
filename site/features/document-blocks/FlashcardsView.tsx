"use client";

import { useId, useState } from "react";
import type { FlashcardsBlock } from "./schema";

/**
 * Flashcards only change local presentation state. No progress data is stored,
 * no network request is made, and source Markdown remains untouched.
 */
export default function FlashcardsView({ block }: { block: FlashcardsBlock }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const answerId = useId();
  const current = block.items[index];

  const navigate = (next: number) => {
    if (next < 0 || next >= block.items.length) return;
    setIndex(next);
    setRevealed(false);
  };

  return (
    <section className="xy-block xy-block-flashcards" aria-label={block.title || "记忆闪卡"}>
      <header className="xy-block-heading">
        <span className="xy-block-eyebrow">记忆闪卡</span>
        {block.title && <strong className="xy-block-title">{block.title}</strong>}
      </header>
      <div className="xy-flash-stage">
        <div className="xy-flash-meta" aria-live="polite" aria-atomic="true">
          <span>问题 {index + 1} / {block.items.length}</span>
          <span>先思考，再查看答案</span>
        </div>
        <strong className="xy-flash-question">{current.question}</strong>
        {current.hint && <p className="xy-flash-hint">提示：{current.hint}</p>}
        <button
          className="xy-flash-reveal"
          type="button"
          aria-expanded={revealed}
          aria-controls={answerId}
          onClick={() => setRevealed((value) => !value)}
        >{revealed ? "收起答案" : "查看答案"}</button>
        <div id={answerId} className="xy-flash-answer" hidden={!revealed}>
          <span>参考答案</span>
          <p>{current.answer}</p>
        </div>
      </div>
      <nav className="xy-flash-nav" aria-label="切换记忆卡片">
        <button type="button" onClick={() => navigate(index - 1)} disabled={index === 0}>← 上一张</button>
        <button type="button" onClick={() => navigate(index + 1)} disabled={index === block.items.length - 1}>下一张 →</button>
      </nav>
    </section>
  );
}

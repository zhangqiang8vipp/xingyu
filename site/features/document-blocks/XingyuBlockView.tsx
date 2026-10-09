import type { ProgressStatus, QuizStatus, XingyuBlock } from "./schema";
import { summarizeQuiz } from "./schema";
import "./blocks.css";

const statusLabel: Record<QuizStatus, string> = {
  correct: "正确",
  partial: "部分正确",
  incorrect: "需要纠正",
};

const progressStatusLabel: Record<ProgressStatus, string> = {
  done: "已完成",
  active: "进行中",
  pending: "待开始",
  blocked: "受阻",
};

/** Pure, accessible UI. No evaluated HTML, URL, script, or client-side AI. */
export default function XingyuBlockView({ block }: { block: XingyuBlock }) {
  if (block.type === "metric_grid") {
    return (
      <section className="xy-block xy-block-metrics" aria-label={block.title || "数据概览"}>
        <header className="xy-block-heading">
          <span className="xy-block-eyebrow">数据概览</span>
          {block.title && <strong className="xy-block-title">{block.title}</strong>}
        </header>
        <div className="xy-metric-grid" role="list">
          {block.items.map((item, index) => (
            <div className="xy-metric" role="listitem" key={index}>
              <strong className="xy-metric-value">{item.value}</strong>
              <span className="xy-metric-label">{item.label}</span>
              {item.note && <small className="xy-metric-note">{item.note}</small>}
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (block.type === "status_list") {
    return (
      <section className="xy-block xy-block-status" aria-label={block.title || "进度清单"}>
        <header className="xy-block-heading">
          <span className="xy-block-eyebrow">进度清单</span>
          {block.title && <strong className="xy-block-title">{block.title}</strong>}
        </header>
        <ul className="xy-status-items">
          {block.items.map((item, index) => (
            <li key={index}>
              <div className="xy-status-row">
                <span className="xy-status-title">{item.title}</span>
                <span className={`xy-status-pill xy-status-pill-${item.status}`}>
                  {progressStatusLabel[item.status]}
                </span>
              </div>
              {item.detail && <p className="xy-status-detail">{item.detail}</p>}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (block.type === "timeline") {
    return (
      <section className="xy-block xy-block-timeline" aria-label={block.title || "时间线"}>
        <header className="xy-block-heading">
          <span className="xy-block-eyebrow">时间线</span>
          {block.title && <strong className="xy-block-title">{block.title}</strong>}
        </header>
        <ol className="xy-timeline-items">
          {block.items.map((item, index) => (
            <li className="xy-timeline-item" key={index}>
              <span className="xy-timeline-dot" aria-hidden="true" />
              <div className="xy-timeline-content">
                <span className="xy-timeline-label">{item.label}</span>
                <strong className="xy-timeline-title">{item.title}</strong>
                {item.detail && <p className="xy-timeline-detail">{item.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const summary = summarizeQuiz(block.items);
  return (
    <section className="xy-block xy-block-quiz" aria-label={block.title || "测验反馈"}>
      <header className="xy-block-heading">
        <span className="xy-block-eyebrow">学习反馈</span>
        {block.title && <strong className="xy-block-title">{block.title}</strong>}
      </header>
      <div className="xy-quiz-summary" role="group" aria-label="答题概览">
        <div className="xy-quiz-stat xy-quiz-stat-correct">
          <strong>{summary.correct}</strong><span>正确</span>
        </div>
        <div className="xy-quiz-stat xy-quiz-stat-partial">
          <strong>{summary.partial}</strong><span>部分正确</span>
        </div>
        <div className="xy-quiz-stat xy-quiz-stat-incorrect">
          <strong>{summary.incorrect}</strong><span>需要纠正</span>
        </div>
      </div>
      <ol className="xy-quiz-items">
        {block.items.map((item, index) => (
          <li key={index}>
            <div className="xy-quiz-item">
              <span className="xy-quiz-question">第 {index + 1} 题：{item.title}</span>
              <span className={`xy-quiz-status xy-quiz-status-${item.status}`}>
                {statusLabel[item.status]}
              </span>
            </div>
            {item.explanation && (
              <details className="xy-quiz-explanation">
                <summary>查看解析</summary>
                <p>{item.explanation}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

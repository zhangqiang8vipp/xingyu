import type { ChartBlock } from "./schema";

const displayNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const chartTypeLabel = { bar: "柱状图", line: "折线图", pie: "饼图" } as const;

function shortLabel(label: string) {
  return Array.from(label).length <= 7 ? label : Array.from(label).slice(0, 6).join("") + "…";
}

function pointOnCircle(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function slicePath(cx: number, cy: number, radius: number, start: number, end: number) {
  const a = pointOnCircle(cx, cy, radius, start);
  const b = pointOnCircle(cx, cy, radius, end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y} Z`;
}

/** Static, dependency-free SVG chart. Explicit data only, never external fetches. */
export default function MiniChartView({ block }: { block: ChartBlock }) {
  const { items, kind } = block;
  const w = 680, h = 270, left = 54, right = 19, top = 20, bottom = 66;
  const plotW = w - left - right, plotH = h - top - bottom;
  const largest = Math.max(1, ...items.map((item) => item.value));
  const unit = block.unit ? ` ${block.unit}` : "";
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const chartLabel = block.title || "数据图表";
  const xy = items.map((item, index) => ({
    x: left + ((kind === "bar" ? index + 0.5 : index / (items.length - 1) * items.length) / items.length) * plotW,
    y: top + plotH * (1 - item.value / largest),
  }));
  let angle = -Math.PI / 2;

  return (
    <section className="xy-block xy-block-chart" aria-label={chartLabel}>
      <header className="xy-block-heading">
        <span className="xy-block-eyebrow">数据图表 · {chartTypeLabel[kind]}</span>
        {block.title && <strong className="xy-block-title">{block.title}</strong>}
      </header>
      <div className="xy-chart-viewport">
        <svg className="xy-chart-svg" viewBox={`0 0 ${w} ${h}`} role="img"
          aria-label={`${chartLabel}，${chartTypeLabel[kind]}，共 ${items.length} 项数据`}>
          <title>{`${chartLabel} · ${chartTypeLabel[kind]}`}</title>
          {kind !== "pie" && (
            <>
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                const y = top + plotH * (1 - fraction);
                return (
                  <g key={fraction}>
                    <line className="xy-chart-gridline" x1={left} y1={y} x2={w - right} y2={y} />
                    <text className="xy-chart-axis" x={left - 8} y={y + 4} textAnchor="end">
                      {displayNumber.format(largest * fraction)}
                    </text>
                  </g>
                );
              })}
              {kind === "bar" ? items.map((item, index) => {
                const band = plotW / items.length, bw = band * 0.57;
                const bh = Math.max(0, plotH * item.value / largest);
                return (
                  <g key={item.label}>
                    <rect className="xy-chart-bar" x={xy[index].x - bw / 2}
                      y={top + plotH - bh} width={bw} height={bh} rx={3} />
                    <text className="xy-chart-axis" x={xy[index].x} y={h - bottom + 21} textAnchor="middle">
                      {shortLabel(item.label)}
                    </text>
                  </g>
                );
              }) : (
                <>
                  <polyline className="xy-chart-line"
                    points={xy.map((point) => `${point.x},${point.y}`).join(" ")} />
                  {items.map((item, index) => (
                    <g key={item.label}>
                      <circle className="xy-chart-point" cx={xy[index].x} cy={xy[index].y} r={5} />
                      <text className="xy-chart-axis" x={xy[index].x} y={h - bottom + 21}
                        textAnchor="middle">{shortLabel(item.label)}</text>
                    </g>
                  ))}
                </>
              )}
            </>
          )}
          {kind === "pie" && items.map((item, index) => {
            if (item.value === 0) return null;
            const delta = 2 * Math.PI * item.value / total;
            const start = angle;
            angle += delta;
            const className = `xy-chart-slice xy-chart-slice-${index % 8}`;
            return delta >= 2 * Math.PI - 0.000001
              ? <circle key={item.label} cx={w / 2} cy={h / 2} r={112} className={className} />
              : <path key={item.label} d={slicePath(w / 2, h / 2, 112, start, angle)} className={className} />;
          })}
        </svg>
      </div>
      {kind === "pie" && (
        <ul className="xy-chart-legend">
          {items.map((item, index) => (
            <li key={item.label}>
              <span className={`xy-chart-legend-swatch xy-chart-slice-${index % 8}`} aria-hidden="true" />
              <span>{item.label}</span>
              <strong>{displayNumber.format(item.value)}{unit}</strong>
            </li>
          ))}
        </ul>
      )}
      <details className="xy-chart-raw">
        <summary>查看原始数据</summary>
        <table>
          <thead><tr><th scope="col">项目</th><th scope="col">数值{unit}</th></tr></thead>
          <tbody>{items.map((item) => (
            <tr key={item.label}><th scope="row">{item.label}</th><td>{displayNumber.format(item.value)}</td></tr>
          ))}</tbody>
        </table>
      </details>
      <p className="xy-chart-note">仅展示文档提供的数据，不自动更新或联网查询。</p>
    </section>
  );
}

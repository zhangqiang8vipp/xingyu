"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { mermaidAppearance } from "./mermaid-theme";
import { clampDiagramZoom, diagramZoomScroll, DIAGRAM_PADDING, fitDiagramZoom, MIN_DIAGRAM_ZOOM } from "./mermaid-viewport";

type RenderedDiagram = { key: string; svg: string; width: number; height: number; error: boolean };
type DragState = { element: HTMLDivElement; pointerId: number; x: number; y: number; left: number; top: number };

export default function MarkdownMermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[:]/g, "");
  const [rendered, setRendered] = useState<RenderedDiagram>({ key: "", svg: "", width: 0, height: 0, error: false });
  const [themeVersion, setThemeVersion] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [overflowing, setOverflowing] = useState(false);
  const inlineRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const zoomRef = useRef(1);
  const renderKey = `${chart}\u0000${themeVersion}`;

  useEffect(() => {
    const refresh = () => setThemeVersion((version) => version + 1);
    window.addEventListener("xingyu:theme-change", refresh);
    return () => window.removeEventListener("xingyu:theme-change", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        ...mermaidAppearance(document.documentElement.dataset.theme === "dark"),
      });
      const result = await mermaid.render(`xingyu-mermaid-${id}`, chart);
      const svg = new DOMParser().parseFromString(result.svg, "image/svg+xml").documentElement;
      const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
      const width = viewBox?.[2] || parseFloat(svg.getAttribute("width") || "") || 960;
      const height = viewBox?.[3] || parseFloat(svg.getAttribute("height") || "") || 480;
      if (active) setRendered({ key: renderKey, svg: result.svg, width, height, error: false });
    }).catch(() => {
      if (active) setRendered({ key: renderKey, svg: "", width: 0, height: 0, error: true });
    });
    return () => { active = false; };
  }, [chart, id, renderKey]);

  useEffect(() => {
    const container = inlineRef.current;
    if (!container || rendered.key !== renderKey || expanded) return;
    const update = () => setOverflowing(container.scrollWidth > container.clientWidth + 8);
    container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [rendered, renderKey, expanded]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!expanded) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const canvas = dialog.querySelector<HTMLElement>(".mermaid-dialog-canvas");
    if (!canvas) return;
    // The observer fires after the dialog has a real viewport, and on rotation.
    const observer = new ResizeObserver(() => {
      const next = fitDiagramZoom(rendered.width, rendered.height, canvas.clientWidth, canvas.clientHeight);
      zoomRef.current = next;
      setZoom(next);
      canvas.scrollLeft = 0;
      canvas.scrollTop = 0;
    });
    // Observe the fixed dialog, not canvas content: zoom-induced scrollbars
    // must not be mistaken for a viewport resize and reset manual zoom.
    observer.observe(dialog, { box: "border-box" });
    return () => observer.disconnect();
  }, [expanded, rendered.width, rendered.height]);

  useEffect(() => {
    const container = inlineRef.current;
    if (!container || expanded) return;
    const wheel = (event: WheelEvent) => {
      if (!event.shiftKey || container.scrollWidth <= container.clientWidth) return;
      event.preventDefault();
      container.scrollLeft += event.deltaY || event.deltaX;
    };
    container.addEventListener("wheel", wheel, { passive: false });
    return () => container.removeEventListener("wheel", wheel);
  }, [expanded, rendered.key]);

  const changeZoom = useCallback((value: number, clientX?: number, clientY?: number) => {
    const canvas = dialogRef.current?.querySelector<HTMLDivElement>(".mermaid-dialog-canvas");
    const next = clampDiagramZoom(value);
    const previous = zoomRef.current;
    if (!canvas || next === previous) return;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const y = (clientY ?? rect.top + rect.height / 2) - rect.top;
    const left = diagramZoomScroll(rendered.width, canvas.clientWidth, canvas.scrollLeft, x, previous, next);
    const top = diagramZoomScroll(rendered.height, canvas.clientHeight, canvas.scrollTop, y, previous, next);
    zoomRef.current = next;
    setZoom(next);
    requestAnimationFrame(() => {
      canvas.scrollLeft = left;
      canvas.scrollTop = top;
    });
  }, [rendered.width, rendered.height]);

  useEffect(() => {
    const canvas = dialogRef.current?.querySelector<HTMLDivElement>(".mermaid-dialog-canvas");
    if (!canvas || !expanded) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      changeZoom(zoomRef.current * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [expanded, changeZoom]);

  const fitToWindow = () => {
    const canvas = dialogRef.current?.querySelector<HTMLDivElement>(".mermaid-dialog-canvas");
    if (!canvas) return;
    changeZoom(fitDiagramZoom(rendered.width, rendered.height, canvas.clientWidth, canvas.clientHeight));
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (event.pointerType === "touch" || event.button !== 0 || (event.target as Element).closest("a, button")) return;
    if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) return;
    dragRef.current = { element, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    element.setPointerCapture(event.pointerId);
    element.classList.add("is-dragging");
    event.preventDefault();
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.element !== event.currentTarget) return;
    drag.element.scrollLeft = drag.left - (event.clientX - drag.x);
    drag.element.scrollTop = drag.top - (event.clientY - drag.y);
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.element !== event.currentTarget) return;
    dragRef.current = null;
    drag.element.classList.remove("is-dragging");
    if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
  };

  if (rendered.key !== renderKey) return <div className="mermaid-loading" aria-label="正在绘制图表" />;
  if (rendered.error) return <pre className="mermaid-fallback"><code>{chart}</code></pre>;
  return <figure className="mermaid-figure">
    <div className="mermaid-figure-actions">
      {overflowing && <span className="mermaid-scroll-hint">拖动或 Shift + 滚轮查看全图</span>}
      <button type="button" onClick={() => { zoomRef.current = 1; setZoom(1); setExpanded(true); }} aria-label="放大查看图表">↗ <span>放大查看</span></button>
    </div>
    <div ref={inlineRef} className={`mermaid-diagram${overflowing ? " is-pannable" : ""}`} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
      <div style={{ width: `min(100%, ${rendered.width}px)`, aspectRatio: `${rendered.width} / ${rendered.height}` }}>
        {!expanded && <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />}
      </div>
    </div>
    <dialog ref={dialogRef} className="mermaid-dialog" aria-label="放大查看图表" onClose={() => setExpanded(false)} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
      <div className="mermaid-dialog-toolbar">
        <strong>图表查看 <small>滚轮缩放 · 拖动移动</small></strong>
        <div>
          <button type="button" onClick={fitToWindow}>适应窗口</button>
          <button type="button" onClick={() => changeZoom(1)}>原始大小</button>
          <button type="button" onClick={() => changeZoom(zoomRef.current / 1.25)} disabled={zoom <= MIN_DIAGRAM_ZOOM} aria-label="缩小图表">−</button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => changeZoom(zoomRef.current * 1.25)} disabled={zoom >= 3} aria-label="放大图表">＋</button>
          <button type="button" onClick={() => setExpanded(false)} aria-label="关闭图表">关闭</button>
        </div>
      </div>
      <div className="mermaid-dialog-canvas" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <div className="mermaid-dialog-stage" style={{ width: `max(100%, ${rendered.width * zoom + 2 * DIAGRAM_PADDING}px)`, height: `max(100%, ${rendered.height * zoom + 2 * DIAGRAM_PADDING}px)` }}>
          {expanded && <div style={{ width: `${rendered.width * zoom}px`, height: `${rendered.height * zoom}px` }} dangerouslySetInnerHTML={{ __html: rendered.svg }} />}
        </div>
      </div>
    </dialog>
  </figure>;
}

"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import AxisMark from "@/features/navigation/AxisMark";

type Point = { x: number; y: number };
type RelativePoint = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Drag = {
  id: number;
  startX: number;
  startY: number;
  from: Point;
  moved: boolean;
};

const SIZE = 52;
const EDGE = 12;
const SLOP = 8;
const STORAGE = "xingyu:axis-ai-launcher:v1:";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function mobile() {
  return window.matchMedia("(max-width: 800px)").matches;
}

function storageKey() {
  return STORAGE + (mobile() ? "mobile" : "desktop");
}

function visible(element: HTMLElement) {
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden"
    && box.width > 0 && box.height > 0;
}

/** Keep the movable control out of the safe area and existing AXIS islands. */
function getBounds(button: HTMLButtonElement): Bounds {
  const viewport = window.visualViewport;
  const offsetLeft = viewport?.offsetLeft ?? 0;
  const offsetTop = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const computed = getComputedStyle(button);
  const safeTop = parseFloat(computed.getPropertyValue("--xy-ai-safe-top")) || 0;
  const safeBottom = parseFloat(computed.getPropertyValue("--xy-ai-safe-bottom")) || 0;

  const left = offsetLeft + EDGE;
  const right = Math.max(left, offsetLeft + width - SIZE - EDGE);
  let top = offsetTop + safeTop + EDGE;
  let bottom = offsetTop + height - safeBottom - SIZE - EDGE;

  if (mobile()) {
    const navigation = document.querySelector<HTMLElement>(
      ".admin-workspace-bar, .admin-sidebar, .site-nav nav"
    );
    if (navigation && visible(navigation)) {
      top = Math.max(top, navigation.getBoundingClientRect().bottom + 12);
    }
    const dock = document.querySelector<HTMLElement>(".admin-more .admin-dock");
    if (dock && visible(dock)) {
      bottom = Math.min(bottom, dock.getBoundingClientRect().top - SIZE - 12);
    }
  }
  // Tiny landscape screens may have insufficient room for both islands;
  // prefer keeping the AI trigger entirely within the visual viewport.
  if (bottom < top) {
    top = Math.max(offsetTop + safeTop + EDGE,
      Math.min(top, offsetTop + height - safeBottom - SIZE - EDGE));
    bottom = Math.max(top, offsetTop + height - safeBottom - SIZE - EDGE);
  }

  return { left, right, top, bottom };
}

function within(point: Point, bounds: Bounds): Point {
  return {
    x: clamp(point.x, bounds.left, bounds.right),
    y: clamp(point.y, bounds.top, bounds.bottom),
  };
}

function relative(point: Point, bounds: Bounds): RelativePoint {
  return {
    x: bounds.right > bounds.left ? clamp((point.x - bounds.left) / (bounds.right - bounds.left), 0, 1) : 1,
    y: bounds.bottom > bounds.top ? clamp((point.y - bounds.top) / (bounds.bottom - bounds.top), 0, 1) : 1,
  };
}

function absolute(point: RelativePoint, bounds: Bounds): Point {
  return within({
    x: bounds.left + point.x * (bounds.right - bounds.left),
    y: bounds.top + point.y * (bounds.bottom - bounds.top),
  }, bounds);
}

function loadPosition(): RelativePoint | null {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const { x, y } = value as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)
      || x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  } catch {
    return null; // Storage may be disabled in privacy mode.
  }
}

function persist(point: RelativePoint) {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(point));
  } catch { /* Gesture still works when storage is unavailable. */ }
}

/**
 * Pure AXIS logo, no caption and no extra navigation slot. A tap opens the
 * original AI panel. Dragging repositions only this button, never the page.
 * Relative coordinates survive rotation and phone/desktop layouts separately.
 */
export default function DraggableAxisLauncher({
  hidden, expanded, onActivate, route,
}: {
  hidden: boolean;
  expanded: boolean;
  onActivate: () => void;
  route: string | null;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const ignoreClickRef = useRef(false);
  const pointRef = useRef<Point | null>(null);
  const fractionalRef = useRef<RelativePoint | null>(null);
  const [position, setPosition] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);

  const place = (point: Point) => {
    pointRef.current = point;
    setPosition(point);
  };

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const arrange = () => {
      if (dragRef.current) return;
      const bounds = getBounds(button);
      const saved = loadPosition() ?? fractionalRef.current;
      const current = button.getBoundingClientRect();
      const next = saved
        ? absolute(saved, bounds)
        : within({ x: current.left, y: current.top }, bounds);
      fractionalRef.current = relative(next, bounds);
      place(next);
    };
    const frame = window.requestAnimationFrame(arrange);
    window.addEventListener("resize", arrange);
    window.visualViewport?.addEventListener("resize", arrange);
    window.visualViewport?.addEventListener("scroll", arrange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", arrange);
      window.visualViewport?.removeEventListener("resize", arrange);
      window.visualViewport?.removeEventListener("scroll", arrange);
    };
  }, [route]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    const button = event.currentTarget;
    const box = button.getBoundingClientRect();
    ignoreClickRef.current = false;
    dragRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      from: { x: box.left, y: box.top },
      moved: false,
    };
    button.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < SLOP) return;
    drag.moved = true;
    if (!dragging) setDragging(true);
    const bounds = getBounds(event.currentTarget);
    place(within({ x: drag.from.x + dx, y: drag.from.y + dy }, bounds));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.moved) {
      const bounds = getBounds(event.currentTarget);
      const latest = within(pointRef.current ?? drag.from, bounds);
      const fraction = relative(latest, bounds);
      fractionalRef.current = fraction;
      persist(fraction);
      ignoreClickRef.current = true;
      // The synthetic click from the released pointer must not open the chat.
      window.setTimeout(() => { ignoreClickRef.current = false; }, 120);
    }
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (!event.shiftKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const button = event.currentTarget;
    const box = button.getBoundingClientRect();
    const dx = event.key === "ArrowLeft" ? -18 : event.key === "ArrowRight" ? 18 : 0;
    const dy = event.key === "ArrowUp" ? -18 : event.key === "ArrowDown" ? 18 : 0;
    const bounds = getBounds(button);
    const next = within({ x: box.left + dx, y: box.top + dy }, bounds);
    place(next);
    fractionalRef.current = relative(next, bounds);
    persist(fractionalRef.current);
  }

  return <button
    ref={buttonRef}
    type="button"
    className={"xy-ai-launcher" + (dragging ? " is-dragging" : "")}
    aria-label="打开星屿 AI 助手；可拖动调整位置"
    title="星屿 AI · 轻点打开，拖动调整位置"
    aria-haspopup="dialog"
    aria-expanded={expanded}
    aria-controls="xy-ai-global-panel"
    hidden={hidden}
    style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
    onKeyDown={moveWithKeyboard}
    onClick={event => {
      if (event.detail !== 0 && ignoreClickRef.current) {
        event.preventDefault();
        ignoreClickRef.current = false;
        return;
      }
      onActivate();
    }}
  ><AxisMark className="xy-ai-launcher-mark" /></button>;
}

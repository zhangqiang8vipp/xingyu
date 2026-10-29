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
    // Admin panels may mount their dock after the global assistant is placed.
    // Reserve its safe-area rail immediately, even before the dock is in DOM.
    if (document.querySelector(".admin-shell")) {
      bottom = Math.min(bottom, offsetTop + height - safeBottom - SIZE - 104);
    }
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

/** Choose a clear launch spot only for the *initial* position. User drags
 * always win. A whole knowledge card is a clickable link, so a 52px bubble
 * should not sit on its primary tap surface by default. */
function activeActionRects(button: HTMLButtonElement): DOMRect[] {
  const rects: DOMRect[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(
    'a[href],button,input,textarea,select,label,[contenteditable="true"],[role="link"],[role="button"]'
  )) {
    if (element === button || button.contains(element) || element.contains(button)) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden"
      || style.pointerEvents === "none") continue;
    rects.push(rect);
  }
  return rects;
}

function coversAction(point: Point, rects: DOMRect[]): boolean {
  const box = { left: point.x - 3, right: point.x + SIZE + 3,
    top: point.y - 3, bottom: point.y + SIZE + 3 };
  return rects.some(rect => box.left < rect.right && box.right > rect.left
    && box.top < rect.bottom && box.bottom > rect.top);
}

function clearDefault(point: Point, bounds: Bounds, button: HTMLButtonElement): Point {
  if (!mobile()) return point;
  // One layout read per action, not one per attempted candidate location.
  const rects = activeActionRects(button);
  if (!coversAction(point, rects)) return point;
  const steps = Math.ceil((bounds.bottom - bounds.top) / 12);
  for (let step = 1; step <= steps; step++) {
    for (const direction of [-1, 1]) {
      const candidate = { x: point.x,
        y: clamp(point.y + direction * step * 12, bounds.top, bounds.bottom) };
      if (!coversAction(candidate, rects)) return candidate;
    }
  }
  return point; // Never displace a control offscreen in a very small viewport.
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
  const manuallyPlacedRef = useRef(false);
  const [position, setPosition] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);

  const place = (point: Point) => {
    pointRef.current = point;
    setPosition(point);
  };

  useEffect(() => {
    const button = buttonRef.current;
    if (!button || hidden) return;
    const arrange = () => {
      if (dragRef.current) return;
      const bounds = getBounds(button);
      const saved = loadPosition();
      const manual = saved ?? (manuallyPlacedRef.current ? fractionalRef.current : null);
      const current = button.getBoundingClientRect();
      const suggestion = fractionalRef.current
        ? absolute(fractionalRef.current, bounds)
        : within({ x: current.left, y: current.top }, bounds);
      const next = manual ? absolute(manual, bounds) : clearDefault(suggestion, bounds, button);
      fractionalRef.current = relative(next, bounds);
      place(next);
    };
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(arrange);
    };
    schedule();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    // SPA content and the admin dock can mount after this root component.
    // Recheck only unchosen defaults; don't move a deliberately placed logo.
    const observer = new MutationObserver(() => {
      if (!manuallyPlacedRef.current && !loadPosition()) schedule();
    });
    observer.observe(document.querySelector(".admin-workspace") ?? document.querySelector("main")
      ?? document.body, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [route, hidden]);

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
      manuallyPlacedRef.current = true;
      persist(fraction);
      ignoreClickRef.current = true;
      // A delayed synthetic touch click must still be ignored. The next
      // actual pointerdown resets this flag, allowing the next tap to open.
    }
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    // iOS can cancel a gesture when the page loses focus, rotates, or
    // starts native scrolling. Never save a half-completed drag.
    place(drag.from);
    dragRef.current = null;
    setDragging(false);
    ignoreClickRef.current = drag.moved;
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
    manuallyPlacedRef.current = true;
    persist(fractionalRef.current);
  }

  return <button
    ref={buttonRef}
    type="button"
    className={"xy-ai-launcher" + (dragging ? " is-dragging" : "")}
    aria-label="打开星屿 AI 助手；可拖动，或按住 Shift 加方向键移动位置"
    aria-description="轻点打开对话；拖动移动位置；Shift 加方向键也可调整位置"
    aria-haspopup="dialog"
    aria-expanded={expanded}
    aria-controls="xy-ai-global-panel"
    hidden={hidden}
    style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={endDrag}
    onPointerCancel={cancelDrag}
    onLostPointerCapture={cancelDrag}
    onContextMenu={event => event.preventDefault()}
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

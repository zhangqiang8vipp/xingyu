"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import AxisMark from "@/features/navigation/AxisMark";
import DraggableAxisLauncher from "./DraggableAxisLauncher";

const AskChat = lazy(() => import("./AskChat"));

/** Mounted once in the root layout, so page navigation does not create AI memory or duplicate launchers. */
export default function GlobalAskAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const isAskPage = pathname === "/ask";

  useEffect(() => {
    const openFromNavigation = () => {
      lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMounted(true);
      setOpen(true);
    };
    const onKeyboard = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        if (event.altKey || event.shiftKey || event.repeat || document.activeElement?.tagName === "TEXTAREA") return;
        event.preventDefault();
        if (pathname !== "/ask") {
          setMounted(true);
          setOpen(value => !value);
        }
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("xingyu:ask-open", openFromNavigation);
    window.addEventListener("keydown", onKeyboard);
    return () => {
      window.removeEventListener("xingyu:ask-open", openFromNavigation);
      window.removeEventListener("keydown", onKeyboard);
    };
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    let active = true;
    // Only look up login state after opening; do not make every public page dynamic.
    void fetch("/api/ask", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? response.json() as Promise<{ authenticated?: boolean }> : { authenticated: false })
      .then(data => { if (active) setAuthenticated(Boolean(data.authenticated)); })
      .catch(() => { if (active) setAuthenticated(false); });
    return () => {
      active = false;
      document.body.style.overflow = before;
      if (lastFocus.current?.isConnected)
        lastFocus.current.focus({ preventScroll: true });
    };
  }, [open]);

  // Keep keyboard focus inside the open modal instead of allowing Tab to
  // reach page navigation behind its backdrop.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])'
    )).filter(element => element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== "hidden");

    const keepTabInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = focusables();
      if (!controls.length) { event.preventDefault(); panel.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) {
        (focusables()[0] ?? panel).focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", keepTabInside, true);
    document.addEventListener("focusin", keepFocusInside, true);
    return () => {
      document.removeEventListener("keydown", keepTabInside, true);
      document.removeEventListener("focusin", keepFocusInside, true);
    };
  }, [open]);

  function openPanel() {
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMounted(true);
    setOpen(true);
  }

  if (isAskPage) return null;
  return <>
    <DraggableAxisLauncher hidden={open} expanded={open} onActivate={openPanel} route={pathname} />
    {mounted ? <>
      <link rel="stylesheet" href="/assistant.css" />
      {open ? <button className="xy-ai-backdrop" type="button" aria-label="关闭 AI 助手"
        onClick={() => setOpen(false)} /> : null}
      <aside ref={panelRef} id="xy-ai-global-panel" tabIndex={-1} className="xy-ai-panel" role="dialog"
        aria-label="星屿 AI 知识助手" aria-modal={open ? "true" : undefined} hidden={!open}
        onClickCapture={event => {
          const target = event.target as Element;
          const link = target.closest("a[href]");
          if (link && link.getAttribute("href")?.startsWith("/")) setOpen(false);
        }}>
        <div className="xy-ai-panel-header">
          <div className="xy-ai-panel-identity">
            <span className="xy-ai-panel-logo"><AxisMark /></span>
            <div><strong>星屿 AI</strong><small>Knowledge assistant</small></div>
          </div>
          <div className="xy-ai-panel-controls">
            <a href="/ask" className="xy-ai-expand" title="进入完整问答页" aria-label="进入完整问答页">⤢</a>
            <button ref={closeRef} type="button" className="xy-ai-close"
              onClick={() => setOpen(false)} aria-label="关闭 AI 助手">×</button>
          </div>
        </div>
        <Suspense fallback={<div className="xy-ai-panel-loading">正在准备知识助手…</div>}>
          <AskChat variant="panel" authenticated={authenticated} />
        </Suspense>
      </aside>
    </> : null}
  </>;
}

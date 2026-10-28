"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import NavTools from "./NavTools";
import { NAV_DESTINATIONS, type NavCurrent } from "./nav-destinations";

/** Phone: icon trigger + sheet. Not a compressed copy of the desktop island. */
export default function MobileIslandMenu({ current }: { current?: NavCurrent }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const sheetId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return <div className={`nav-mobile${open ? " open" : ""}`} ref={rootRef}>
    <button
      className="nav-mobile-trigger"
      type="button"
      aria-label={open ? "关闭菜单" : "打开菜单"}
      aria-expanded={open}
      aria-controls={sheetId}
      onClick={() => setOpen((value) => !value)}
    >
      <svg className="nav-mobile-menu-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
    </button>
    {open ? <div className="nav-mobile-sheet" id={sheetId}>
      <div className="nav-mobile-section-title">导航</div>
      <div className="nav-mobile-links">
        {NAV_DESTINATIONS.map((item) => <Link
          key={item.id}
          className={current === item.id ? "nav-current" : undefined}
          aria-current={current === item.id ? "page" : undefined}
          href={item.href}
          prefetch={false}
          onClick={() => setOpen(false)}
        >{item.label}{current === item.id ? <i /> : null}</Link>)}
      </div>
      <div className="nav-mobile-tools">
        <span className="nav-mobile-section-title">显示偏好</span>
        <NavTools />
      </div>
    </div> : null}
  </div>;
}

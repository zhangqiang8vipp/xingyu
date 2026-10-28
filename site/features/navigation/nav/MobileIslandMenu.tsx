"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import NavTools from "./NavTools";
import { NAV_DESTINATIONS, type NavCurrent } from "./nav-destinations";

/** Phone: icon trigger + sheet. Not a compressed copy of the desktop island. */
export default function MobileIslandMenu({ current }: { current?: NavCurrent }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const activeDestination = NAV_DESTINATIONS.find((item) => item.href === "/"
    ? pathname === "/"
    : pathname === item.href || pathname.startsWith(`${item.href}/`))?.id ?? current;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
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
      ref={triggerRef}
      className="nav-mobile-trigger"
      type="button"
      aria-label={open ? "关闭菜单" : "打开菜单"}
      aria-expanded={open}
      aria-controls={sheetId}
      onClick={() => {
        if (!open) requestAnimationFrame(() => firstLinkRef.current?.focus());
        setOpen((value) => !value);
      }}
    >
      <svg className="nav-mobile-menu-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
    </button>
    {open ? <div className="nav-mobile-sheet" id={sheetId}>
      <div className="nav-mobile-section-title">导航</div>
      <nav className="nav-mobile-links" aria-label="移动端站点导航">
        {NAV_DESTINATIONS.map((item) => <Link
          key={item.id}
          ref={item.id === NAV_DESTINATIONS[0].id ? firstLinkRef : undefined}
          className={activeDestination === item.id ? "nav-current" : undefined}
          aria-current={activeDestination === item.id ? "page" : undefined}
          href={item.href}
          prefetch={false}
          onClick={() => setOpen(false)}
        >{item.label}{activeDestination === item.id ? <i aria-hidden="true" /> : null}</Link>)}
      </nav>
      <div className="nav-mobile-tools">
        <span className="nav-mobile-section-title">显示偏好</span>
        <NavTools />
      </div>
    </div> : null}
  </div>;
}

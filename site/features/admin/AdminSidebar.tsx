"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "../navigation/ThemeToggle";
import type { AdminSection, AdminStats } from "./admin-types";

type NavItem = {
  section: AdminSection;
  icon: string;
  label: string;
  short?: string;
  count?: (stats: AdminStats, categoryCount: number) => number;
  dock?: boolean;
};

const NAV_GROUPS: Array<{ id: string; label: string; items: NavItem[] }> = [
  {
    id: "content",
    label: "内容",
    items: [
      { section: "browse", icon: "◉", label: "浏览", count: (stats) => stats.total + stats.privateArticles, dock: true },
      { section: "articles", icon: "▤", label: "文章", count: (stats) => stats.total, dock: true },
      { section: "spaces", icon: "◇", label: "知识空间", short: "空间", count: (stats) => stats.privateArticles, dock: true },
    ],
  },
  {
    id: "site",
    label: "站点",
    items: [
      { section: "home", icon: "⌂", label: "首页" },
      { section: "about", icon: "○", label: "关于" },
      { section: "categories", icon: "#", label: "分类", count: (_, categoryCount) => categoryCount },
    ],
  },
  {
    id: "connect",
    label: "连接",
    items: [
      { section: "connect", icon: "↗", label: "接入" },
      { section: "integrations", icon: "◎", label: "AI 连接" },
    ],
  },
];

const MORE_SECTIONS = new Set<AdminSection>(["home", "about", "categories", "connect", "integrations"]);

// The same sidebar serves personal/organization areas; no second console navigation theme.
const ACCOUNT_LINKS = [
  { href:"/workspace", icon:"◇", label:"知识空间", area:"workspace" },
  { href:"/organizations", icon:"◎", label:"组织与团队", area:"organizations" },
  { href:"/ai-connections", icon:"↗", label:"AI 连接", area:"ai-connections" },
] as const;
const EMPTY_STATS:AdminStats={total:0,published:0,drafts:0,views:0,privateArticles:0};

function NavButton({
  item,
  selected,
  stats,
  categoryCount,
  compact,
  onSelect,
}: {
  item: NavItem;
  selected: boolean;
  stats: AdminStats;
  categoryCount: number;
  compact?: boolean;
  onSelect: (section: AdminSection) => void;
}) {
  const count = item.count?.(stats, categoryCount);
  return <button
    type="button"
    data-icon={item.icon}
    title={item.label}
    className={selected ? "selected" : undefined}
    onClick={() => onSelect(item.section)}
  >
    <span>{compact && item.short ? item.short : item.label}</span>
    {count !== undefined ? <b>{count}</b> : null}
  </button>;
}

export default function AdminSidebar({
  brandName,
  avatarUrl,
  authorName,
  userName,
  section,
  stats,
  categoryCount,
  collapsed,
  onSectionChange,
  onToggle,
  onSignOut,
  accountArea,
  isLegacyAdmin=false,
}: {
  brandName: string;
  avatarUrl: string;
  authorName: string;
  userName: string;
  section?: AdminSection;
  stats?: AdminStats;
  categoryCount?: number;
  accountArea?: "workspace"|"organizations"|"ai-connections";
  isLegacyAdmin?: boolean;
  collapsed: boolean;
  onSectionChange?: (section: AdminSection) => void;
  onToggle: () => void;
  onSignOut: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreActive = !accountArea && MORE_SECTIONS.has(section??"browse");
  const dockItems = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.dock);
  const moreItems = NAV_GROUPS.flatMap((group) => group.items).filter((item) => !item.dock);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [moreOpen]);

  const select = (next: AdminSection) => {
    setMoreOpen(false);
    onSectionChange?.(next);
  };

  return <aside className="admin-sidebar">
    <div className="admin-sidebar-top">
      <Link className="brand admin-brand" href="/">
        <span className="admin-brand-full">{brandName}</span>
        <span className="admin-brand-compact">屿</span>
        <i className="admin-brand-point">。</i>
      </Link>
      <div className="admin-mobile-actions">
        <Link href="/" target="_blank" aria-label="查看前台">↗</Link>
        <button type="button" onClick={onSignOut} aria-label="安全退出">⏻</button>
      </div>
      <ThemeToggle />
    </div>
    <nav className="admin-nav-desktop">
      {accountArea ? <div className="admin-nav-block">
        <div className="admin-nav-group">协作</div>
        {ACCOUNT_LINKS.map(item=><Link key={item.area} href={item.href}
          data-icon={item.icon} title={item.label} aria-current={accountArea===item.area?"page":undefined}
          className={accountArea===item.area?"selected":undefined}><span>{item.label}</span></Link>)}
        {isLegacyAdmin?<Link data-icon="⌂" href="/admin" title="原写作后台">
          <span>原写作后台</span></Link>:null}
      </div> : NAV_GROUPS.map((group) => <div className="admin-nav-block" key={group.id}>
        <div className="admin-nav-group">{group.label}</div>
        {group.items.map((item) => <NavButton
          key={item.section}
          item={item}
          selected={section === item.section}
          stats={stats??EMPTY_STATS}
          categoryCount={categoryCount??0}
          onSelect={select}
        />)}
      </div>)}
      <Link data-icon="↗" title="查看前台" className="admin-desktop-utility" href="/" target="_blank">查看前台</Link>
      <button data-icon="⏻" title="安全退出" className="admin-desktop-utility" type="button" onClick={onSignOut}>安全退出</button>
    </nav>
    <div className="admin-more" ref={moreRef}>
      {accountArea ? <nav className="admin-dock">
        {ACCOUNT_LINKS.map(item=><Link key={item.area} href={item.href}
          aria-current={accountArea===item.area?"page":undefined}
          className={accountArea===item.area?"selected":undefined}>{item.label}</Link>)}
        <Link href="/">返回博客</Link>
      </nav> : <>
      {moreOpen ? <div className="admin-more-sheet">
        {moreItems.map((item) => <NavButton
          key={item.section}
          item={item}
          selected={section === item.section}
          stats={stats??EMPTY_STATS}
          categoryCount={categoryCount??0}
          onSelect={select}
        />)}
      </div> : null}
      <nav className="admin-dock">
        {dockItems.map((item) => <NavButton
          key={item.section}
          item={item}
          selected={section === item.section}
          stats={stats??EMPTY_STATS}
          categoryCount={categoryCount??0}
          compact
          onSelect={select}
        />)}
        <button
          type="button"
          className={moreActive || moreOpen ? "selected" : undefined}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        ><span>更多</span></button>
      </nav>
      </>}
    </div>
    <div className="admin-user">{accountArea
      ? <span aria-hidden="true">{userName.trim().slice(0,1)||"星"}</span>
      : <img src={avatarUrl} alt={`${authorName}管理员`}/>}
      <div><b>{userName}</b><small>{accountArea?"星屿账号":"管理员"}</small></div></div>
    <button className="admin-sidebar-collapse" type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? "展开管理栏" : "收起管理栏"} title={collapsed ? "展开管理栏" : "收起管理栏"}><span aria-hidden="true">{collapsed ? "›" : "‹"}</span></button>
  </aside>;
}

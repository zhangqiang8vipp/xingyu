"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CursorPost } from "@/db/queries";
import ModalPostLink from "@/features/reader/ModalPostLink";
import { CONTENT_LIMITS } from "@/domain/site/config";
import { formatLongDate, formatMonthDay, formatPublicationYear as yearOf } from "../content-utils";

type Props = {
  initialRows: CursorPost[];
  initialNextCursor: string | null;
  category: string;
  query: string;
};

export default function ArchiveExplorer({ initialRows, initialNextCursor, category, query }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [hasMore, setHasMore] = useState(Boolean(initialNextCursor));
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(initialNextCursor);
  const loadingRef = useRef(false);
  const groups = useMemo(() => groupByYear(rows), [rows]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !cursorRef.current) return;
    const controller = new AbortController();
    const observer = new IntersectionObserver(async ([entry]) => {
      const cursor = cursorRef.current;
      if (!entry.isIntersecting || !cursor || loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams({ cursor, category, q: query, limit: String(CONTENT_LIMITS.archiveBatch) });
        const response = await fetch(`/api/archive?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Archive request failed");
        const data = await response.json() as { rows: CursorPost[]; nextCursor: string | null };
        setRows((current) => {
          const known = new Set(current.map((post) => post.id));
          return [...current, ...data.rows.filter((post) => !known.has(post.id))];
        });
        cursorRef.current = data.nextCursor;
        setHasMore(Boolean(data.nextCursor));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setHasMore(false);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    }, { rootMargin: "700px 0px 500px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => { controller.abort(); observer.disconnect(); };
  }, [category, query]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-archive-post]"));
      if (!elements.length) return;
      const focusLine = window.innerHeight * 0.42;
      let closest = 0;
      let distance = Number.POSITIVE_INFINITY;
      elements.forEach((element, index) => {
        const nextDistance = Math.abs(element.getBoundingClientRect().top - focusLine);
        if (nextDistance < distance) { distance = nextDistance; closest = index; }
      });
      setActiveIndex(closest);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    frame = window.requestAnimationFrame(update);
    return () => { window.removeEventListener("scroll", onScroll); window.cancelAnimationFrame(frame); };
  }, [rows]);

  useEffect(() => {
    const rail = timelineRef.current;
    const active = rail?.querySelector<HTMLElement>(`[data-timeline-index="${activeIndex}"]`);
    if (!rail || !active) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    const comfort = Math.min(80, rail.clientHeight * 0.24);
    if (top < rail.scrollTop + comfort || bottom > rail.scrollTop + rail.clientHeight - comfort) {
      active.scrollIntoView({ block:"center", behavior:"smooth" });
    }
  }, [activeIndex, rows.length]);

  if (!rows.length) return <div className="empty-state"><b>没有找到文章</b><p>尝试更短的关键词，或者切换分类。</p></div>;

  return <>
    <aside className="archive-timeline" aria-label="文章时间轨道">
      <div className="timeline-caption"><span>NOW</span><b>{yearOf(rows[activeIndex]?.publishedAt)}</b></div>
      <div className="timeline-rail" ref={timelineRef}>
        {rows.map((post, index) => {
          const yearStart = index === 0 || yearOf(post.publishedAt) !== yearOf(rows[index - 1]?.publishedAt);
          return <button
            key={post.id}
            className={`${yearStart ? "year-start" : ""} ${index === activeIndex ? "current" : ""}`}
            data-timeline-index={index}
            aria-label={`跳转到《${post.title}》`}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
            onClick={() => {
              setActiveIndex(index);
              document.getElementById(`archive-post-${post.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />;
        })}
      </div>
      {hoveredIndex !== null && rows[hoveredIndex] && <TimelinePreview post={rows[hoveredIndex]} index={hoveredIndex} />}
      <small>PAST</small>
    </aside>

    {groups.map(([year, posts]) => <section className="archive-year" key={year}>
      <header><b>{year}</b><span>{posts.length} 篇</span></header>
      <div>{posts.map((post) => <ModalPostLink id={`archive-post-${post.id}`} data-archive-post className="archive-row" publicId={post.publicId} slug={post.slug} key={post.id}>
        <time>{formatMonthDay(post.publishedAt)}</time>
        <div><span style={{ color: post.categoryColor ?? undefined }}>{post.categoryName}</span><h2>{post.title}</h2><p>{post.excerpt}</p></div><b>↗</b>
      </ModalPostLink>)}</div>
    </section>)}

    <div className={`archive-auto-loader ${loading ? "loading" : ""}`} ref={sentinelRef} aria-live="polite">
      {loading ? <><i /><i /><i /><span>正在沿时间向前加载</span></> : hasMore ? <span>继续下滑，自动加载更早文章</span> : <><b>✦</b><span>已经抵达文章起点 · {yearOf(rows[rows.length - 1]?.publishedAt)}</span></>}
    </div>
  </>;
}

function TimelinePreview({ post, index }: { post: CursorPost; index: number }) {
  return <div className="timeline-preview">
    <div><span style={{ color: post.categoryColor ?? undefined }}>{post.categoryName}</span><time>{formatLongDate(post.publishedAt, "未定日期")}</time></div>
    <b>{post.title}</b><p>{post.excerpt}</p><small>{yearOf(post.publishedAt)} · 当前已加载第 {index + 1} 篇 · 点击定位</small>
  </div>;
}

function groupByYear(rows: CursorPost[]) {
  const groups = new Map<string, CursorPost[]>();
  rows.forEach((post) => { const year = yearOf(post.publishedAt); groups.set(year, [...(groups.get(year) ?? []), post]); });
  return [...groups.entries()];
}

"use client";

import "./quiet-island.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArticleEndMark from "./ArticleEndMark";
import IslandSearch from "../navigation/IslandSearch";
import { formatLongDate, isEditableTarget } from "@/app/content-utils";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { adminReaderHref, adminReaderSearchParams, DEFAULT_ADMIN_READER_CONTEXT, normalizeAdminReaderContext, type AdminReaderContext, type AdminReaderReturnTarget } from "@/domain/reader/admin-reader-context";

type ReaderPost = {
  id: number;
  publicId: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  publishedAt: string | null;
  viewCount: number;
  categoryName: string | null;
  categoryColor: string | null;
  status?: "draft" | "published";
  spaceId?: number | null;
  spacePath?: string | null;
};

type ReaderNeighbor = Omit<ReaderPost, "content" | "viewCount">;
type TocItem = { id: string; title: string; level: number; parentId: string | null; hasChildren: boolean };
type ReaderResponse = {
  post: ReaderPost;
  previousPost: ReaderNeighbor | null;
  nextPost: ReaderNeighbor | null;
};
type Props = {
  initialPublicId:string;
  readerScope?:"public"|"admin";
  adminReaderContext?:AdminReaderContext;
  onEdit?:(postId:number,returnTarget?:AdminReaderReturnTarget)=>void;
  onClose:()=>void;
};

export default function ModalPostReader({ initialPublicId, readerScope="public", adminReaderContext, onEdit, onClose }: Props) {
  const [activePublicId, setActivePublicId] = useState(initialPublicId);
  const [activeAdminReaderContext,setActiveAdminReaderContext]=useState(()=>normalizeAdminReaderContext(adminReaderContext));
  const [post, setPost] = useState<ReaderPost | null>(null);
  const [previousPost, setPreviousPost] = useState<ReaderNeighbor | null>(null);
  const [nextPost, setNextPost] = useState<ReaderNeighbor | null>(null);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeHeading, setActiveHeading] = useState("");
  const [tocVisible, setTocVisible] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocQuery, setTocQuery] = useState("");
  const [tocScrollTop, setTocScrollTop] = useState(0);
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(new Set());
  const [readingProgress, setReadingProgress] = useState(0);
  const [quickPreview, setQuickPreview] = useState<"previous" | "next" | null>(null);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const tocListRef = useRef<HTMLDivElement>(null);
  const quickNavRef = useRef<HTMLElement>(null);
  const quickLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickLongPressed = useRef(false);

  const resetReaderState = useCallback(() => {
    setPost(null);
    setPreviousPost(null);
    setNextPost(null);
    setTocItems([]);
    setTocQuery("");
    setTocScrollTop(0);
    setReadingProgress(0);
    setQuickPreview(null);
    setTocVisible(false);
    setError("");
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const visibleTocItems = useMemo(() => {
    const query = tocQuery.trim().toLocaleLowerCase();
    if (query) return tocItems.filter((item) => item.title.toLocaleLowerCase().includes(query));
    const itemMap = new Map(tocItems.map((item) => [item.id, item]));
    return tocItems.filter((item) => {
      let parentId = item.parentId;
      while (parentId) {
        if (collapsedHeadings.has(parentId)) return false;
        parentId = itemMap.get(parentId)?.parentId ?? null;
      }
      return true;
    });
  }, [collapsedHeadings, tocItems, tocQuery]);

  const tocWindow = useMemo(() => {
    const rowHeight = 42;
    const start = Math.max(0, Math.floor(tocScrollTop / rowHeight) - 5);
    const end = Math.min(visibleTocItems.length, start + 20);
    return { rowHeight, start, items: visibleTocItems.slice(start, end) };
  }, [tocScrollTop, visibleTocItems]);

  useEffect(() => {
    const controller = new AbortController();
    const scope=readerScope==="admin"?`?${adminReaderSearchParams(activeAdminReaderContext)}`:"";
    fetch(`/api/reader/${encodeURIComponent(activePublicId)}${scope}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("读取失败");
        const data = await response.json() as ReaderResponse;
        setPost(data.post);
        setPreviousPost(data.previousPost);
        setNextPost(data.nextPost);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
      })
      .catch((nextError) => {
        if (!(nextError instanceof DOMException && nextError.name === "AbortError")) setError("文章暂时无法打开，请稍后再试。");
      });
    return () => controller.abort();
  }, [activeAdminReaderContext, activePublicId, readerScope]);

  useEffect(() => {
    const body = document.body;
    const scrollY = window.scrollY;
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.overflow = "hidden";
    if (mobile) {
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.width = "100%";
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      if (quickLongPressTimer.current) clearTimeout(quickLongPressTimer.current);
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      if (mobile) window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    if (!post || readerScope==="admin") return;
    const timer = window.setTimeout(() => {
      const storageKey = "xingyu-reader-id";
      let visitor = localStorage.getItem(storageKey);
      if (!visitor) {
        visitor = crypto.randomUUID();
        localStorage.setItem(storageKey, visitor);
      }
      void fetch(`/api/views/${encodeURIComponent(post.publicId)}`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ visitor }),
        keepalive:true,
      });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [post, readerScope]);

  useEffect(() => {
    const scroll = scrollRef.current;
    const article = articleRef.current;
    if (!post || !scroll || !article) return;

    const headings = Array.from(article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
    const parentStack: Array<string | undefined> = [];
    const items = headings.map((heading, index) => {
      const id = `reader-${post.slug}-section-${index + 1}`;
      const level = Number(heading.tagName.slice(1));
      heading.id = id;
      const parentId = [...parentStack.slice(0, level)].reverse().find(Boolean) ?? null;
      parentStack[level] = id;
      parentStack.length = level + 1;
      return { id, title: heading.textContent?.trim() || `第 ${index + 1} 节`, level, parentId, hasChildren: false };
    });
    const parentIds = new Set(items.map((item) => item.parentId).filter(Boolean));
    items.forEach((item) => { item.hasChildren = parentIds.has(item.id); });
    setTocItems(items);
    setCollapsedHeadings(new Set(items.filter((item) => item.hasChildren).map((item) => item.id)));
    setActiveHeading(items[0]?.id ?? "");

    const update = () => {
      const hero = scroll.querySelector<HTMLElement>(".reader-hero");
      const visible = items.length > 0 && scroll.scrollTop > Math.max(170, (hero?.offsetHeight ?? 340) * 0.55);
      setTocVisible(visible);
      if (!visible) setTocOpen(false);

      const scrollRect = scroll.getBoundingClientRect();
      const articleRect = article.getBoundingClientRect();
      const articleTop = scroll.scrollTop + articleRect.top - scrollRect.top;
      const articleBottom = articleTop + articleRect.height;
      let articleStart = articleTop - 110;
      let articleEnd = articleBottom - scroll.clientHeight * 0.45;
      if (articleEnd <= articleStart) {
        articleStart = articleTop - scroll.clientHeight * 0.45;
        articleEnd = articleBottom - scroll.clientHeight * 0.45;
      }
      const progress = Math.min(1, Math.max(0, (scroll.scrollTop - articleStart) / Math.max(1, articleEnd - articleStart)));
      setReadingProgress((current) => Math.abs(current - progress) < .002 ? current : progress);

      const scrollTop = scroll.getBoundingClientRect().top;
      let current = items[0]?.id ?? "";
      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top - scrollTop <= 150) current = items[index].id;
      });
      setActiveHeading(current);
      const itemMap = new Map(items.map((item) => [item.id, item]));
      setCollapsedHeadings((collapsed) => {
        const next = new Set(collapsed);
        let parentId = itemMap.get(current)?.parentId ?? null;
        let changed = false;
        while (parentId) {
          changed = next.delete(parentId) || changed;
          parentId = itemMap.get(parentId)?.parentId ?? null;
        }
        return changed ? next : collapsed;
      });
    };

    update();
    scroll.addEventListener("scroll", update, { passive: true });
    return () => scroll.removeEventListener("scroll", update);
  }, [post]);

  useEffect(() => {
    const list = tocListRef.current;
    const index = visibleTocItems.findIndex((item) => item.id === activeHeading);
    if (!list || index < 0) return;
    const top = index * tocWindow.rowHeight;
    if (top < list.scrollTop + tocWindow.rowHeight || top > list.scrollTop + list.clientHeight - tocWindow.rowHeight * 2) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight * 0.42), behavior: "smooth" });
    }
  }, [activeHeading, tocWindow.rowHeight, visibleTocItems]);

  useEffect(() => {
    if (!quickPreview) return;
    const closeOutside = (event: PointerEvent) => {
      if (!quickNavRef.current?.contains(event.target as Node)) setQuickPreview(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setQuickPreview(null); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [quickPreview]);

  const switchPost = useCallback((neighbor: ReaderNeighbor | null) => {
    if (!neighbor) return;
    resetReaderState();
    setTocOpen(false);
    setActivePublicId(neighbor.publicId);
  }, [resetReaderState]);

  const editPost = useCallback(() => {
    if (!post || !onEdit) return;
    onClose();
    onEdit(post.id,{publicId:post.publicId,adminReaderContext:activeAdminReaderContext});
  }, [activeAdminReaderContext, onClose, onEdit, post]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft" && previousPost) {
        event.preventDefault();
        switchPost(previousPost);
      } else if (event.key === "ArrowRight" && nextPost) {
        event.preventDefault();
        switchPost(nextPost);
      } else if (event.key.toLocaleLowerCase() === "e" && readerScope === "admin" && post && onEdit) {
        event.preventDefault();
        editPost();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [editPost, nextPost, onEdit, post, previousPost, readerScope, switchPost]);

  const beginQuickLongPress = (event: React.PointerEvent, direction: "previous" | "next") => {
    if (event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    quickLongPressed.current = false;
    if (quickLongPressTimer.current) clearTimeout(quickLongPressTimer.current);
    quickLongPressTimer.current = setTimeout(() => {
      quickLongPressed.current = true;
      setQuickPreview(direction);
      navigator.vibrate?.(12);
    }, 460);
  };

  const cancelQuickLongPress = () => {
    if (quickLongPressTimer.current) clearTimeout(quickLongPressTimer.current);
    quickLongPressTimer.current = null;
  };

  const activateQuickNeighbor = (neighbor: ReaderNeighbor | null) => {
    if (quickLongPressed.current) {
      quickLongPressed.current = false;
      return;
    }
    switchPost(neighbor);
  };

  const jumpToHeading = (id: string) => {
    const scroll = scrollRef.current;
    const target = articleRef.current?.querySelector<HTMLElement>(`#${id}`);
    if (!scroll || !target) return;
    const top = scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 88;
    scroll.scrollTo({ top, behavior: "smooth" });
    setTocOpen(false);
  };

  const toggleHeading = (id: string) => {
    setCollapsedHeadings((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const returnToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setTocOpen(false);
  };

  return <div className="reader-modal" role="dialog" aria-modal="true" aria-label={post?.title ?? "正在打开文章"} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="reader-layout" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
       <section className="reader-panel">
        <header className={`reader-toolbar${readerScope==="admin"?" admin-reader-toolbar":""}`}>
          <div><i /><span>{readerScope==="admin"?"管理阅读":"沉浸阅读"}</span>{readerScope==="admin"&&post&&<b>{post.spaceId?"知识空间":post.status==="draft"?"公开草稿":"已发布"}</b>}</div>
          {post && <button className="reader-toolbar-title" type="button" onClick={returnToTop} aria-label={`${post.title}，已阅读 ${Math.round(readingProgress * 100)}%，返回文章顶部`} title="返回文章顶部"><span>{post.title}</span><i>↑</i><b>{Math.round(readingProgress * 100)}%</b></button>}
          {post && <IslandSearch variant="reader" scope={readerScope} initialText={post.title} excludeSlug={post.slug} onSelect={(result) => { resetReaderState(); setTocOpen(false); if(readerScope==="admin")setActiveAdminReaderContext(DEFAULT_ADMIN_READER_CONTEXT); setActivePublicId(result.publicId); }} />}
          {post&&readerScope==="admin"&&onEdit&&<button className="reader-toolbar-edit" type="button" onClick={editPost} title="编辑文章（E）">编辑</button>}
          <button className="reader-toolbar-close" type="button" onClick={onClose} autoFocus aria-label="关闭阅读弹窗">×</button>
          <span className="reader-toolbar-progress" style={{ "--reader-progress": readingProgress } as React.CSSProperties} aria-hidden="true" />
        </header>
        {post && <nav ref={quickNavRef} className={`reader-quick-neighbors ${readingProgress > .001 ? "visible" : ""}`} aria-label="快速切换文章" onMouseLeave={() => setQuickPreview(null)}>
          <QuickNeighbor direction="previous" post={previousPost} preview={quickPreview} setPreview={setQuickPreview} beginLongPress={beginQuickLongPress} cancelLongPress={cancelQuickLongPress} onClick={() => activateQuickNeighbor(previousPost)} onPreviewClick={() => switchPost(previousPost)} />
          <QuickNeighbor direction="next" post={nextPost} preview={quickPreview} setPreview={setQuickPreview} beginLongPress={beginQuickLongPress} cancelLongPress={cancelQuickLongPress} onClick={() => activateQuickNeighbor(nextPost)} onPreviewClick={() => switchPost(nextPost)} />
        </nav>}
        {!post && !error && <div className="reader-loading"><i /><i /><i /><span>正在展开文章</span></div>}
        {error && <div className="reader-error"><b>没有打开</b><p>{error}</p><button type="button" onClick={onClose}>返回</button></div>}
        {post && <>
          {tocItems.length > 0 && <button className={`reader-toc-toggle ${tocVisible ? "visible" : ""}`} type="button" onClick={() => setTocOpen((value) => !value)} aria-label="打开文章目录" aria-expanded={tocOpen}>目录</button>}
          <div className="reader-scroll" ref={scrollRef}>
            <header className="reader-hero"><span style={{ color:post.categoryColor ?? undefined }}>{readerScope==="admin"?(post.spaceId?post.spacePath||"知识空间":post.status==="draft"?"公开草稿":post.categoryName):post.categoryName}</span><h1>{post.title}</h1><p>{post.excerpt}</p><div><time>{formatLongDate(post.publishedAt,post.status==="draft"?"尚未发布":"未发布")}</time><i /><span>{post.viewCount.toLocaleString("zh-CN")} 阅读</span>{readerScope==="admin"&&<><i/><span>{post.spaceId?"私有知识":post.status==="draft"?"草稿":"公开文章"}</span></>}</div>{readerScope==="admin"&&<aside className="reader-admin-context"><span><i/>{post.spaceId?"仅管理员与 MCP 可见":post.status==="draft"?"尚未公开发布":"公开博客可见"}</span><b>{post.spaceId?(post.spacePath||"知识空间"):post.categoryName||"无分类"}</b><Link href={adminReaderHref(post.publicId,activeAdminReaderContext)}>独立阅读 ↗</Link>{onEdit&&<button type="button" onClick={editPost}>编辑此文 <kbd>E</kbd></button>}</aside>}</header>
            <article className="reader-prose markdown-body" ref={articleRef}><MarkdownRenderer>{post.content}</MarkdownRenderer><ArticleEndMark /></article>
            <section className="reader-neighbors" aria-label="上一篇和下一篇">
              <header><small>KEEP READING</small><h2>继续阅读</h2></header>
              <div>
                <NeighborButton direction="previous" post={previousPost} onClick={() => switchPost(previousPost)} />
                <NeighborButton direction="next" post={nextPost} onClick={() => switchPost(nextPost)} />
              </div>
            </section>
          </div>
        </>}
       </section>
      {post && tocItems.length > 0 && <aside className={`reader-toc ${tocVisible ? "visible" : ""} ${tocOpen ? "open" : ""}`} aria-label="文章目录">
        <header><span>本文目录</span><b>{tocItems.length.toLocaleString()}</b></header>
        {tocItems.length > 30 && <label className="reader-toc-search"><span>⌕</span><input value={tocQuery} onChange={(event) => { setTocQuery(event.target.value); setTocScrollTop(0); tocListRef.current?.scrollTo({ top: 0 }); }} placeholder="搜索标题" aria-label="搜索文章标题" /></label>}
        <div className="reader-toc-list" ref={tocListRef} onScroll={(event) => setTocScrollTop(event.currentTarget.scrollTop)}>
          <nav style={{ height: visibleTocItems.length * tocWindow.rowHeight }}>
            {tocWindow.items.map((item, offset) => {
              const index = tocWindow.start + offset;
              const depth = Math.max(0, item.level - Math.min(...tocItems.map((entry) => entry.level)));
              return <div className={`reader-toc-row ${activeHeading === item.id ? "active" : ""}`} key={item.id} style={{ top:index * tocWindow.rowHeight, paddingLeft:Math.min(depth, 5) * 9 }}>
                {item.hasChildren && !tocQuery ? <button className="reader-toc-fold" type="button" onClick={() => toggleHeading(item.id)} aria-label={`${collapsedHeadings.has(item.id) ? "展开" : "折叠"}${item.title}`}>{collapsedHeadings.has(item.id) ? "›" : "⌄"}</button> : <i />}
                <button className="reader-toc-jump" type="button" onClick={() => jumpToHeading(item.id)} title={item.title}><small>{String(index + 1).padStart(2, "0")}</small><span>{item.title}</span></button>
              </div>;
            })}
          </nav>
        </div>
        <footer><span>显示 {visibleTocItems.length.toLocaleString()} / {tocItems.length.toLocaleString()}</span>{tocItems.some((item) => item.hasChildren) && <button type="button" onClick={() => setCollapsedHeadings((current) => current.size ? new Set() : new Set(tocItems.filter((item) => item.hasChildren).map((item) => item.id)))}>{collapsedHeadings.size ? "全部展开" : "全部折叠"}</button>}</footer>
       </aside>}
      </div>
    </div>;
}

function NeighborButton({ direction, post, onClick }: { direction: "previous" | "next"; post: ReaderNeighbor | null; onClick: () => void }) {
  const previous = direction === "previous";
  return <button className={`reader-neighbor ${direction} ${post ? "" : "unavailable"}`} type="button" onClick={onClick} disabled={!post} style={post?.categoryColor ? { "--reader-neighbor-color": post.categoryColor } as React.CSSProperties : undefined}>
    <span>{previous ? "←  上一篇" : "下一篇  →"}</span>
    {post ? <><small>{post.categoryName}</small><b>{post.title}</b><p>{post.excerpt}</p><time>{formatLongDate(post.publishedAt)}</time></> : <><small>时间边界</small><b>{previous ? "已经是最新一篇" : "已经读到最早一篇"}</b><p>{previous ? "从这里继续阅读当下。" : "感谢你沿着时间读到这里。"}</p></>}
  </button>;
}

function QuickNeighbor({ direction, post, preview, setPreview, beginLongPress, cancelLongPress, onClick, onPreviewClick }: {
  direction: "previous" | "next";
  post: ReaderNeighbor | null;
  preview: "previous" | "next" | null;
  setPreview: (direction: "previous" | "next" | null) => void;
  beginLongPress: (event: React.PointerEvent, direction: "previous" | "next") => void;
  cancelLongPress: () => void;
  onClick: () => void;
  onPreviewClick: () => void;
}) {
  const previous = direction === "previous";
  const open = preview === direction && post;
  return <div className={`reader-quick-item ${direction}`} onMouseEnter={() => { if (post) setPreview(direction); }} onFocus={() => { if (post) setPreview(direction); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }}>
    <button className="reader-quick-trigger" type="button" onClick={onClick} disabled={!post} onPointerDown={(event) => beginLongPress(event, direction)} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onContextMenu={(event) => event.preventDefault()} title={post?.title ?? (previous ? "已经是最新一篇" : "已经是最早一篇")} aria-label={`${previous ? "上一篇" : "下一篇"}${post ? `：${post.title}` : "：没有更多文章"}`} aria-expanded={Boolean(open)}>
      <i>{previous ? "←" : "→"}</i><span>{previous ? "上一篇" : "下一篇"}</span>
    </button>
    {open && <div className="reader-quick-preview" style={{ "--preview-color": post.categoryColor ?? "#0071e3" } as React.CSSProperties}>
      <button className="reader-quick-preview-close" type="button" onClick={() => setPreview(null)} aria-label="关闭预览">×</button>
      <button className="reader-quick-preview-open" type="button" onClick={onPreviewClick}>
        <small><i />{post.categoryName}</small><b>{post.title}</b><p>{post.excerpt}</p><footer><time>{formatLongDate(post.publishedAt)}</time><span>弹窗内阅读 ↗</span></footer>
      </button>
    </div>}
  </div>;
}

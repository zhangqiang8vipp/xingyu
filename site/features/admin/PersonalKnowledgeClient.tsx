"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ChangeEvent } from "react";
import styles from "./PersonalKnowledgeClient.module.css";

type PostItem = {
  id: number;
  publicId: string;
  title: string;
  slug: string;
  excerpt?: string;
  content?: string;
  status: "draft" | "published";
  version: number;
  spaceId: number | null;
  updatedAt: string;
  publishedAt?: string | null;
  visibility?: "personal" | "public";
  canEdit?: boolean;
  publicUrl?: string;
};
type FileItem = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  articlePublicId: string;
  articleTitle: string;
  articleSlug: string;
  visibility: "personal" | "public";
  url: string;
};
type ApiPayload = {
  error?: string;
  posts?: PostItem[];
  files?: FileItem[];
  post?: PostItem;
  workspaceId?: number;
  nextCursor?: string | null;
};

async function api(path: string, init?: RequestInit): Promise<ApiPayload> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const data = await response.json().catch(() => ({})) as ApiPayload;
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function formatBytes(size: number) {
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

export default function PersonalKnowledgeClient({ userName }: { userName: string }) {
  const [tab, setTab] = useState<"mine" | "public" | "files">("mine");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [mine, setMine] = useState<PostItem[]>([]);
  const [publicPosts, setPublicPosts] = useState<PostItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState<number | null>(null);
  const [selected, setSelected] = useState<PostItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (search: string) => {
    setLoading(true);
    setError("");
    try {
      const suffix = "&q=" + encodeURIComponent(search);
      const [mineData, publicData, fileData] = await Promise.all([
        api("/api/knowledge/posts?type=mine&limit=50" + suffix),
        api("/api/knowledge/posts?type=public&limit=50" + suffix),
        api("/api/knowledge/files?limit=100&q=" + encodeURIComponent(search)),
      ]);
      setMine(mineData.posts ?? []);
      setPublicPosts(publicData.posts ?? []);
      setFiles(fileData.files ?? []);
      setWorkspaceId(mineData.workspaceId ?? publicData.workspaceId ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "知识空间加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(appliedQuery); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, appliedQuery]);

  async function openPost(item: PostItem) {
    setBusy(true);
    setError("");
    setNotice("");
    setIsNew(false);
    try {
      const data = await api("/api/knowledge/posts/" + encodeURIComponent(item.publicId));
      if (!data.post) throw new Error("文章不存在或无权访问");
      setSelected(data.post);
      setTitle(data.post.title);
      setExcerpt(data.post.excerpt ?? "");
      setContent(data.post.content ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取文章失败");
    } finally {
      setBusy(false);
    }
  }

  function newDraft() {
    setTab("mine");
    setSelected(null);
    setIsNew(true);
    setTitle("");
    setExcerpt("");
    setContent("");
    setNotice("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) { setError("请输入文章标题"); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = isNew
        ? await api("/api/knowledge/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, excerpt, content_markdown: content }),
          })
        : selected?.visibility === "personal"
          ? await api("/api/knowledge/posts/" + encodeURIComponent(selected.publicId), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expected_version: selected.version,
                title,
                excerpt,
                content_markdown: content,
              }),
            })
          : null;
      if (!data?.post) throw new Error("公开文章不可编辑；只有自己的文章可以保存");
      setSelected(data.post);
      setIsNew(false);
      setTitle(data.post.title);
      setExcerpt(data.post.excerpt ?? "");
      setContent(data.post.content ?? "");
      setNotice("已保存到个人知识空间，仅自己可见。公开首页不会因此改变。");
      await load(appliedQuery);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!workspaceId || !selected || selected.visibility !== "personal" || isNew) {
      setError("请先保存草稿，再为这篇文章上传附件");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("post_identifier", selected.publicId);
      const response = await fetch("/api/workspaces/" + workspaceId + "/attachments", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        attachment?: { filename: string; content_type: string; url: string };
      };
      if (!response.ok || !data.attachment) throw new Error(data.error || "附件上传失败");
      const attachment = data.attachment;
      const snippet = attachment.content_type.startsWith("image/")
        ? "![" + attachment.filename + "](" + attachment.url + ")"
        : "[" + attachment.filename + "](" + attachment.url + ")";
      setContent((previous) => previous + (previous && !previous.endsWith("\n") ? "\n" : "") + "\n" + snippet + "\n");
      setNotice("附件已上传；保存文章后，附件链接才会写入正文。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "附件上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/identity/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("退出失败，请重试");
      window.location.replace("/login?return_to=%2Fadmin");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "退出失败");
    } finally {
      setBusy(false);
    }
  }

  const items = tab === "mine" ? mine : publicPosts;
  const editable = isNew || selected?.visibility === "personal";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="返回星屿首页">星屿<span>知识空间</span></Link>
        <div className={styles.account}>
          <span>{userName}</span>
          <button type="button" onClick={() => void signOut()} disabled={busy}>退出登录</button>
        </div>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>PERSONAL KNOWLEDGE</p>
        <h1>我的知识空间</h1>
        <p>自己的文章只有自己可以编辑；公开文章和公开附件可以阅读。站点设置与首页发布由管理员管理。</p>
        <div className={styles.heroActions}>
          <button type="button" className={styles.primaryButton} onClick={newDraft}>＋ 新建私人草稿</button>
          <Link href="/" className={styles.secondaryLink}>浏览公开首页 ↗</Link>
        </div>
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <section className={styles.layout}>
        <aside className={styles.library}>
          <div className={styles.tabs} role="tablist" aria-label="内容范围">
            <button type="button" role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? styles.activeTab : ""}
              onClick={() => { setTab("mine"); setSelected(null); setIsNew(false); }}>我的文章 <span>{mine.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === "public"} className={tab === "public" ? styles.activeTab : ""}
              onClick={() => { setTab("public"); setSelected(null); setIsNew(false); }}>公开文章 <span>{publicPosts.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === "files"} className={tab === "files" ? styles.activeTab : ""}
              onClick={() => { setTab("files"); setSelected(null); setIsNew(false); }}>文件 <span>{files.length}</span></button>
          </div>
          <form className={styles.search} onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或摘要" aria-label="搜索文章"/>
            <button type="submit">搜索</button>
          </form>
          <div className={styles.listHeading}>{tab === "mine" ? "仅自己可见" : tab === "public" ? "所有人可读" : "本人附件与公开附件"}</div>
          {loading ? <p className={styles.empty}>正在加载内容…</p> : tab === "files"
            ? files.length === 0
              ? <p className={styles.empty}>暂时没有匹配的文件。附件仅显示本人文章中的文件和公开文章中的文件。</p>
              : <ul className={styles.postList}>
                  {files.map((file) => <li key={file.id}>
                    <Link className={styles.fileLink} href={file.url} target="_blank" rel="noreferrer">
                      <strong>{file.filename}</strong>
                      <span>{file.visibility === "public" ? "公开文件" : "我的文件"} · {file.articleTitle}</span>
                      <small>{file.contentType} · {formatBytes(file.size)}</small>
                    </Link>
                  </li>)}
                </ul>
            : items.length === 0
              ? <p className={styles.empty}>{tab === "mine" ? "这里还没有文章。新建一篇私人草稿吧。" : "暂时没有匹配的公开文章。"}</p>
              : <ul className={styles.postList}>
                  {items.map((item) => <li key={item.publicId}>
                    <button type="button" className={selected?.publicId === item.publicId && !isNew ? styles.selectedPost : styles.postButton}
                      onClick={() => void openPost(item)}>
                      <strong>{item.title}</strong>
                      <span>{tab === "public" ? "公开文章" : item.status === "draft" ? "私人草稿" : "已完成 · 仍为私密"}</span>
                      {item.excerpt && <small>{item.excerpt}</small>}
                    </button>
                  </li>)}
                </ul>}
        </aside>

        <section className={styles.editor}>
          {isNew || selected
            ? <form onSubmit={(event) => void save(event)} className={styles.editorForm}>
                <div className={styles.editorTop}>
                  <div>
                    <p className={styles.eyebrow}>{isNew ? "NEW PRIVATE NOTE" : selected?.visibility === "public" ? "PUBLIC ARTICLE" : "YOUR PRIVATE NOTE"}</p>
                    <h2>{isNew ? "新建私人草稿" : selected?.visibility === "public" ? "阅读公开文章" : "编辑自己的文章"}</h2>
                  </div>
                  {selected?.visibility === "public" && selected.publicUrl && <a className={styles.secondaryLink} href={selected.publicUrl} target="_blank" rel="noreferrer">打开公开页面 ↗</a>}
                </div>
                <label className={styles.fieldLabel}>标题
                  <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required disabled={!editable || busy}/>
                </label>
                <label className={styles.fieldLabel}>摘要
                  <textarea value={excerpt} onChange={(event) => setExcerpt(event.target.value)} rows={2} maxLength={1000} disabled={!editable || busy}/>
                </label>
                <label className={styles.fieldLabel}>正文（Markdown）
                  {editable
                    ? <textarea className={styles.contentEditor} value={content} onChange={(event) => setContent(event.target.value)} rows={18} maxLength={750000} disabled={busy}/>
                    : <pre className={styles.readOnlyContent}>{content}</pre>}
                </label>
                <div className={styles.editorBottom}>
                  {editable
                    ? <div className={styles.editorActions}>
                        <button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? "保存中…" : isNew ? "创建私人草稿" : "保存修改"}</button>
                        {!isNew && <label className={styles.uploadButton}>上传附件<input type="file" onChange={(event) => void upload(event)} disabled={busy}/></label>}
                      </div>
                    : <p className={styles.readOnlyNote}>公开文章只读。你可以阅读和下载公开附件，但不能修改或撤回别人的文章。</p>}
                  {selected?.visibility === "personal" && <span className={styles.version}>版本 {selected.version}</span>}
                </div>
              </form>
            : <div className={styles.welcome}>
                <div className={styles.welcomeMark}>✳</div>
                <h2>把想法留在自己的空间</h2>
                <p>选择一篇文章开始阅读，或创建私人草稿。私人文章不会出现在公开首页；只有管理员可以管理站点和发布公开内容。</p>
                <button type="button" className={styles.primaryButton} onClick={newDraft}>新建私人草稿</button>
              </div>}
        </section>
      </section>
    </main>
  );
}

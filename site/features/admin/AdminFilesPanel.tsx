"use client";

import { useCallback, useEffect, useState } from "react";
import { readApiJson } from "@/app/api-response";

type FileItem = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  articlePublicId: string;
  articleTitle: string;
  articleSlug: string;
  visibility: "personal" | "public" | "private";
  url: string;
};

function formatBytes(size: number) {
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

export default function AdminFilesPanel({ isPersonalAccount = false }: { isPersonalAccount?: boolean }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ limit: "100", q: appliedQuery });
      const response = await fetch("/api/knowledge/files?" + params, { signal, cache: "no-store" });
      const data = await readApiJson<{ files: FileItem[] }>(response);
      if (!response.ok) throw new Error("文件列表读取失败");
      if (!signal?.aborted) setFiles(data.files ?? []);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage(error instanceof Error ? error.message : "文件列表读取失败");
        setFiles([]);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [appliedQuery, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  return <section className="admin-main axis-admin-list-page">
    <header className="admin-header">
      <div>
        <p>FILES</p>
        <h1>文件管理</h1>
        <span>{isPersonalAccount ? "仅显示自己文章的附件和公开文章的附件。" : "查看站点和知识内容关联的附件。"}</span>
      </div>
    </header>
    {message && <p className="form-message" role="alert">{message} <button className="axis-inline-retry" type="button" onClick={()=>setRevision(value=>value+1)}>重试</button></p>}
    <div className="table-tools">
      <form className="admin-search" onSubmit={(event) => { event.preventDefault(); setAppliedQuery(query.trim()); }}>
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名或文章标题" aria-label="搜索文件"/>
        <button type="submit" disabled={loading}>搜索</button>
      </form>
      <div className="axis-file-utilities" role="group" aria-label="文件列表操作">
        {(query||appliedQuery)&&<button type="button" onClick={()=>{
          setQuery("");
          if(appliedQuery)setAppliedQuery("");
          else setRevision(value=>value+1);
        }}>清除搜索</button>}
        <button type="button" disabled={loading} onClick={()=>setRevision(value=>value+1)}
          aria-label="刷新文件列表">{loading?"正在读取…":"刷新"}</button>
        <span role="status">{loading?"正在读取文件…":message?"读取未完成":`已显示 ${files.length} 个文件 · 最多 100 个`}</span>
      </div>
    </div>
    <div className="table-wrap">
      <table aria-label="站点与知识空间附件">
        <thead><tr><th>文件</th><th>关联文章</th><th>范围</th><th>大小</th><th>添加时间</th><th>操作</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={6} className="table-empty">正在读取文件…</td></tr>
            : files.length === 0 ? <tr><td colSpan={6} className="table-empty">{message?"文件读取失败，请使用上方重试按钮":appliedQuery?"当前搜索没有匹配的文件":"还没有附件；上传文章图片后可在这里管理"}</td></tr>
            : files.map((file) => <tr key={file.id}>
              <td data-label="文件"><div className="title-cell"><span>↗</span><div><b>{file.filename}</b><small>{file.contentType}</small></div></div></td>
              <td data-label="文章"><b>{file.articleTitle}</b></td>
              <td data-label="范围">{file.visibility === "public" ? "公开文件" : file.visibility === "personal" ? "我的文件" : "私有文件"}</td>
              <td data-label="大小">{formatBytes(file.size)}</td>
              <td data-label="添加时间">{file.createdAt ? new Date(file.createdAt).toLocaleDateString("zh-CN") : "—"}</td>
              <td data-label="操作"><div className="row-actions"><a href={file.url} target="_blank" rel="noreferrer">打开</a><a href={file.url} download>下载</a></div></td>
            </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

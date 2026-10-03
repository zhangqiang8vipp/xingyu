"use client";

import { useRef, useState } from "react";
import { readApiJson } from "@/app/api-response";
import { KNOWLEDGE_IMPORT_MAX_ITEMS } from "@/domain/knowledge-import";

type ServerImportResponse = {
  summary: { total: number; imported: number; failed: number };
  results: Array<
    | { index: number; name: string; status: "imported" }
    | { index: number; name: string; status: "error"; error: { code: string; message: string } }
  >;
};

type ImportErrorRow = { name: string; message: string };
type ImportReport = {
  total: number;
  imported: number;
  failed: number;
  errors: ImportErrorRow[];
};

export default function AdminKnowledgeImport({
  spaceId,
  spaceName,
}: {
  spaceId: number;
  spaceName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  async function importFiles(files: File[]) {
    if (!files.length) return;
    if (files.length > KNOWLEDGE_IMPORT_MAX_ITEMS) {
      setReport({
        total: files.length,
        imported: 0,
        failed: files.length,
        errors: [{
          name: "本次选择",
          message: `一次最多选择 ${KNOWLEDGE_IMPORT_MAX_ITEMS} 个文件，请分批重试。`,
        }],
      });
      resetInput();
      return;
    }

    setBusy(true);
    setReport(null);
    const items: Array<{ name: string; content: string }> = [];
    const readErrors: ImportErrorRow[] = [];

    try {
      for (const file of files) {
        try {
          items.push({ name: file.name, content: await file.text() });
        } catch {
          readErrors.push({
            name: file.name,
            message: "浏览器无法读取该文件，请检查文件权限后重新选择。",
          });
        }
      }

      let imported = 0;
      const serverErrors: ImportErrorRow[] = [];
      if (items.length) {
        const response = await fetch(`/api/spaces/${spaceId}/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const data = await readApiJson<ServerImportResponse>(response);

        if (!response.ok) {
          const message = data.error ?? "导入请求失败，请刷新空间后重试。";
          for (const item of items) serverErrors.push({ name: item.name, message });
        } else {
          imported = data.summary?.imported ?? 0;
          for (const result of data.results ?? []) {
            if (result.status === "error") {
              serverErrors.push({ name: result.name, message: result.error.message });
            }
          }
        }
      }

      const errors = [...readErrors, ...serverErrors];
      setReport({
        total: files.length,
        imported,
        failed: errors.length,
        errors,
      });
      if (imported > 0) window.dispatchEvent(new Event("xingyu:spaces-changed"));
    } catch {
      setReport({
        total: files.length,
        imported: 0,
        failed: files.length,
        errors: [{
          name: "本次导入",
          message: "请求状态未知，请刷新空间列表确认；重试时不会覆盖已经存在的文章。",
        }],
      });
    } finally {
      setBusy(false);
      resetInput();
    }
  }

  return <div className="knowledge-import">
    <input
      ref={inputRef}
      type="file"
      multiple
      accept=".md,.markdown,.txt,text/plain,text/markdown"
      onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        if (files.length) void importFiles(files);
      }}
    />
    <button
      type="button"
      disabled={busy}
      title={`导入到“${spaceName}”`}
      onClick={() => inputRef.current?.click()}
    >
      {busy ? "正在导入…" : "⇧ 导入 Markdown / Text"}
    </button>
    {report && <aside className="knowledge-import-report" role="status">
      <header>
        <div>
          <small>PRIVATE IMPORT</small>
          <b>{report.imported > 0 ? `已导入 ${report.imported} / ${report.total} 篇` : "本次没有导入新内容"}</b>
        </div>
        <button type="button" aria-label="关闭导入结果" onClick={() => setReport(null)}>×</button>
      </header>
      <p>文件名（去扩展名）作为标题，正文原样保存；所有成功项都留在当前知识空间的私有草稿中，不会发布。重复项不会覆盖已有文章。</p>
      {report.errors.length > 0
        ? <ul>{report.errors.map((error, index) => <li key={`${error.name}-${index}`}><b>{error.name}</b><span>{error.message}</span></li>)}</ul>
        : <div className="knowledge-import-ok">全部文件已写入当前知识空间。</div>}
    </aside>}
  </div>;
}

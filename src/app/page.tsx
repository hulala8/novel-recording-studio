"use client";

import { useState, useRef } from "react";
import { useProjects } from "@/hooks/useIndexedDB";
import DocUploader from "@/components/upload/DocUploader";
import Link from "next/link";
import { exportProjectToZip, importProjectFromZip, sanitizeFilename } from "@/lib/export-import";
import { downloadBlob } from "@/lib/audio-utils";
import type { ImportProgress } from "@/lib/types";

export default function Home() {
  const { projects, loading, createProject, removeProject, loadProjects } =
    useProjects();
  const [newName, setNewName] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [importStatus, setImportStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null
  );
  const [duplicateConflict, setDuplicateConflict] = useState<{
    id: string;
    name: string;
    file: File;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const project = await createProject(name);
    setNewName("");
    window.location.href = `/studio/${project.id}`;
  }

  // Export project as .novel file
  async function handleExport(p: { id: string; name: string }) {
    try {
      const zipBlob = await exportProjectToZip(p.id);
      const filename = `${sanitizeFilename(p.name)}.novel`;
      downloadBlob(zipBlob, filename);
    } catch (err) {
      alert(`导出失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  }

  // Import project from .novel file
  async function handleImport(file: File, mode: "error" | "replace" | "copy" = "error") {
    setDuplicateConflict(null);
    setImportStatus("loading");
    setImportError(null);
    setImportProgress(null);

    try {
      const projectId = await importProjectFromZip(file, setImportProgress, mode);
      await loadProjects();
      setImportStatus("idle");
      // Optionally navigate to imported project
      // window.location.href = `/studio/${projectId}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      if (msg.startsWith("DUPLICATE:")) {
        const parts = msg.split(":");
        setDuplicateConflict({ id: parts[1], name: parts.slice(2).join(":"), file });
        setImportStatus("idle");
        return;
      }
      setImportError(msg);
      setImportStatus("error");
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".novel")) {
      alert("请选择 .novel 文件");
      return;
    }
    handleImport(file);
    // Reset file input so the same file can be re-selected
    e.target.value = "";
  }

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 flex flex-col p-4 gap-3">
        <h1 className="text-lg font-bold tracking-tight">
          🎙️ 小说录音工作室
        </h1>

        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="新建项目名称..."
            className="flex-1 px-3 py-1.5 text-sm rounded-md bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:outline-none placeholder:text-zinc-500"
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-md font-medium transition-colors"
          >
            创建
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-zinc-500">加载中...</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-zinc-500">
              暂无项目。创建一个项目开始录制吧。
            </p>
          ) : (
            <ul className="space-y-1">
              {projects.map((p) => (
                <li key={p.id} className="group flex items-center gap-1">
                  <Link
                    href={`/studio/${p.id}`}
                    className="flex-1 px-3 py-2 text-sm rounded-md hover:bg-zinc-800 transition-colors truncate"
                  >
                    {p.name}
                  </Link>
                  <button
                    onClick={() => handleExport(p)}
                    className="px-1.5 py-1 text-xs text-zinc-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="导出项目 (.novel)"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeProject(p.id)}
                    className="px-1.5 py-1 text-xs text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="删除项目"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        {/* Import button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".novel"
          className="hidden"
          onChange={handleFileSelect}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importStatus === "loading"}
          className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
        >
          📥 导入项目 (.novel)
        </button>

        <button
          onClick={() => setShowUpload(!showUpload)}
          className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {showUpload ? "收起上传" : "📄 上传 Word 文档"}
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        {/* Import progress overlay */}
        {importStatus === "loading" && (
          <div className="fixed inset-0 bg-zinc-950/80 flex flex-col items-center justify-center gap-3 z-50">
            <div className="animate-spin text-2xl">⏳</div>
            <span className="text-zinc-200 text-sm">
              {importProgress?.step === "parsing"
                ? "正在解析文件..."
                : importProgress?.step === "importing_recordings"
                ? `正在导入录音 (${importProgress.current}/${importProgress.total})...`
                : "正在保存到数据库..."}
            </span>
          </div>
        )}

        {/* Duplicate project conflict */}
        {duplicateConflict && (
          <div className="fixed inset-0 bg-zinc-950/80 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-sm mx-4 shadow-xl">
              <p className="text-sm text-zinc-200 mb-2 font-medium">
                项目「{duplicateConflict.name}」已存在
              </p>
              <p className="text-xs text-zinc-400 mb-4">
                请选择导入方式：
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleImport(duplicateConflict.file, "replace")}
                  className="w-full py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-md transition-colors"
                >
                  覆盖现有项目
                </button>
                <button
                  onClick={() => handleImport(duplicateConflict.file, "copy")}
                  className="w-full py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
                >
                  导入为副本（新建 ID）
                </button>
                <button
                  onClick={() => setDuplicateConflict(null)}
                  className="w-full py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-md transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import error */}
        {importStatus === "error" && importError && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm z-50 max-w-md shadow-lg">
            <p className="font-medium mb-1">导入失败</p>
            <p className="text-xs text-red-300">{importError}</p>
            <button
              onClick={() => setImportStatus("idle")}
              className="mt-2 text-xs underline hover:text-white"
            >
              关闭
            </button>
          </div>
        )}

        {showUpload ? (
          <DocUploader
            onProjectCreated={(projectId) => {
              window.location.href = `/studio/${projectId}`;
            }}
          />
        ) : (
          <div className="text-center max-w-md">
            <p className="text-6xl mb-6">🎙️</p>
            <h2 className="text-2xl font-bold mb-3">欢迎使用小说录音工作室</h2>
            <p className="text-zinc-400 mb-6 leading-relaxed">
              上传 Word 小说文档，AI 自动识别角色，分音轨录制人声，最终导出 MP3 有声小说。
            </p>
            <div className="flex gap-3 justify-center text-sm text-zinc-500">
              <span>📄 导入文档</span>
              <span>→</span>
              <span>🤖 AI 角色识别</span>
              <span>→</span>
              <span>🎤 分角色录制</span>
              <span>→</span>
              <span>📦 导出 MP3</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

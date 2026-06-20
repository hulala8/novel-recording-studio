"use client";

import { useState, useCallback, useRef } from "react";
import { useProjects } from "@/hooks/useIndexedDB";
import * as db from "@/lib/db";
import { normalizeRoleName } from "@/lib/role-name-utils";
import type { Segment, RawSegment, Role, Chapter } from "@/lib/types";

interface DocUploaderProps {
  onProjectCreated: (projectId: string) => void;
}

const PRESET_COLORS = [
  "#EF4444", "#3B82F6", "#10B981", "#F59E0B",
  "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
  "#84CC16", "#14B8A6", "#E11D48", "#A855F7",
];

export default function DocUploader({ onProjectCreated }: DocUploaderProps) {
  const [stage, setStage] = useState<
    "upload" | "parsing" | "segmenting" | "identifying" | "review" | "error"
  >("upload");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [chapterTitle, setChapterTitle] = useState("第1章");
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);

  // Review state
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
  const [filterRole, setFilterRole] = useState<string>("unlabeled");
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRoleName, setEditingRoleName] = useState("");
  const [showNewRole, setShowNewRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState(PRESET_COLORS[0]);
  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null);

  const { createProject } = useProjects();

  const handleFile = useCallback(
    async (file: File) => {
      fileRef.current = file;
      setError(null);
      setStage("parsing");

      try {
        const autoName =
          projectName.trim() || file.name.replace(/\.(docx|doc)$/i, "");
        const project = await createProject(autoName);
        const pid = project.id;
        setProjectId(pid);

        const formData = new FormData();
        formData.append("file", file);
        const parseRes = await fetch("/api/parse-docx", {
          method: "POST",
          body: formData,
        });
        const parseData = await parseRes.json();
        if (!parseData.success) {
          setError(parseData.error || "Failed to parse document");
          setStage("error");
          return;
        }

        setStage("segmenting");
        const segRes = await fetch("/api/segment-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: parseData.text }),
        });
        const segData = await segRes.json();
        if (!segData.success) {
          setError(segData.error || "Failed to segment text");
          setStage("error");
          return;
        }
        const rawSegments: RawSegment[] = segData.segments;

        setStage("identifying");
        const roleRes = await fetch("/api/identify-roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: rawSegments, rawText: parseData.text }),
        });
        const roleData = await roleRes.json();
        if (!roleData.success) {
          setError(roleData.error || "Failed to identify roles");
          setStage("error");
          return;
        }

        const newRoles: Role[] = roleData.roles.map(
          (r: { name: string; color: string }) => ({
            id: crypto.randomUUID(),
            projectId: pid,
            name: r.name,
            color: r.color,
          })
        );
        await db.saveRoles(newRoles);
        setRoles(newRoles);

        const chapter: Chapter = {
          id: crypto.randomUUID(),
          projectId: pid,
          title: chapterTitle || "第1章",
          order: 0,
          segments: [],
        };
        await db.saveChapter(chapter);

        const newSegments: Segment[] = rawSegments.map((raw: RawSegment) => {
          const roleAssignment = roleData.segmentRoles.find(
            (sr: { segmentIndex: number }) => sr.segmentIndex === raw.index
          );
          const roleName = normalizeRoleName(roleAssignment?.roleName || "旁白");
          const role = newRoles.find((r) => r.name === roleName);
          return {
            id: crypto.randomUUID(),
            chapterId: chapter.id,
            text: raw.text,
            roleId: role?.id || newRoles[0]?.id || "",
            roleName,
            index: raw.index,
          };
        });
        await db.saveSegments(newSegments);
        setSegments(newSegments);
        setStage("review");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
        setStage("error");
      }
    },
    [projectName, chapterTitle, createProject]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  function handleRoleChange(segmentId: string, newRoleName: string, newRoleId: string) {
    setSegments((prev) =>
      prev.map((s) =>
        s.id === segmentId ? { ...s, roleName: newRoleName, roleId: newRoleId } : s
      )
    );
  }

  // -------- Batch operations --------

  function toggleSegment(segId: string, index: number, shiftKey: boolean) {
    setSelectedSegments((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIndex !== null) {
        // Range select
        const [lo, hi] = [Math.min(lastCheckedIndex, index), Math.max(lastCheckedIndex, index)];
        for (let i = lo; i <= hi; i++) {
          const s = segments.find((seg) => seg.index === i);
          if (s) next.add(s.id);
        }
      } else if (next.has(segId)) {
        next.delete(segId);
      } else {
        next.add(segId);
      }
      return next;
    });
    setLastCheckedIndex(index);
  }

  function batchReassign(roleId: string, roleName: string) {
    if (selectedSegments.size === 0) return;
    setSegments((prev) =>
      prev.map((s) =>
        selectedSegments.has(s.id) ? { ...s, roleId, roleName } : s
      )
    );
    setSelectedSegments(new Set());
  }

  async function handleAddRole() {
    const name = newRoleName.trim();
    if (!name || roles.some((r) => r.name === name)) return;
    const newRole: Role = {
      id: crypto.randomUUID(),
      projectId: projectId!,
      name,
      color: newRoleColor,
    };
    const updatedRoles = [...roles, newRole];
    setRoles(updatedRoles);
    // Auto-assign selected segments to new role
    if (selectedSegments.size > 0) {
      batchReassign(newRole.id, name);
    }
    setNewRoleName("");
    setShowNewRole(false);
  }

  async function handleRenameRole(roleId: string) {
    const newName = editingRoleName.trim();
    if (!newName) { setEditingRoleId(null); return; }
    if (!projectId) return;

    await db.renameRole(roleId, projectId, newName);
    setRoles((prev) => prev.map((r) => r.id === roleId ? { ...r, name: newName } : r));
    setSegments((prev) =>
      prev.map((s) => (s.roleId === roleId ? { ...s, roleName: newName } : s))
    );
    setEditingRoleId(null);
  }

  async function handleDeleteRole(roleId: string, roleName: string) {
    if (!projectId) return;
    await db.deleteRoleAndReassignToNarrator(roleId, roleName, projectId);
    setRoles((prev) => prev.filter((r) => r.id !== roleId));
    // Find narrator id
    const narrator = roles.find((r) => r.name === "旁白");
    setSegments((prev) =>
      prev.map((s) =>
        s.roleId === roleId
          ? { ...s, roleId: narrator?.id || "", roleName: "旁白" }
          : s
      )
    );
  }

  async function handleConfirm() {
    await db.saveSegments(segments);
    await db.saveRoles(roles);
    if (projectId) {
      onProjectCreated(projectId);
    }
  }

  // -------- Computed stats --------
  // Type metadata is not stored after review conversion, so use quotes as a heuristic.
  // Match Chinese curly quotes, corner brackets, AND ASCII straight double quotes
  const dialogueLike = (text: string) => /[""「」『』"“”]/.test(text);
  const unlabeledSegments = segments.filter(
    (s) => dialogueLike(s.text) && s.roleName === "旁白"
  );
  const narratorCount = segments.filter((s) => s.roleName === "旁白").length;
  const dialogueTotal = segments.filter((s) => dialogueLike(s.text)).length;

  const filteredSegments =
    filterRole === "all"
      ? segments
      : filterRole === "unlabeled"
        ? unlabeledSegments
        : segments.filter((s) => s.roleId === filterRole);

  const roleColors = Object.fromEntries(roles.map((r) => [r.id, r.color]));

  // ---- Error view ----
  if (stage === "error") {
    return (
      <div className="max-w-lg mx-auto text-center">
        <p className="text-red-400 mb-4">处理出错：{error}</p>
        <button
          onClick={() => setStage("upload")}
          className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-md text-sm"
        >
          重新上传
        </button>
      </div>
    );
  }

  // ---- Loading view ----
  if (stage === "parsing" || stage === "segmenting" || stage === "identifying") {
    const labels: Record<string, string> = {
      parsing: "正在解析 Word 文档...",
      segmenting: "正在智能分段...",
      identifying: "AI 正在识别角色...",
    };
    return (
      <div className="max-w-lg mx-auto text-center">
        <div className="animate-spin text-4xl mb-4">⏳</div>
        <p className="text-zinc-300 text-lg">{labels[stage]}</p>
      </div>
    );
  }

  // ---- Review view ----
  if (stage === "review") {
    return (
      <div className="w-full max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">人工校对 — 确认角色标注</h2>
          <button
            onClick={handleConfirm}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-md font-medium text-sm"
          >
            确认，进入录音工作室
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex gap-4 mb-3 text-xs text-zinc-400 bg-zinc-900 rounded-md px-3 py-2 border border-zinc-800">
          <span>共 <b className="text-zinc-200">{segments.length}</b> 段</span>
          <span>旁白 <b className="text-zinc-200">{narratorCount}</b> 段</span>
          <span>对话 <b className="text-zinc-200">{dialogueTotal}</b> 段</span>
          {unlabeledSegments.length > 0 && (
            <span className="text-amber-400 font-medium">
              ⚠ {unlabeledSegments.length} 段对话未标注角色
            </span>
          )}
        </div>

        {/* Role filter tabs */}
        <div className="flex gap-1.5 mb-3 flex-wrap items-center">
          {/* Unlabeled tab */}
          <button
            onClick={() => setFilterRole("unlabeled")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              filterRole === "unlabeled"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/50"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-transparent"
            }`}
          >
            ⚠未标注({unlabeledSegments.length})
          </button>
          {/* All tab */}
          <button
            onClick={() => setFilterRole("all")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              filterRole === "all"
                ? "bg-zinc-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            全部({segments.length})
          </button>
          {/* Role tabs */}
          {roles.map((r) => {
            const count = segments.filter((s) => s.roleId === r.id).length;
            return (
              <button
                key={r.id}
                onClick={() => setFilterRole(r.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                  filterRole === r.id
                    ? "ring-1 ring-white/30"
                    : "hover:ring-1 hover:ring-white/10"
                }`}
                style={{
                  backgroundColor: r.color + "20",
                  color: r.color,
                  borderColor: filterRole === r.id ? r.color : "transparent",
                  borderWidth: 1,
                }}
              >
                {/* Rename inline */}
                {editingRoleId === r.id ? (
                  <input
                    value={editingRoleName}
                    onChange={(e) => setEditingRoleName(e.target.value)}
                    onBlur={() => handleRenameRole(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameRole(r.id);
                      if (e.key === "Escape") setEditingRoleId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-16 px-1 py-0 bg-transparent border-b border-current outline-none text-xs"
                    autoFocus
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingRoleId(r.id);
                      setEditingRoleName(r.name);
                    }}
                    title="双击重命名"
                  >
                    {r.name}
                  </span>
                )}
                <span className="opacity-60">({count})</span>
                {r.name !== "旁白" && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteRole(r.id, r.name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        handleDeleteRole(r.id, r.name);
                      }
                    }}
                    className="ml-0.5 hover:bg-white/10 rounded-full w-3.5 h-3.5 flex items-center justify-center text-[10px] cursor-pointer"
                    title="删除角色"
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
          {/* Add new role */}
          {showNewRole ? (
            <span className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 border border-zinc-700">
              <input
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddRole();
                  if (e.key === "Escape") { setShowNewRole(false); setNewRoleName(""); }
                }}
                placeholder="角色名..."
                className="w-20 px-1 py-0 bg-transparent text-xs outline-none"
                autoFocus
              />
              <span className="flex gap-0.5">
                {PRESET_COLORS.slice(0, 6).map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewRoleColor(c)}
                    className={`w-3 h-3 rounded-full ${newRoleColor === c ? "ring-1 ring-white" : ""}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <button onClick={handleAddRole} className="text-xs text-green-400">✓</button>
              <button onClick={() => { setShowNewRole(false); setNewRoleName(""); }} className="text-xs text-zinc-500">✕</button>
            </span>
          ) : (
            <button
              onClick={() => setShowNewRole(true)}
              className="px-2.5 py-1 rounded text-xs border border-dashed border-zinc-600 text-zinc-500 hover:text-zinc-300 hover:border-zinc-400"
            >
              + 新建角色
            </button>
          )}
        </div>

        {/* Batch toolbar */}
        {selectedSegments.size > 0 && (
          <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-md">
            <span className="text-xs text-blue-300">
              已选 <b>{selectedSegments.size}</b> 段
            </span>
            <span className="text-xs text-zinc-500">批量改为 →</span>
            <select
              onChange={(e) => {
                const role = roles.find((r) => r.id === e.target.value);
                if (role) batchReassign(role.id, role.name);
              }}
              value=""
              className="px-2 py-1 text-xs rounded bg-zinc-800 border border-zinc-600"
            >
              <option value="" disabled>选择角色...</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button
              onClick={() => setSelectedSegments(new Set())}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              取消选择
            </button>
          </div>
        )}

        {/* Segment list */}
        <div className="space-y-1 max-h-[55vh] overflow-y-auto">
          {filteredSegments.length === 0 && (
            <p className="text-center text-zinc-500 text-sm py-8">
              {filterRole === "unlabeled" ? "所有对话都已标注角色 ✓" : "暂无段落"}
            </p>
          )}
          {filteredSegments.map((seg) => (
            <div
              key={seg.id}
              className={`flex items-start gap-2 p-2.5 rounded-md border transition-colors ${
                selectedSegments.has(seg.id)
                  ? "bg-blue-500/10 border-blue-500/40"
                  : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedSegments.has(seg.id)}
                onChange={(e) => toggleSegment(seg.id, seg.index, e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey)}
                className="mt-1 shrink-0"
              />
              <span className="text-[10px] text-zinc-600 mt-1 w-5 shrink-0 text-right">
                {seg.index + 1}
              </span>
              <p className="flex-1 text-sm leading-relaxed">{seg.text}</p>
              <select
                value={seg.roleId}
                onChange={(e) => {
                  const role = roles.find((r) => r.id === e.target.value);
                  if (role) handleRoleChange(seg.id, role.name, role.id);
                }}
                className="shrink-0 px-2 py-1 text-xs rounded bg-zinc-800 border border-zinc-700 max-w-[100px]"
                style={{ color: roleColors[seg.roleId] || "#a1a1aa" }}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between mt-3">
          <button
            onClick={() => {
              const allUnlabeled = segments.filter((s) => dialogueLike(s.text) && s.roleName === "旁白");
              setSelectedSegments(new Set(allUnlabeled.map((s) => s.id)));
            }}
            className="text-xs text-amber-400 hover:text-amber-300"
            disabled={unlabeledSegments.length === 0}
          >
            全选未标注段落
          </button>
          <button
            onClick={handleConfirm}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-md font-medium text-sm"
          >
            确认，进入录音工作室
          </button>
        </div>
      </div>
    );
  }

  // ---- Upload view ----
  return (
    <div className="max-w-lg mx-auto w-full">
      <div className="mb-4 space-y-3">
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="项目名称（留空则使用文件名）"
          className="w-full px-3 py-2 text-sm rounded-md bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:outline-none"
        />
        <input
          type="text"
          value={chapterTitle}
          onChange={(e) => setChapterTitle(e.target.value)}
          placeholder="章节标题"
          className="w-full px-3 py-2 text-sm rounded-md bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:outline-none"
        />
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-zinc-700 hover:border-blue-500 rounded-xl p-12 text-center cursor-pointer transition-colors"
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <p className="text-4xl mb-3">📄</p>
        <p className="text-zinc-300 mb-1">
          拖拽 Word 文档到这里，或点击选择文件
        </p>
        <p className="text-xs text-zinc-500">支持 .docx 格式</p>
        <input
          id="file-input"
          type="file"
          accept=".docx,.doc"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>
    </div>
  );
}

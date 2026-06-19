"use client";

import { useState, useMemo } from "react";
import type { Segment, Role } from "@/lib/types";

const PRESET_COLORS = [
  "#EF4444", "#3B82F6", "#10B981", "#F59E0B",
  "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
];

interface QuickFixPanelProps {
  segments: Segment[];
  roles: Role[];
  onRoleChange: (segmentId: string, roleId: string, roleName: string) => Promise<void>;
  onCreateRole: (name: string, color: string) => Promise<Role>;
}

export default function QuickFixPanel({
  segments,
  roles,
  onRoleChange,
  onCreateRole,
}: QuickFixPanelProps) {
  const [open, setOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [creating, setCreating] = useState(false);

  // Find dialogue segments assigned to "旁白" or "角色A"/"角色B" (placeholder names)
  const items = useMemo(() => {
    return segments.reduce<
      { seg: Segment; idx: number; prev?: Segment; next?: Segment }[]
    >((acc, seg, i) => {
      if (seg.roleName !== "旁白" && seg.roleName !== "角色A" && seg.roleName !== "角色B") return acc;
      // Exclude actual narration segments — only show dialogues that need fixing
      // (The segment text starting with quotes IS dialogue,
      //  and text without quotes assigned to 旁白 is actual narration and should be skipped)

      // Quick heuristic: if the text starts with a quote character, it's dialogue
      const looksLikeDialogue = /^[""“‘「『]/.test(seg.text.trim());
      if (!looksLikeDialogue) return acc;

      acc.push({
        seg,
        idx: i,
        prev: i > 0 ? segments[i - 1] : undefined,
        next: i < segments.length - 1 ? segments[i + 1] : undefined,
      });
      return acc;
    }, []);
  }, [segments]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const current = items[currentIdx] || null;

  async function handleAssign(roleId: string, roleName: string) {
    if (!current) return;
    await onRoleChange(current.seg.id, roleId, roleName);
    // Auto-advance
    if (currentIdx < items.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      setCurrentIdx(0);
    }
  }

  async function handleCreateAndAssign() {
    const name = newRoleName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const colorIdx = roles.length % PRESET_COLORS.length;
      const role = await onCreateRole(name, PRESET_COLORS[colorIdx]);
      await handleAssign(role.id, role.name);
      setNewRoleName("");
    } finally {
      setCreating(false);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="border-t border-zinc-800 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-xs font-medium text-zinc-400 hover:text-zinc-200 py-1"
      >
        <span>
          🔧 待校对 ({items.length})
        </span>
        <span className="text-zinc-600">{open ? "▲" : "▼"}</span>
      </button>

      {open && current && (
        <div className="mt-2 space-y-2">
          {/* Progress */}
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>
              {currentIdx + 1} / {items.length}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
                disabled={currentIdx === 0}
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30"
              >
                ←
              </button>
              <button
                onClick={() =>
                  setCurrentIdx(Math.min(items.length - 1, currentIdx + 1))
                }
                disabled={currentIdx >= items.length - 1}
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30"
              >
                →
              </button>
            </div>
          </div>

          {/* Context: previous segment */}
          {current.prev && (
            <div className="p-1.5 rounded bg-zinc-800/50 text-[11px] text-zinc-500 leading-relaxed">
              <span className="text-[9px] text-zinc-600 mr-1">
                [{current.prev.roleName}]
              </span>
              {current.prev.text.length > 60
                ? current.prev.text.slice(0, 60) + "…"
                : current.prev.text}
            </div>
          )}

          {/* Current: dialogue to fix */}
          <div className="p-2 rounded bg-yellow-500/10 border border-yellow-600/30">
            <p className="text-xs text-yellow-300 leading-relaxed">
              {current.seg.text}
            </p>
            <p className="text-[10px] text-yellow-600 mt-1">
              当前角色：{current.seg.roleName} — 请选择正确角色
            </p>
          </div>

          {/* Context: next segment */}
          {current.next && (
            <div className="p-1.5 rounded bg-zinc-800/50 text-[11px] text-zinc-500 leading-relaxed">
              <span className="text-[9px] text-zinc-600 mr-1">
                [{current.next.roleName}]
              </span>
              {current.next.text.length > 60
                ? current.next.text.slice(0, 60) + "…"
                : current.next.text}
            </div>
          )}

          {/* Quick role picker */}
          <div className="flex flex-wrap gap-1">
            {roles
              .filter((r) => r.name !== "旁白")
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleAssign(r.id, r.name)}
                  className="px-2 py-1 text-[10px] rounded hover:ring-1 hover:ring-white/30 transition-all"
                  style={{
                    backgroundColor: r.color + "20",
                    color: r.color,
                  }}
                >
                  {r.name}
                </button>
              ))}
          </div>

          {/* Create new role */}
          <div className="flex gap-1">
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateAndAssign();
              }}
              placeholder="新建角色…"
              className="flex-1 px-2 py-1 text-[10px] rounded bg-zinc-800 border border-zinc-700 focus:border-blue-500 outline-none"
            />
            <button
              onClick={handleCreateAndAssign}
              disabled={!newRoleName.trim() || creating}
              className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded text-white"
            >
              {creating ? "…" : "+"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

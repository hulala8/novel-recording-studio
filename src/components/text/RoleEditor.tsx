"use client";

import { useState } from "react";
import * as db from "@/lib/db";
import type { Role, RoleProgress } from "@/lib/types";

const PRESET_COLORS = [
  "#EF4444", "#3B82F6", "#10B981", "#F59E0B",
  "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
  "#6B7280", "#84CC16", "#14B8A6", "#E11D48",
];

interface RoleEditorProps {
  roles: Role[];
  projectId: string;
  activeRoleId?: string | null;
  progressByRole?: Record<string, RoleProgress>;
  onAdd: (name: string, color: string) => Promise<Role>;
  onRoleSelect?: (roleId: string | null) => void;
  onRolesChanged: (roles: Role[]) => void;
}

export default function RoleEditor({
  roles,
  projectId,
  activeRoleId,
  progressByRole = {},
  onAdd,
  onRoleSelect,
  onRolesChanged,
}: RoleEditorProps) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    if (roles.some((r) => r.name === name)) { setNewName(""); return; }
    await onAdd(name, newColor);
    setNewName("");
  }

  async function handleRename(roleId: string) {
    const newNameVal = editName.trim();
    if (!newNameVal) { setEditingId(null); return; }
    await db.renameRole(roleId, projectId, newNameVal);
    onRolesChanged(roles.map((r) => r.id === roleId ? { ...r, name: newNameVal } : r));
    setEditingId(null);
  }

  async function handleDelete(roleId: string, roleName: string) {
    if (roleName === "旁白") return;
    await db.deleteRoleAndReassignToNarrator(roleId, roleName, projectId);
    onRolesChanged(roles.filter((r) => r.id !== roleId));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-zinc-400">角色管理</p>
        {onRoleSelect && (
          <button
            onClick={() => onRoleSelect(null)}
            className={`text-[10px] px-2 py-0.5 rounded ${
              activeRoleId
                ? "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                : "bg-blue-600 text-white"
            }`}
            title="显示全部角色"
          >
            全部
          </button>
        )}
      </div>

      <div className="space-y-1 mb-2 max-h-56 overflow-y-auto">
        {roles.map((role) => {
          const progress = progressByRole[role.id] || {
            roleId: role.id,
            total: 0,
            recorded: 0,
          };
          const percent =
            progress.total > 0
              ? Math.round((progress.recorded / progress.total) * 100)
              : 0;

          return (
            <button
              key={role.id}
              onClick={() => onRoleSelect?.(activeRoleId === role.id ? null : role.id)}
              className={`w-full rounded-md border p-2 text-left text-xs group transition-colors ${
                activeRoleId === role.id
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                {editingId === role.id ? (
                  <input
                    value={editName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleRename(role.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(role.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 px-1 py-0 text-xs bg-zinc-800 border border-zinc-600 rounded outline-none"
                    autoFocus
                  />
                ) : (
                  <span className="text-zinc-300 truncate flex-1" title={role.name}>
                    {role.name}
                  </span>
                )}
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {progress.recorded}/{progress.total}
                </span>
                {editingId !== role.id && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(role.id);
                      setEditName(role.name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        setEditingId(role.id);
                        setEditName(role.name);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200 transition-opacity"
                    title="重命名角色"
                  >
                    改
                  </span>
                )}
                {role.name !== "旁白" && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(role.id, role.name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        handleDelete(role.id, role.name);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-opacity text-sm"
                    title="删除角色（段落将归为旁白）"
                  >
                    ×
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${percent}%`,
                    backgroundColor: role.color,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <div className="space-y-1">
        <div className="flex gap-1">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="新角色名..."
            className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:outline-none"
          />
          <button onClick={handleAdd} className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded">+</button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setNewColor(c)}
              className={`w-4 h-4 rounded-full border-2 transition-all ${newColor === c ? "border-white scale-125" : "border-transparent"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

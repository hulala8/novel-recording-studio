"use client";

import { useRef, useState } from "react";
import type { Segment, Role } from "@/lib/types";

interface TextViewerProps {
  segments: Segment[];
  roles: Role[];
  activeSegmentIndex: number;
  onSelectSegment: (index: number) => void;
  onImport?: (file: File) => void;
  onRoleChange?: (segmentId: string, roleId: string, roleName: string) => void;
}

export default function TextViewer({
  segments,
  roles,
  activeSegmentIndex,
  onSelectSegment,
  onImport,
  onRoleChange,
}: TextViewerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openMenuIdx, setOpenMenuIdx] = useState<number | null>(null);
  const roleColors = Object.fromEntries(roles.map((r) => [r.id, r.color]));

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && onImport) onImport(file);
  }

  function handleRoleClick(e: React.MouseEvent, segIndex: number) {
    e.stopPropagation();
    setOpenMenuIdx(openMenuIdx === segIndex ? null : segIndex);
  }

  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500 text-sm">
        <p className="text-4xl">📄</p>
        <p>暂无文本。导入 Word 文档开始录制。</p>
        {onImport ? (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-sm text-white"
            >
              导入 Word 文档
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.doc"
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        ) : (
          <a href="/" className="text-blue-400 hover:text-blue-300 text-sm">
            ← 返回首页上传文档
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-1">
      {segments.map((seg, i) => {
        const isActive = i === activeSegmentIndex;
        const isRecorded = !!seg.recordingId;
        const color = roleColors[seg.roleId] || "#a1a1aa";
        const menuOpen = openMenuIdx === i;

        return (
          <div
            key={seg.id}
            id={`segment-${i}`}
            className="relative"
          >
            <button
              onClick={() => onSelectSegment(i)}
              className={`w-full text-left px-3 py-2 rounded-md transition-all border ${
                isActive
                  ? "border-blue-500 bg-blue-500/10"
                  : isRecorded
                    ? "border-transparent bg-green-500/5"
                    : "border-transparent hover:bg-zinc-800/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] text-zinc-600 w-5">{i + 1}</span>
                {/* Clickable role label */}
                <span
                  onClick={(e) => {
                    if (onRoleChange) handleRoleClick(e, i);
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${onRoleChange ? "cursor-pointer hover:ring-1 hover:ring-white/30" : ""}`}
                  style={{ backgroundColor: color + "20", color }}
                  title={onRoleChange ? "点击更换角色" : undefined}
                >
                  {seg.roleName}
                </span>
                {isRecorded && (
                  <span className="text-[10px] text-green-500">✓</span>
                )}
              </div>
              <p
                className="text-sm leading-relaxed ml-7"
                style={{
                  color: isActive ? "#fafafa" : isRecorded ? "#a3a3a3" : "#d4d4d8",
                }}
              >
                {seg.text}
              </p>
            </button>

            {/* Quick role picker popup */}
            {menuOpen && onRoleChange && (
              <div className="absolute right-2 top-8 z-50 bg-zinc-800 border border-zinc-600 rounded-md shadow-lg p-1 min-w-[100px]">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      onRoleChange(seg.id, r.id, r.name);
                      setOpenMenuIdx(null);
                    }}
                    className={`w-full text-left px-2 py-1 text-xs rounded hover:bg-zinc-700 flex items-center gap-2 ${
                      r.id === seg.roleId ? "font-bold" : ""
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <span style={{ color: r.color }}>{r.name}</span>
                    {r.id === seg.roleId && <span className="text-zinc-500 ml-auto">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

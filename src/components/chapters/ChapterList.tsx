"use client";

import { useState } from "react";
import type { Chapter } from "@/lib/types";

interface ChapterListProps {
  chapters: Chapter[];
  activeChapterId: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string) => Promise<Chapter>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (chapters: Chapter[]) => Promise<void>;
}

export default function ChapterList({
  chapters,
  activeChapterId,
  onSelect,
  onCreate,
  onDelete,
}: ChapterListProps) {
  const [newTitle, setNewTitle] = useState("");

  async function handleCreate() {
    const title = newTitle.trim();
    if (!title) return;
    const ch = await onCreate(title);
    setNewTitle("");
    onSelect(ch.id);
  }

  return (
    <div>
      <p className="text-xs font-medium text-zinc-400 mb-2">章节</p>

      {/* Chapter list */}
      <ul className="space-y-0.5 mb-2 max-h-60 overflow-y-auto">
        {chapters.length === 0 ? (
          <li className="text-xs text-zinc-600">暂无章节</li>
        ) : (
          chapters.map((ch) => (
            <li key={ch.id} className="group flex items-center gap-1">
              <button
                onClick={() => onSelect(ch.id)}
                className={`flex-1 px-2 py-1 text-xs rounded text-left truncate transition-colors ${
                  activeChapterId === ch.id
                    ? "bg-blue-600/30 text-blue-300"
                    : "hover:bg-zinc-800 text-zinc-400"
                }`}
              >
                {ch.title}
              </button>
              <button
                onClick={() => onDelete(ch.id)}
                className="px-1 text-[10px] text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                title="删除"
              >
                ✕
              </button>
            </li>
          ))
        )}
      </ul>

      {/* Add chapter */}
      <div className="flex gap-1">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="新章节..."
          className="flex-1 px-2 py-1 text-xs rounded bg-zinc-800 border border-zinc-700 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleCreate}
          className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded"
        >
          +
        </button>
      </div>
    </div>
  );
}

"use client";

import type { Segment, Role, RecordingStatus } from "@/lib/types";

interface RecorderState {
  status: RecordingStatus;
  duration: number;
  audioBlob: Blob | null;
}

interface SegmentRecorderProps {
  segment: Segment | null;
  roles: Role[];
  recorder: RecorderState;
  onSplit?: () => void;
}

export default function SegmentRecorder({
  segment,
  roles,
  recorder,
  onSplit,
}: SegmentRecorderProps) {
  if (!segment) {
    return (
      <div className="p-3 text-center text-sm text-zinc-500">
        请选择一个章节和段落开始录制
      </div>
    );
  }

  const role = roles.find((r) => r.id === segment.roleId);
  const roleColor = role?.color || "#a1a1aa";
  const textLen = segment.text.length;
  const isLong = textLen > 60;

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-zinc-500">第 {segment.index + 1} 段</span>
        <span
          className="px-1.5 py-0.5 rounded text-xs font-medium"
          style={{ backgroundColor: roleColor + "30", color: roleColor }}
        >
          {segment.roleName}
        </span>
        {segment.recordingId && (
          <span className="text-[10px] text-green-500">● 已录制</span>
        )}
      </div>

      <p className="text-sm text-zinc-300 leading-relaxed max-h-32 overflow-y-auto mb-2">
        {segment.text}
      </p>

      {/* Text length warning + split button */}
      {isLong && onSplit && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-yellow-500">
            ⚠ 文本较长 ({textLen}字)，建议拆分后逐段录制
          </span>
          <button
            onClick={onSplit}
            className="px-2 py-0.5 text-[10px] bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-400 rounded border border-yellow-600/40"
            title="将长段落拆分为短段落，方便逐段录制"
          >
            拆分段落
          </button>
        </div>
      )}

      {recorder.status === "recording" && (
        <div className="text-xs text-red-400 animate-pulse">● 录制中</div>
      )}
      {recorder.status === "stopped" && (
        <div className="text-xs text-green-400">
          录制完成，试听后保存
        </div>
      )}
    </div>
  );
}

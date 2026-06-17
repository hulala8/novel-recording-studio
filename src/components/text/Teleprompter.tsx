"use client";

import { useEffect } from "react";
import type { RoleProgress, Segment, Role, RecordingStatus } from "@/lib/types";
import TrackWaveform from "@/components/recording/TrackWaveform";

interface TeleprompterState {
  scrollSpeed: number;
  isAutoScrolling: boolean;
  fontSize: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  startAutoScroll: () => void;
  stopAutoScroll: () => void;
  toggleAutoScroll: () => void;
  setScrollSpeed: (speed: number) => void;
  setFontSize: (size: number) => void;
  scrollToSegment: (id: string) => void;
}

interface RecorderState {
  status: RecordingStatus;
  duration: number;
  audioBlob: Blob | null;
  startRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;
}

interface TeleprompterProps {
  segments: Segment[];
  roles: Role[];
  activeSegmentIndex: number;
  teleprompter: TeleprompterState;
  onSelectSegment: (index: number) => void;
  recorder: RecorderState;
  onSave: () => void;
  onExit: () => void;
  // Waveform/playback integration
  playerCurrentTime?: number;
  playbackStatus?: "idle" | "playing" | "paused";
  onPreview?: () => void;
  onPause?: () => void;
  onCut?: (start: number, end: number) => void;
  onTrim?: (start: number, end: number) => void;
  onSplit?: () => void;
  // Saved recording waveform
  recordedBlob?: Blob | null;
  recordedDuration?: number;
  onPlaySaved?: () => void;
  /** Called when user single-clicks waveform to position playhead */
  onSeek?: (time: number) => void;
  /** Role filter: only navigate/record segments of this role */
  roleFilter?: string | null;
  onRoleFilterChange?: (roleId: string | null) => void;
  progressByRole?: Record<string, RoleProgress>;
  /** Filtered navigation callbacks */
  onNextFiltered?: () => void;
  onPrevFiltered?: () => void;
  /** Auto-trim start visualization */
  autoTrimStart?: boolean;
  autoTrimDuration?: number;
}

export default function Teleprompter({
  segments,
  roles,
  activeSegmentIndex,
  teleprompter,
  onSelectSegment,
  recorder,
  onSave,
  onExit,
  playerCurrentTime = 0,
  playbackStatus = "idle",
  onPreview,
  onPause,
  onCut,
  onTrim,
  onSplit,
  recordedBlob,
  recordedDuration = 0,
  onPlaySaved,
  onSeek,
  roleFilter,
  onRoleFilterChange,
  progressByRole = {},
  onNextFiltered,
  onPrevFiltered,
  autoTrimStart,
  autoTrimDuration = 0,
}: TeleprompterProps) {
  const {
    scrollSpeed,
    isAutoScrolling,
    fontSize,
    containerRef,
    startAutoScroll,
    stopAutoScroll,
    setScrollSpeed,
    setFontSize,
    scrollToSegment,
  } = teleprompter;

  const roleColors = Object.fromEntries(roles.map((r) => [r.id, r.color]));
  const activeSegment = segments[activeSegmentIndex];
  const recordedCount = segments.filter((s) => s.recordingId).length;

  // Show waveform when: new recording exists, OR segment has saved recording
  const showWaveform =
    (recorder.status === "stopped" && recorder.audioBlob) ||
    (!!recordedBlob && recorder.status !== "stopped");
  const waveBlob =
    recorder.status === "stopped" && recorder.audioBlob
      ? recorder.audioBlob
      : recordedBlob || null;
  const waveDuration =
    recorder.status === "stopped" && recorder.audioBlob
      ? recorder.duration
      : recordedDuration;
  const waveLabel =
    recorder.status === "stopped" && recorder.audioBlob ? "新录制" : "已保存录音";

  useEffect(() => {
    scrollToSegment(`tele-segment-${activeSegmentIndex}`);
  }, [activeSegmentIndex, scrollToSegment]);

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  if (segments.length === 0) {
    return (
      <div className="teleprompter-mode flex items-center justify-center text-zinc-500">
        暂无文本
      </div>
    );
  }

  return (
    <div className="teleprompter-mode flex flex-col">
      {/* ======== Top toolbar ======== */}
      <div className="h-10 border-b border-zinc-800 flex items-center px-4 gap-3 shrink-0 bg-zinc-950/95 backdrop-blur">
        <span className="text-xs font-bold text-blue-400">提词器模式</span>

        {/* Font size */}
        <div className="flex items-center gap-1 text-[10px] text-zinc-400">
          <span className="text-zinc-500">字号</span>
          <button
            onClick={() => setFontSize(fontSize - 2)}
            className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            A-
          </button>
          <span className="text-zinc-500 w-6 text-center font-mono">{fontSize}</span>
          <button
            onClick={() => setFontSize(fontSize + 2)}
            className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            A+
          </button>
        </div>

        {/* Scroll speed */}
        <div className="flex items-center gap-1 text-[10px] text-zinc-400">
          <span className="text-zinc-500">速度</span>
          <input
            type="range"
            min={5}
            max={100}
            value={scrollSpeed}
            onChange={(e) => setScrollSpeed(Number(e.target.value))}
            className="w-16 h-1 accent-blue-500"
          />
          <span className="text-zinc-500 w-5 font-mono">{scrollSpeed}</span>
        </div>

        <button
          onClick={isAutoScrolling ? stopAutoScroll : startAutoScroll}
          className={`px-2.5 py-0.5 rounded text-[10px] font-medium ${
            isAutoScrolling
              ? "bg-green-600 text-white"
              : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
          }`}
          title="切换自动滚动 (A)"
        >
          {isAutoScrolling ? "⏸ 暂停" : "▶ 自动滚动"}
          <kbd className="ml-1 text-[8px] opacity-60">A</kbd>
        </button>

        {roleFilter && (
          <span className="text-[9px] text-yellow-400 font-medium">
            仅 {roles.find(r => r.id === roleFilter)?.name || ""}
          </span>
        )}

        <div className="flex-1" />

        {/* Progress */}
        <span className="text-[10px] text-zinc-500">
          进度 {activeSegmentIndex + 1}/{segments.length}
          {recordedCount > 0 && (
            <span className="text-green-500 ml-1">({recordedCount}✓)</span>
          )}
        </span>

        {/* Progress bar (mini) */}
        <div className="w-20 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-600 transition-all"
            style={{ width: `${segments.length > 0 ? (recordedCount / segments.length) * 100 : 0}%` }}
          />
        </div>

        <button
          onClick={onExit}
          className="px-2.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-300 border border-zinc-600"
          title="退出提词器 (Esc)"
        >
          ✕ 退出 <kbd className="text-[8px] opacity-60">Esc</kbd>
        </button>
      </div>

      {/* ======== Content area ======== */}
      <div className="flex-1 flex min-h-0">
        {onRoleFilterChange && (
          <aside className="w-48 border-r border-zinc-800 bg-zinc-950/80 px-3 py-4 overflow-y-auto shrink-0">
            <p className="text-[10px] font-bold text-zinc-500 mb-2">配音角色</p>
            <button
              onClick={() => onRoleFilterChange(null)}
              className={`w-full mb-2 rounded-md border px-2 py-2 text-left text-xs transition-colors ${
                roleFilter
                  ? "border-zinc-800 bg-zinc-900 hover:border-zinc-700 text-zinc-300"
                  : "border-blue-500 bg-blue-500/10 text-white"
              }`}
            >
              全部角色
            </button>
            <div className="space-y-1.5">
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
                    onClick={() =>
                      onRoleFilterChange(roleFilter === role.id ? null : role.id)
                    }
                    className={`w-full rounded-md border p-2 text-left transition-colors ${
                      roleFilter === role.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: role.color }}
                      />
                      <span className="truncate text-zinc-200 flex-1">
                        {role.name}
                      </span>
                      <span className="text-[10px] text-zinc-500 tabular-nums">
                        {progress.recorded}/{progress.total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${percent}%`, backgroundColor: role.color }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {/* ======== Scrollable content ======== */}
        <div ref={containerRef} className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-3xl mx-auto space-y-6 pb-40">
            {segments.map((seg, i) => {
              const isActive = i === activeSegmentIndex;
              const color = roleColors[seg.roleId] || "#a1a1aa";

              return (
                <div
                  key={seg.id}
                  id={`tele-segment-${i}`}
                  className={`transition-all duration-300 rounded-xl p-5 cursor-pointer ${
                    isActive
                      ? "bg-blue-500/10 border-2 border-blue-500/50 scale-[1.02] shadow-lg shadow-blue-500/10"
                      : "opacity-25 hover:opacity-50 border-2 border-transparent"
                  }`}
                  onClick={() => onSelectSegment(i)}
                >
                  <span
                    className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold mb-2.5"
                    style={{ backgroundColor: color + "30", color }}
                  >
                    {seg.roleName}
                  </span>
                  <p
                    className="leading-relaxed font-medium"
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    {seg.text}
                  </p>
                  {seg.recordingId && (
                    <span className="text-[11px] text-green-500 mt-2 inline-block">
                      ✓ 已录制
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ======== Waveform panel ======== */}
      {showWaveform && waveBlob && (
        <div className="border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-4 py-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-300">
              {waveLabel} · {formatTime(waveDuration)}
            </span>
            <div className="flex gap-2">
              {/* Play saved recording */}
              {recordedBlob && onPlaySaved && recorder.status !== "stopped" && (
                <button
                  onClick={playbackStatus === "playing" ? onPause : onPlaySaved}
                  className="px-3 py-1 text-[11px] bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
                  title="试听/暂停 (P)"
                >
                  {playbackStatus === "playing"
                    ? "⏸ 暂停"
                    : playbackStatus === "paused"
                    ? "▶ 继续"
                    : "▶ 试听"}
                  <kbd className="ml-1 text-[8px] opacity-60">P</kbd>
                </button>
              )}
              {/* Play new recording */}
              {recorder.status === "stopped" && recorder.audioBlob && onPreview && (
                <button
                  onClick={playbackStatus === "playing" ? onPause : onPreview}
                  className="px-3 py-1 text-[11px] bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
                  title="试听/暂停 (P)"
                >
                  {playbackStatus === "playing"
                    ? "⏸ 暂停试听"
                    : playbackStatus === "paused"
                    ? "▶ 继续试听"
                    : "▶ 试听"}
                  <kbd className="ml-1 text-[8px] opacity-60">P</kbd>
                </button>
              )}
            </div>
          </div>
          <TrackWaveform
            audioBlob={waveBlob}
            duration={waveDuration}
            currentTime={playerCurrentTime}
            onTrim={onTrim}
            onCut={onCut}
            onSeek={onSeek}
            autoTrimStart={autoTrimStart && waveLabel === "新录制" ? 0 : undefined}
            autoTrimEnd={autoTrimStart && waveLabel === "新录制" ? autoTrimDuration : undefined}
          />
        </div>
      )}

      {/* ======== Bottom control bar ======== */}
      <div className="border-t border-zinc-800 flex items-center px-5 gap-3 shrink-0 bg-zinc-950/95 backdrop-blur" style={{ height: 64 }}>
        {/* Segment info */}
        <div className="flex items-center gap-2 min-w-0 w-48">
          <span
            className="px-2 py-0.5 rounded text-[10px] font-medium shrink-0"
            style={{
              backgroundColor:
                (roleColors[activeSegment?.roleId || ""] || "#6B7280") + "30",
              color: roleColors[activeSegment?.roleId || ""] || "#a1a1aa",
            }}
          >
            {activeSegment?.roleName || "-"}
          </span>
          <span className="text-[11px] text-zinc-500 truncate">
            {activeSegment?.text.slice(0, 25) || "请选择段落"}
          </span>
          {activeSegment && activeSegment.text.length > 60 && onSplit && (
            <button
              onClick={onSplit}
              className="px-1.5 py-0.5 text-[9px] bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-400 rounded border border-yellow-600/40 shrink-0"
              title="拆分当前段落 (S)"
            >
              拆分 <kbd className="text-[7px] opacity-60">S</kbd>
            </button>
          )}
        </div>

        {/* Timer */}
        <div className="text-center shrink-0">
          <span
            className={`font-mono text-lg tabular-nums ${
              recorder.status === "recording" ? "text-red-400" : "text-zinc-300"
            }`}
          >
            {formatTime(recorder.duration)}
          </span>
          {recorder.status === "recording" && (
            <span className="inline-block w-2 h-2 bg-red-500 rounded-full ml-1 animate-pulse align-middle" />
          )}
        </div>

        {/* Recording controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => {
              if (onPrevFiltered) onPrevFiltered();
              else onSelectSegment(Math.max(0, activeSegmentIndex - 1));
            }}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-800 text-sm"
            title="上一段 (←)"
          >
            ◀
          </button>

          {recorder.status === "idle" && (
            <button
              onClick={recorder.startRecording}
              className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center shadow-lg shadow-red-500/25"
              title="开始录音 (Space)"
            >
              <span className="w-3.5 h-3.5 bg-white rounded-sm" />
            </button>
          )}

          {recorder.status === "recording" && (
            <>
              <button
                onClick={recorder.pauseRecording}
                className="w-9 h-9 rounded-full bg-yellow-500 hover:bg-yellow-400 flex items-center justify-center"
                title="暂停录音 (Space 停止)"
              >
                <div className="flex gap-0.5">
                  <span className="w-1 h-3 bg-white rounded-sm" />
                  <span className="w-1 h-3 bg-white rounded-sm" />
                </div>
              </button>
              <button
                onClick={recorder.stopRecording}
                className="w-10 h-10 rounded-full bg-zinc-600 hover:bg-zinc-500 flex items-center justify-center"
                title="停止录音 (Space)"
              >
                <span className="w-3.5 h-3.5 bg-white rounded-sm" />
              </button>
            </>
          )}

          {recorder.status === "paused" && (
            <>
              <button
                onClick={recorder.resumeRecording}
                className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center"
                title="继续录制 (Space)"
              >
                <span className="w-3.5 h-3.5 bg-white rounded-sm" />
              </button>
              <button
                onClick={recorder.stopRecording}
                className="w-9 h-9 rounded-full bg-zinc-600 hover:bg-zinc-500 flex items-center justify-center"
                title="停止 (Space)"
              >
                <span className="w-3 h-3 bg-white rounded-sm" />
              </button>
            </>
          )}

          {recorder.status === "stopped" && (
            <>
              <button
                onClick={onSave}
                className="px-3.5 py-2 bg-green-600 hover:bg-green-500 rounded-md text-xs font-bold transition-colors"
                title="保存录音并进入下一段 (Enter)"
              >
                保存 <kbd className="text-[9px] opacity-60">Enter</kbd>
              </button>
              <button
                onClick={() => {
                  recorder.resetRecording();
                  recorder.startRecording();
                }}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-md text-xs transition-colors"
                title="放弃当前，重新录制 (Ctrl+R)"
              >
                ↺ 重录 <kbd className="text-[9px] opacity-60">^R</kbd>
              </button>
            </>
          )}

          <button
            onClick={() => {
              if (onNextFiltered) onNextFiltered();
              else onSelectSegment(Math.min(segments.length - 1, activeSegmentIndex + 1));
            }}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-800 text-sm"
            title="下一段 (→)"
          >
            ▶
          </button>
        </div>

        <div className="flex-1" />

        {/* Status + shortcut ref */}
        <span className="text-[10px] text-zinc-600 shrink-0">
          {recorder.status === "idle" && "Space 开始 · P 试听 · A 滚动"}
          {recorder.status === "recording" && "● 录制中 · Space 停止"}
          {recorder.status === "paused" && "⏸ 已暂停 · Space 继续"}
          {recorder.status === "stopped" && "Enter 保存 · P 试听 · ^R 重录"}
        </span>
      </div>
    </div>
  );
}

"use client";

import type { RecordingStatus } from "@/lib/types";

interface RecorderState {
  status: RecordingStatus;
  duration: number;
  error: string | null;
  startRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;
}

interface RecordControlsProps {
  recorder: RecorderState;
  onStopAndSave: () => void;
}

export default function RecordControls({
  recorder,
  onStopAndSave,
}: RecordControlsProps) {
  const { status, duration, error } = recorder;

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}.${ms}`;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Timer */}
      <div className="text-center">
        <span
          className={`text-2xl font-mono tabular-nums ${
            status === "recording" ? "text-red-400" : "text-zinc-300"
          }`}
        >
          {formatTime(duration)}
        </span>
        {status === "recording" && (
          <span className="inline-block w-2 h-2 bg-red-500 rounded-full ml-2 animate-pulse align-middle" />
        )}
      </div>

      {/* Status */}
      <p className="text-xs text-zinc-500">
        {status === "idle" && "准备就绪 — Space 开始"}
        {status === "recording" && "● 正在录制..."}
        {status === "paused" && "⏸ 已暂停"}
        {status === "stopped" && "试听后保存"}
      </p>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 text-center leading-relaxed">
          {error}
        </p>
      )}

      {/* Control buttons */}
      <div className="flex items-center gap-2">
        {/* Idle: Start button */}
        {status === "idle" && (
          <button
            onClick={recorder.startRecording}
            className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center transition-colors shadow-lg shadow-red-500/25"
            title="开始录音 (Space)"
          >
            <span className="w-4 h-4 bg-white rounded-sm" />
          </button>
        )}

        {/* Recording: Pause + Stop */}
        {status === "recording" && (
          <>
            <button
              onClick={recorder.pauseRecording}
              className="w-10 h-10 rounded-full bg-yellow-500 hover:bg-yellow-400 flex items-center justify-center transition-colors"
              title="暂停录音"
            >
              <div className="flex gap-1">
                <span className="w-1 h-3 bg-white rounded-sm" />
                <span className="w-1 h-3 bg-white rounded-sm" />
              </div>
            </button>
            <button
              onClick={recorder.stopRecording}
              className="w-12 h-12 rounded-full bg-zinc-600 hover:bg-zinc-500 flex items-center justify-center transition-colors"
              title="停止录音 (Space)"
            >
              <span className="w-4 h-4 bg-white rounded-sm" />
            </button>
          </>
        )}

        {/* Paused: Resume + Stop */}
        {status === "paused" && (
          <>
            <button
              onClick={recorder.resumeRecording}
              className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center transition-colors"
              title="继续录制 (Space)"
            >
              <span className="w-4 h-4 bg-white rounded-sm" />
            </button>
            <button
              onClick={recorder.stopRecording}
              className="w-10 h-10 rounded-full bg-zinc-600 hover:bg-zinc-500 flex items-center justify-center transition-colors"
              title="停止"
            >
              <span className="w-3 h-3 bg-white rounded-sm" />
            </button>
          </>
        )}

        {/* Stopped: Save + Re-record */}
        {status === "stopped" && (
          <>
            <button
              onClick={onStopAndSave}
              className="px-5 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-colors flex items-center gap-1"
              title="保存并继续下一段 (Enter)"
            >
              保存 ✓
            </button>
            <button
              onClick={() => {
                recorder.resetRecording();
                recorder.startRecording();
              }}
              className="px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm transition-colors flex items-center gap-1"
              title="放弃当前，重新录制 (Ctrl+R)"
            >
              ↺ 重录
            </button>
          </>
        )}
      </div>

      {/* Shortcut hints */}
      <div className="flex gap-3 text-[10px] text-zinc-600 flex-wrap justify-center">
        <span>Space 录/停</span>
        <span>Enter 保存</span>
        <span>← → 切换</span>
        <span>Ctrl+R 重录</span>
        <span>P 试听</span>
        <span>⇧P 全部</span>
      </div>
    </div>
  );
}

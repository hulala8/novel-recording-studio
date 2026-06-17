"use client";

import { useState } from "react";
import { concatAudioBlobs, wavBlobToMp3, downloadBlob } from "@/lib/audio-utils";
import { getRecording } from "@/lib/db";
import type { Segment, Role } from "@/lib/types";

interface ExportPanelProps {
  segments: Segment[];
  roles: Role[];
  chapterTitle?: string;
}

type ExportStatus = "idle" | "loading" | "merging" | "encoding" | "done" | "error";

export default function ExportPanel({ segments, roles, chapterTitle }: ExportPanelProps) {
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recordedSegments = segments.filter((s) => s.recordingId);
  const unrecordedCount = segments.length - recordedSegments.length;

  async function handleExport() {
    if (recordedSegments.length === 0) {
      setError("没有已录制的段落可导出");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError(null);
    setProgress(0);

    try {
      // Load all recording blobs
      const blobs: Blob[] = [];
      for (let i = 0; i < recordedSegments.length; i++) {
        const seg = recordedSegments[i];
        const rec = await getRecording(seg.recordingId!);
        if (rec) {
          blobs.push(rec.audioBlob);
        }
        setProgress(Math.round(((i + 1) / recordedSegments.length) * 50));
      }

      if (blobs.length === 0) {
        throw new Error("无法加载录音数据");
      }

      // Concatenate all blobs into a single WAV
      setStatus("merging");
      const wavBlob = await concatAudioBlobs(blobs);

      setProgress(60);

      // Encode WAV → MP3
      setStatus("encoding");
      const mp3Blob = await wavBlobToMp3(wavBlob);

      setProgress(90);

      // Download
      const filename = chapterTitle
        ? `${chapterTitle}.mp3`
        : `novel-recording-${Date.now()}.mp3`;
      downloadBlob(mp3Blob, filename);

      setProgress(100);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
      setStatus("error");
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <h3 className="text-lg font-bold mb-4">导出 MP3</h3>

      {/* Stats */}
      <div className="space-y-2 mb-4 text-sm text-zinc-400">
        <div>
          总段落：<span className="text-zinc-200">{segments.length}</span>
        </div>
        <div>
          已录制：<span className="text-green-400">{recordedSegments.length}</span>
        </div>
        {unrecordedCount > 0 && (
          <div>
            未录制：<span className="text-yellow-400">{unrecordedCount}</span>
            <span className="text-xs text-zinc-600 ml-1">
              （未录制的段落将跳过）
            </span>
          </div>
        )}
      </div>

      {/* Role breakdown */}
      <div className="mb-4">
        <p className="text-xs text-zinc-500 mb-1">按角色统计：</p>
        {roles.map((role) => {
          const count = recordedSegments.filter(
            (s) => s.roleId === role.id
          ).length;
          if (count === 0) return null;
          return (
            <div
              key={role.id}
              className="flex items-center gap-2 text-xs"
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: role.color }}
              />
              <span className="text-zinc-400">{role.name}</span>
              <span className="text-zinc-600">{count} 段</span>
            </div>
          );
        })}
      </div>

      {/* Progress */}
      {status !== "idle" && status !== "done" && status !== "error" && (
        <div className="mb-4">
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {status === "loading" && "加载录音数据..."}
            {status === "merging" && "合并音轨..."}
            {status === "encoding" && "编码 MP3..."}
            {progress}%
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400 mb-4">{error}</p>
      )}

      {/* Export button */}
      <button
        onClick={handleExport}
        disabled={status === "loading" || status === "merging" || status === "encoding"}
        title="导出已录制段落为 MP3 文件 (E)"
        className={`w-full py-2 rounded-md font-medium text-sm transition-colors ${
          status === "done"
            ? "bg-green-600 hover:bg-green-500"
            : "bg-blue-600 hover:bg-blue-500"
        } disabled:opacity-50`}
      >
        {status === "idle" && "导出 MP3"}
        {status === "loading" && "正在加载..."}
        {status === "merging" && "正在合并音轨..."}
        {status === "encoding" && "正在编码 MP3..."}
        {status === "done" && "✓ 导出完成，点击重新导出"}
        {status === "error" && "重试导出"}
      </button>

      {status === "done" && (
        <p className="text-xs text-green-400 text-center mt-2">
          文件已开始下载
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  useProjects,
  useChapters,
  useSegments,
  useRoles,
  useRecordings,
} from "@/hooks/useIndexedDB";
import { useRecorder } from "@/hooks/useRecorder";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useTeleprompter } from "@/hooks/useTeleprompter";
import RecordControls from "@/components/recording/RecordControls";
import SegmentRecorder from "@/components/recording/SegmentRecorder";
import TrackWaveform from "@/components/recording/TrackWaveform";
import PlaybackBar from "@/components/playback/PlaybackBar";
import Teleprompter from "@/components/text/Teleprompter";
import TextViewer from "@/components/text/TextViewer";
import RoleEditor from "@/components/text/RoleEditor";
import ChapterList from "@/components/chapters/ChapterList";
import ExportPanel from "@/components/export/ExportPanel";
import SettingsPanel from "@/components/layout/SettingsPanel";
import { getRecording } from "@/lib/db";
import { exportProjectToZip, sanitizeFilename } from "@/lib/export-import";
import { downloadBlob } from "@/lib/audio-utils";
import type { Segment } from "@/lib/types";
import Link from "next/link";

export default function StudioPage() {
  const params = useParams();
  const projectId = params.id as string;

  const { projects } = useProjects();
  const { chapters, createChapter, removeChapter, reorderChapters } =
    useChapters(projectId);
  const { roles, addRole, saveRolesBatch, setRoles } = useRoles(projectId);
  const { saveRecording: dbSaveRecording } = useRecordings();

  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"normal" | "teleprompter">("normal");
  const [showExport, setShowExport] = useState(false);
  const [silenceSettings, setSilenceSettings] = useState({
    silenceThreshold: 0.015,
    minSilenceDuration: 0.8,
  });
  const [autoTrimStart, setAutoTrimStart] = useState(false); // 自动切除开头噪音
  const [autoTrimDuration] = useState(0.5); // 切除秒数
  const [roleFilter, setRoleFilter] = useState<string | null>(null); // null=全部角色

  const project = projects.find((p) => p.id === projectId);
  const activeChapter = chapters.find((c) => c.id === activeChapterId);

  const { segments, loadSegments, updateSegment } = useSegments(
    activeChapterId || ""
  );

  const recorder = useRecorder();
  const player = useAudioPlayer();
  const teleprompter = useTeleprompter();

  // Saved recording blob for waveform display
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);

  // Set first chapter as active when loaded
  useEffect(() => {
    if (chapters.length > 0 && !activeChapterId) {
      queueMicrotask(() => setActiveChapterId(chapters[0].id));
    }
  }, [chapters, activeChapterId]);

  // Load segments when active chapter changes
  useEffect(() => {
    if (activeChapterId) {
      loadSegments();
      queueMicrotask(() => setActiveSegmentIndex(0));
    }
  }, [activeChapterId, loadSegments]);

  // Load saved recording blob for waveform when active segment changes
  useEffect(() => {
    let cancelled = false;
    async function loadRecordingBlob() {
      const seg = segments[activeSegmentIndex];
      if (seg?.recordingId) {
        try {
          const rec = await getRecording(seg.recordingId);
          if (!cancelled && rec) {
            setRecordedBlob(rec.audioBlob);
            // get duration from the blob
            const { getAudioDuration } = await import("@/lib/audio-utils");
            const dur = await getAudioDuration(rec.audioBlob);
            if (!cancelled) setRecordedDuration(dur);
          }
        } catch {
          if (!cancelled) {
            setRecordedBlob(null);
            setRecordedDuration(0);
          }
        }
      } else {
        setRecordedBlob(null);
        setRecordedDuration(0);
      }
    }
    loadRecordingBlob();
    return () => { cancelled = true; };
  }, [activeSegmentIndex, segments]);

  const activeSegment = segments[activeSegmentIndex] || null;

  // ---- Role-filtered segment indices ----
  const filteredIndices = useMemo(() => {
    if (!roleFilter) return segments.map((_, i) => i);
    return segments.reduce<number[]>((acc, s, i) => {
      if (s.roleId === roleFilter) acc.push(i);
      return acc;
    }, []);
  }, [segments, roleFilter]);

  // Jump to first matching segment when filter changes
  useEffect(() => {
    if (roleFilter && filteredIndices.length > 0) {
      queueMicrotask(() => setActiveSegmentIndex(filteredIndices[0]));
    } else if (!roleFilter && segments.length > 0) {
      // Reset to beginning when clearing filter
      // (keep current position)
    }
  }, [roleFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToNextFiltered = useCallback(() => {
    if (filteredIndices.length === 0) return;
    const pos = filteredIndices.indexOf(activeSegmentIndex);
    if (pos < filteredIndices.length - 1) {
      setActiveSegmentIndex(filteredIndices[pos + 1]);
    }
  }, [filteredIndices, activeSegmentIndex]);

  const goToPrevFiltered = useCallback(() => {
    if (filteredIndices.length === 0) return;
    const pos = filteredIndices.indexOf(activeSegmentIndex);
    if (pos > 0) {
      setActiveSegmentIndex(filteredIndices[pos - 1]);
    }
  }, [filteredIndices, activeSegmentIndex]);

  const [importing, setImporting] = useState(false);

  // ---- Import docx from within studio ----
  const handleImportDocx = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const fd = new FormData();
        fd.append("file", file);

        const parseData = await fetch("/api/parse-docx", {
          method: "POST",
          body: fd,
        }).then((r) => r.json());
        if (!parseData.success) throw new Error(parseData.error);

        const segData = await fetch("/api/segment-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: parseData.text }),
        }).then((r) => r.json());
        if (!segData.success) throw new Error(segData.error);

        const roleData = await fetch("/api/identify-roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: segData.segments }),
        }).then((r) => r.json());
        if (!roleData.success) throw new Error(roleData.error);

        // Merge roles
        const existingNames = new Set(roles.map((r) => r.name));
        const COLORS = [
          "#EF4444", "#3B82F6", "#10B981", "#F59E0B",
          "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
        ];
        const newRoles = roleData.roles
          .filter((r: { name: string }) => !existingNames.has(r.name))
          .map((r: { name: string }, i: number) => ({
            id: crypto.randomUUID(),
            projectId,
            name: r.name,
            color: COLORS[(roles.length + i) % COLORS.length],
          }));
        const allRoles = [...roles, ...newRoles];
        if (newRoles.length > 0) await saveRolesBatch(allRoles);

        // Create chapter
        const { saveChapter, saveSegments } = await import("@/lib/db");
        const chapter = {
          id: crypto.randomUUID(),
          projectId,
          title: file.name.replace(/\.(docx|doc)$/i, ""),
          order: chapters.length,
          segments: [],
        };
        await saveChapter(chapter);

        // Save segments
        const newSegments: Segment[] = segData.segments.map(
          (raw: { text: string; index: number }) => {
            const a = roleData.segmentRoles.find(
              (sr: { segmentIndex: number }) =>
                sr.segmentIndex === raw.index
            );
            const role = allRoles.find(
              (r) => r.name === (a?.roleName || "旁白")
            );
            return {
              id: crypto.randomUUID(),
              chapterId: chapter.id,
              text: raw.text,
              roleId: role?.id || allRoles[0]?.id || "",
              roleName: a?.roleName || "旁白",
              index: raw.index,
              recordingId: undefined,
            };
          }
        );
        await saveSegments(newSegments);

        window.location.reload();
      } catch (err) {
        console.error("Import failed:", err);
      } finally {
        setImporting(false);
      }
    },
    [projectId, roles, chapters.length, saveRolesBatch]
  );

  // (savedRecordingBlob loading handled by recordedBlob effect below)

  // Stop playback when switching segments
  useEffect(() => {
    if (player.status === "playing") player.stop();
  }, [activeSegmentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Save recording (after optional auto-trim) ----
  const handleSaveRecording = useCallback(async () => {
    if (!recorder.audioBlob || !activeSegment) {
      console.warn("[Save] No audioBlob or activeSegment", { hasBlob: !!recorder.audioBlob, hasSegment: !!activeSegment });
      return;
    }

    try {
      let saveBlob = recorder.audioBlob;
      let saveDuration = recorder.duration;

      // Auto-trim start if enabled
      if (autoTrimStart && saveDuration > autoTrimDuration + 0.05) {
        const { trimAudio } = await import("@/lib/audio-utils");
        saveBlob = await trimAudio(saveBlob, autoTrimDuration, saveDuration);
        saveDuration = saveDuration - autoTrimDuration;
      }

      const recording = {
        id: crypto.randomUUID(),
        segmentId: activeSegment.id,
        audioBlob: saveBlob,
        duration: saveDuration,
        createdAt: new Date().toISOString(),
      };

      await dbSaveRecording(recording);
      await updateSegment({
        ...activeSegment,
        recordingId: recording.id,
      });

      // Move to next filtered segment
      const pos = filteredIndices.indexOf(activeSegmentIndex);
      if (pos >= 0 && pos < filteredIndices.length - 1) {
        setActiveSegmentIndex(filteredIndices[pos + 1]);
      }

      recorder.resetRecording();
    } catch (err) {
      console.error("[Save] Failed:", err);
      alert(`保存失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  }, [
    recorder,
    activeSegment,
    activeSegmentIndex,
    filteredIndices,
    dbSaveRecording,
    updateSegment,
    autoTrimStart,
    autoTrimDuration,
  ]);

  // ---- Handle trim (keep only selection) ----
  const handleTrim = useCallback(
    async (startTime: number, endTime: number) => {
      const blob = recorder.audioBlob || recordedBlob;
      if (!blob) return;
      const { trimAudio } = await import("@/lib/audio-utils");
      const trimmed = await trimAudio(blob, startTime, endTime);
      const newDuration = endTime - startTime;
      if (recorder.audioBlob) {
        recorder.replaceBlob(trimmed, newDuration);
      } else if (activeSegment?.recordingId) {
        const { saveRecording } = await import("@/lib/db");
        const newRecording = {
          id: crypto.randomUUID(),
          segmentId: activeSegment.id,
          audioBlob: trimmed,
          duration: newDuration,
          createdAt: new Date().toISOString(),
        };
        await saveRecording(newRecording);
        await updateSegment({ ...activeSegment, recordingId: newRecording.id });
        setRecordedBlob(trimmed);
        setRecordedDuration(newDuration);
      }
    },
    [recorder, recordedBlob, activeSegment, updateSegment]
  );

  // ---- Handle waveform middle-cut ----
  const handleCut = useCallback(
    async (cutStartTime: number, cutEndTime: number) => {
      const blob = recorder.audioBlob || recordedBlob;
      if (!blob) return;

      const { trimAudio, concatAudioBlobs } = await import(
        "@/lib/audio-utils"
      );
      const totalDuration = recorder.audioBlob
        ? recorder.duration
        : player.duration;

      // Clamp cut times and determine which parts to keep
      const cs = Math.max(0, cutStartTime);
      const ce = Math.min(totalDuration, cutEndTime);
      if (ce <= cs) return;

      const parts: Blob[] = [];
      // Keep left part if it has meaningful duration (> 0.05s)
      if (cs > 0.05) {
        parts.push(await trimAudio(blob, 0, cs));
      }
      // Keep right part if it has meaningful duration
      if (totalDuration - ce > 0.05) {
        parts.push(await trimAudio(blob, ce, totalDuration));
      }

      // If cutting removed everything (shouldn't happen), keep original
      if (parts.length === 0) return;

      const merged =
        parts.length === 1
          ? parts[0]
          : await concatAudioBlobs(parts);
      const newDuration = totalDuration - (ce - cs);

      if (recorder.audioBlob) {
        recorder.replaceBlob(merged, newDuration);
      } else if (activeSegment?.recordingId) {
        const { saveRecording } = await import("@/lib/db");
        const newRecording = {
          id: crypto.randomUUID(),
          segmentId: activeSegment.id,
          audioBlob: merged,
          duration: newDuration,
          createdAt: new Date().toISOString(),
        };
        await saveRecording(newRecording);
        await updateSegment({
          ...activeSegment,
          recordingId: newRecording.id,
        });
        setRecordedBlob(merged);
        setRecordedDuration(newDuration);
      }
    },
    [
      recorder,
      recordedBlob,
      activeSegment,
      player.duration,
      updateSegment,
    ]
  );

  // ---- Split current long text segment into smaller parts ----
  const handleSplitSegment = useCallback(async () => {
    if (!activeSegment || !activeChapterId) return;
    const text = activeSegment.text;

    // Split by sentence boundaries
    const sentences = text
      .split(/(?<=[。！？…~」])/g)
      .filter((s) => s.trim().length > 0);

    let chunks: string[];
    if (sentences.length <= 1) {
      const subParts = text
        .split(/(?<=[，,；;：:、])/g)
        .filter((s) => s.trim().length > 0);
      if (subParts.length <= 1) return;
      chunks = [];
      for (let i = 0; i < subParts.length; i += 2) {
        chunks.push(subParts.slice(i, i + 2).join(""));
      }
    } else {
      chunks = [];
      for (let i = 0; i < sentences.length; i += 3) {
        chunks.push(sentences.slice(i, i + 3).join(""));
      }
    }

    if (chunks.length <= 1) return;

    // Build new segments, preserving any existing recording on the original segment
    const newSegments: Segment[] = chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      chapterId: activeChapterId,
      text: chunk.trim(),
      roleId: activeSegment.roleId,
      roleName: activeSegment.roleName,
      index: activeSegment.index + i,
      // Only the first chunk keeps any existing recordingId
      recordingId: i === 0 ? activeSegment.recordingId : undefined,
    }));

    // Rebuild all segments for this chapter: remove old, insert new, re-index
    const updatedSegments = [
      ...segments.slice(0, activeSegmentIndex),
      ...newSegments,
      ...segments.slice(activeSegmentIndex + 1),
    ].map((s, i) => ({ ...s, index: i }));

    const { replaceSegments } = await import("@/lib/db");
    await replaceSegments(activeChapterId, updatedSegments);
    loadSegments();
  }, [activeSegment, activeChapterId, activeSegmentIndex, segments, loadSegments]);

  // ---- Playback current segment's recording ----
  const handlePlaySegment = useCallback(async () => {
    if (!activeSegment?.recordingId) return;
    const { getRecording } = await import("@/lib/db");
    const rec = await getRecording(activeSegment.recordingId);
    if (rec) {
      await player.loadAudio(rec.audioBlob);
      player.play();
    }
  }, [activeSegment, player]);

  // ---- Preview recording (just recorded, not saved yet) ----
  const handlePreviewRecording = useCallback(async () => {
    if (!recorder.audioBlob) return;
    await player.loadAudio(recorder.audioBlob);
    player.play();
  }, [recorder.audioBlob, player]);

  // Play saved recording (for teleprompter waveform)
  const handlePlaySaved = useCallback(async () => {
    if (!recordedBlob) return;
    await player.loadAudio(recordedBlob);
    player.play();
  }, [recordedBlob, player]);

  // ---- Seek (waveform click-to-position) ----
  const handleSeek = useCallback(
    (time: number) => {
      player.seek(time);
    },
    [player]
  );

  // ---- Play All (concatenate all recorded segments) ----
  const handlePlayAll = useCallback(async () => {
    try {
      const { getRecording } = await import("@/lib/db");
      const { concatAudioBlobs } = await import("@/lib/audio-utils");

      const blobs: Blob[] = [];
      for (const seg of segments) {
        if (seg.recordingId) {
          try {
            const rec = await getRecording(seg.recordingId);
            if (rec) blobs.push(rec.audioBlob);
          } catch { /* skip missing */ }
        }
      }

      console.log(`[PlayAll] Found ${blobs.length} recordings from ${segments.filter(s => s.recordingId).length} segments`);

      if (blobs.length === 0) {
        console.warn("[PlayAll] No recordings to play");
        return;
      }

      const merged = blobs.length === 1 ? blobs[0] : await concatAudioBlobs(blobs);
      await player.loadAudio(merged);
      player.play();
    } catch (err) {
      console.error("[PlayAll] Failed:", err);
      alert(`试听全部失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  }, [segments, player]);

  // ---- Export project as .novel backup ----
  const [exportingNovel, setExportingNovel] = useState(false);

  const handleExportNovel = useCallback(async () => {
    setExportingNovel(true);
    try {
      const zipBlob = await exportProjectToZip(projectId);
      downloadBlob(zipBlob, `${sanitizeFilename(project?.name || "project")}.novel`);
    } catch (err) {
      alert(`导出项目失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setExportingNovel(false);
    }
  }, [projectId, project]);

  // ---- Direct Enter handler (bypasses shortcut system for reliability) ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) return;
      if (recorder.status === "stopped" && recorder.audioBlob) {
        e.preventDefault();
        handleSaveRecording();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recorder.status, recorder.audioBlob, handleSaveRecording]);

  // ---- Keyboard shortcuts ----
  useShortcuts(
    {
      " ": () => {
        if (recorder.status === "recording") {
          recorder.stopRecording();
        } else if (
          recorder.status === "idle" ||
          recorder.status === "stopped"
        ) {
          recorder.startRecording();
        } else if (recorder.status === "paused") {
          recorder.resumeRecording();
        }
      },
      ArrowLeft: () => goToPrevFiltered(),
      ArrowRight: () => goToNextFiltered(),
      "ctrl+z": () => {
        if (activeSegment?.recordingId) {
          updateSegment({ ...activeSegment, recordingId: undefined });
        }
      },
      "ctrl+r": () => {
        recorder.resetRecording();
        recorder.startRecording();
      },
      Enter: () => {
        if (recorder.status === "stopped" && recorder.audioBlob) {
          handleSaveRecording();
        }
      },
      Escape: () => setViewMode("normal"),
      t: () =>
        setViewMode((v) =>
          v === "teleprompter" ? "normal" : "teleprompter"
        ),
      e: () => setShowExport((v) => !v),
      // ---- Teleprompter shortcuts ----
      p: () => {
        if (player.status === "playing") {
          player.pause();
        } else if (activeSegment?.recordingId) {
          handlePlaySegment();
        } else if (recorder.audioBlob) {
          handlePreviewRecording();
        } else if (recordedBlob) {
          handlePlaySaved();
        }
      },
      b: () => {
        if (recorder.status === "stopped" && recorder.audioBlob && recorder.stripSilence) {
          recorder.stripSilence(silenceSettings);
        }
      },
      s: () => {
        if (activeSegment && activeSegment.text.length > 60) {
          handleSplitSegment();
        }
      },
      a: () => {
        teleprompter.toggleAutoScroll();
      },
      "shift+P": () => {
        if (player.status === "playing") {
          player.pause();
        } else if (player.status === "paused") {
          player.play();
        } else {
          handlePlayAll();
        }
      },
      "shift+p": () => {
        if (player.status === "playing") {
          player.pause();
        } else if (player.status === "paused") {
          player.play();
        } else {
          handlePlayAll();
        }
      },
    },
    true
  );

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full gap-4">
        <p className="text-zinc-500">项目不存在</p>
        <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm">
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* ======== Top bar ======== */}
      <header className="h-12 border-b border-zinc-800 flex items-center px-4 gap-4 shrink-0">
        <Link
          href="/"
          className="text-zinc-400 hover:text-zinc-200 text-sm"
        >
          ← 项目列表
        </Link>
        <span className="text-zinc-600">|</span>
        <h1 className="font-semibold text-sm">{project.name}</h1>
        <span className="text-zinc-600">|</span>
        <span className="text-xs text-zinc-500">
          {viewMode === "teleprompter" ? "提词器模式" : "普通模式"}
        </span>
        <span className="text-zinc-600">|</span>
        {/* Role filter — affects navigation */}
        <select
          value={roleFilter || ""}
          onChange={(e) => setRoleFilter(e.target.value || null)}
          className="text-[11px] bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-zinc-300"
          title="只录制选中角色的段落，其他角色自动跳过"
        >
          <option value="">🎭 全部角色</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              🎤 {r.name}
            </option>
          ))}
        </select>
        {roleFilter && (
          <span className="text-[10px] text-yellow-400">
            仅录 {roles.find(r => r.id === roleFilter)?.name || ""} ({filteredIndices.length}段)
          </span>
        )}
        <div className="flex-1" />
        <label
          className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
          title="导入 Word 文档 (.docx)"
        >
          导入文档
          <input
            type="file"
            accept=".docx,.doc"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportDocx(f);
            }}
          />
        </label>
        <button
          onClick={() =>
            setViewMode(
              viewMode === "teleprompter" ? "normal" : "teleprompter"
            )
          }
          className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          title="切换提词器模式 (T)"
        >
          {viewMode === "teleprompter" ? "退出提词器" : "提词器 (T)"}
        </button>
        <button
          onClick={handleExportNovel}
          disabled={exportingNovel}
          className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
          title="导出项目备份 (.novel)，含所有录音数据"
        >
          {exportingNovel ? "导出中..." : "💾 备份"}
        </button>
        <button
          onClick={() => setShowExport(!showExport)}
          className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          title="导出 MP3 (E)"
        >
          导出 (E)
        </button>
      </header>

      {/* ======== Main workspace ======== */}
      <div className="flex-1 flex overflow-hidden">
        {/* ---- Left: chapters + roles ---- */}
        <aside className="w-56 border-r border-zinc-800 flex flex-col p-3 gap-2 shrink-0 overflow-y-auto">
          <ChapterList
            chapters={chapters}
            activeChapterId={activeChapterId}
            onSelect={setActiveChapterId}
            onCreate={createChapter}
            onDelete={removeChapter}
            onReorder={reorderChapters}
          />
          <div className="border-t border-zinc-800 pt-2">
            <RoleEditor
              roles={roles}
              projectId={projectId}
              onAdd={addRole}
              onRolesChanged={setRoles}
            />
          </div>
        </aside>

        {/* ---- Center: text / teleprompter / export ---- */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {showExport ? (
            <div className="flex-1 p-4 overflow-auto">
              <ExportPanel
                segments={segments}
                roles={roles}
                chapterTitle={activeChapter?.title}
              />
            </div>
          ) : viewMode === "teleprompter" ? (
            <Teleprompter
              segments={segments}
              roles={roles}
              activeSegmentIndex={activeSegmentIndex}
              teleprompter={teleprompter}
              onSelectSegment={setActiveSegmentIndex}
              recorder={recorder}
              onSave={handleSaveRecording}
              onExit={() => setViewMode("normal")}
              playerCurrentTime={player.currentTime}
              isPlaying={player.status === "playing"}
              onPreview={handlePreviewRecording}
              onPause={() => player.pause()}
              onCut={handleCut}
              onTrim={handleTrim}
              onSplit={handleSplitSegment}
              silenceSettings={silenceSettings}
              recordedBlob={recordedBlob}
              recordedDuration={recordedDuration}
              onPlaySaved={handlePlaySaved}
              onSeek={handleSeek}
              roleFilter={roleFilter}
              onRoleFilterChange={setRoleFilter}
              onNextFiltered={goToNextFiltered}
              onPrevFiltered={goToPrevFiltered}
              autoTrimStart={autoTrimStart}
              autoTrimDuration={autoTrimDuration}
            />
          ) : (
            <TextViewer
              segments={segments}
              roles={roles}
              activeSegmentIndex={activeSegmentIndex}
              onSelectSegment={setActiveSegmentIndex}
              onImport={handleImportDocx}
              onRoleChange={async (segmentId, roleId, roleName) => {
                const seg = segments.find((s) => s.id === segmentId);
                if (seg) {
                  await updateSegment({ ...seg, roleId, roleName });
                  await loadSegments();
                }
              }}
            />
          )}
          {importing && (
            <div className="absolute inset-0 bg-zinc-950/80 flex items-center justify-center gap-4 z-10">
              <div className="animate-spin text-2xl">⏳</div>
              <span className="text-zinc-400">正在导入文档...</span>
            </div>
          )}
        </main>

        {/* ---- Right: recording + waveform + playback ---- */}
        <aside className="w-80 border-l border-zinc-800 flex flex-col shrink-0 overflow-y-auto">
          {/* Current segment info */}
          <SegmentRecorder
            segment={activeSegment}
            roles={roles}
            recorder={recorder}
            onSplit={handleSplitSegment}
          />

          {/* Waveform (visible when recording is stopped with audio) */}
          {recorder.status === "stopped" && recorder.audioBlob && (
            <div className="p-3 border-t border-zinc-800">
              <p className="text-xs font-medium text-zinc-400 mb-2">
                波形预览
                {autoTrimStart && (
                  <span className="text-red-400 ml-2 font-normal">
                    ⚠ 保存时切除前 {autoTrimDuration} 秒
                  </span>
                )}
                <span className="text-zinc-600 ml-2 font-normal">
                  点击定位 · 拖拽选区
                </span>
              </p>
              <TrackWaveform
                audioBlob={recorder.audioBlob}
                duration={recorder.duration}
                currentTime={player.currentTime}
                isPlaying={player.status === "playing"}
                onTrim={handleTrim}
                onCut={handleCut}
                onSeek={handleSeek}
                autoTrimStart={autoTrimStart ? 0 : undefined}
                autoTrimEnd={autoTrimStart ? autoTrimDuration : undefined}
              />
              {/* Quick actions */}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handlePreviewRecording}
                  className="flex-1 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded flex items-center justify-center gap-1 transition-colors"
                  title="试听/暂停 (P)"
                >
                  {player.status === "playing" ? "⏸ 暂停试听" : "▶ 试听录制内容"}
                  <kbd className="text-[9px] opacity-50">P</kbd>
                </button>
                <button
                  onClick={() => recorder.stripSilence(silenceSettings)}
                  className="py-1.5 px-3 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded flex items-center gap-1 transition-colors"
                  title="自动检测并去除录音中的静音空白片段 (B)"
                >
                  🔇 去空白
                  <kbd className="text-[9px] opacity-50">B</kbd>
                </button>
              </div>
            </div>
          )}

          {/* Saved recording waveform */}
          {activeSegment?.recordingId &&
            recordedBlob &&
            recorder.status === "idle" && (
              <div className="p-3 border-t border-zinc-800">
                <p className="text-xs font-medium text-green-400 mb-2">
                  ✓ 已录制 · 波形回放
                </p>
                <TrackWaveform
                  audioBlob={recordedBlob}
                  duration={recordedDuration}
                  currentTime={player.currentTime}
                  isPlaying={player.status === "playing"}
                  onTrim={handleTrim}
                  onCut={handleCut}
                  onSeek={handleSeek}
                />
              </div>
            )}

          {/* Recording controls */}
          <div className="p-3 border-t border-zinc-800">
            {/* Auto-trim toggle */}
            <div
              onClick={() => setAutoTrimStart(!autoTrimStart)}
              className={`flex items-center gap-2 mb-3 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-xs select-none ${
                autoTrimStart
                  ? "bg-blue-600/20 border border-blue-600/40 text-blue-300"
                  : "bg-zinc-800/50 border border-zinc-700/50 text-zinc-500 hover:text-zinc-400"
              }`}
              title="开启后每次保存录音时自动切除前 0.5 秒的麦克风噪音"
            >
              <div
                className={`w-7 h-4 rounded-full relative transition-colors ${
                  autoTrimStart ? "bg-blue-500" : "bg-zinc-600"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${
                    autoTrimStart ? "left-3.5" : "left-0.5"
                  }`}
                />
              </div>
              <span>切除开头噪音 (0.5s)</span>
            </div>

            <RecordControls
              recorder={recorder}
              onStopAndSave={handleSaveRecording}
            />
          </div>

          {/* Playback */}
          <div className="p-3 border-t border-zinc-800">
            <PlaybackBar
              player={player}
              hasRecording={
                !!activeSegment?.recordingId ||
                !!recorder.audioBlob
              }
              onPlay={
                activeSegment?.recordingId
                  ? handlePlaySegment
                  : handlePreviewRecording
              }
            />
          </div>

          {/* Progress bar + Play All */}
          <div className="p-3 border-t border-zinc-800 mt-auto">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-zinc-500">
                进度：{activeSegmentIndex + 1} / {segments.length}
                <span className="ml-2 text-green-500">
                  ({segments.filter((s) => s.recordingId).length} 已录)
                </span>
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (player.status === "playing") {
                      player.pause();
                    } else if (player.status === "paused") {
                      player.play();
                    } else {
                      handlePlayAll();
                    }
                  }}
                  className="text-[10px] px-2 py-0.5 rounded text-white bg-blue-600 hover:bg-blue-500 transition-colors"
                  title={
                    player.status === "playing"
                      ? "暂停"
                      : player.status === "paused"
                      ? "继续播放"
                      : "试听全部已录音段落 (Shift+P)"
                  }
                >
                  {player.status === "playing"
                    ? "⏸ 暂停"
                    : player.status === "paused"
                    ? "▶ 继续"
                    : "▶▶ 试听全部"}
                  <kbd className="text-[8px] opacity-60 ml-0.5">
                    {player.status === "idle" ? "⇧P" : ""}
                  </kbd>
                </button>
                {(player.status === "playing" || player.status === "paused") && (
                  <button
                    onClick={() => player.stop()}
                    className="text-[10px] px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                    title="停止播放"
                  >
                    ⏹
                  </button>
                )}
              </div>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{
                  width:
                    segments.length > 0
                      ? `${
                          (segments.filter((s) => s.recordingId).length /
                            segments.length) *
                          100
                        }%`
                      : "0%",
                }}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* Settings panel — bottom-left gear button */}
      <SettingsPanel
        silenceThreshold={silenceSettings.silenceThreshold}
        minSilenceDuration={silenceSettings.minSilenceDuration}
        onSilenceSettingsChange={(silenceThreshold, minSilenceDuration) =>
          setSilenceSettings({ silenceThreshold, minSilenceDuration })
        }
      />
    </div>
  );
}

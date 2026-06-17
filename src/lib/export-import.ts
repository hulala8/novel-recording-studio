// ============================================================
// Project export / import — .novel ZIP format
// ============================================================

import JSZip from "jszip";
import {
  getProject,
  getChaptersByProject,
  getSegmentsByChapter,
  getRolesByProject,
  getRecording,
  saveProject,
  saveChapter,
  saveSegments,
  saveRoles,
  saveRecording,
} from "./db";
import type {
  ExportManifest,
  ExportRecordingMeta,
  ImportProgress,
  RecordingData,
  Segment,
} from "./types";

const FORMAT_VERSION = 1;

// ============================================================
// Export
// ============================================================

/**
 * Export an entire project (metadata + all recording blobs) as a .novel ZIP Blob.
 */
export async function exportProjectToZip(projectId: string): Promise<Blob> {
  const zip = new JSZip();

  // 1. Load all data from IndexedDB
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`项目不存在: ${projectId}`);
  }

  const chapters = await getChaptersByProject(projectId);

  // Load segments for each chapter
  const allSegments: Segment[] = [];
  for (const ch of chapters) {
    const segs = await getSegmentsByChapter(ch.id);
    allSegments.push(...segs);
  }

  const roles = await getRolesByProject(projectId);

  // Load recordings referenced by segments
  const recordingsMeta: ExportRecordingMeta[] = [];
  const recordingsFolder = zip.folder("recordings")!;

  for (const seg of allSegments) {
    if (!seg.recordingId) continue;
    try {
      const rec = await getRecording(seg.recordingId);
      if (!rec) {
        console.warn(`[Export] Recording not found: ${seg.recordingId}`);
        continue;
      }

      // Determine file extension from blob MIME type
      let ext = ".wav";
      if (rec.audioBlob.type.includes("webm")) ext = ".webm";
      else if (rec.audioBlob.type.includes("mp3")) ext = ".mp3";
      else if (rec.audioBlob.type.includes("ogg")) ext = ".ogg";

      const fileName = `recordings/${rec.id}${ext}`;

      recordingsMeta.push({
        id: rec.id,
        segmentId: rec.segmentId,
        duration: rec.duration,
        createdAt: rec.createdAt,
        fileName,
      });

      // Add binary audio blob to zip
      recordingsFolder.file(
        `${rec.id}${ext}`,
        rec.audioBlob,
        { binary: true }
      );
    } catch (err) {
      console.warn(
        `[Export] Skipping recording ${seg.recordingId}:`,
        err
      );
    }
  }

  // 2. Build manifest
  const manifest: ExportManifest = {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    chapters,
    segments: allSegments,
    roles,
    recordings: recordingsMeta,
  };

  // 3. Add manifest.json to zip
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // 4. Generate zip blob
  const blob = await zip.generateAsync({ type: "blob" });
  return blob;
}

// ============================================================
// Import
// ============================================================

/**
 * Import a project from a .novel ZIP file.
 * Returns the imported project ID.
 *
 * @param zipFile - The .novel file selected by the user
 * @param onProgress - Optional progress callback
 * @param duplicateMode - 'error' | 'replace' | 'copy' — how to handle ID conflicts
 */
export async function importProjectFromZip(
  zipFile: File,
  onProgress?: (progress: ImportProgress) => void,
  duplicateMode: "error" | "replace" | "copy" = "error"
): Promise<string> {
  // Size sanity check
  const MAX_SIZE = 1024 * 1024 * 1024; // 1GB
  if (zipFile.size > MAX_SIZE) {
    throw new Error(
      `文件过大 (${(zipFile.size / 1024 / 1024).toFixed(0)} MB)。最大支持 1 GB。`
    );
  }

  // Parse ZIP
  onProgress?.({ step: "parsing", current: 0, total: 1 });
  const arrayBuffer = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Read manifest
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("无效的 .novel 文件：缺少 manifest.json");
  }

  const manifestText = await manifestFile.async("string");
  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error("无效的 .novel 文件：manifest.json 无法解析");
  }

  // Validate manifest
  if (!manifest.formatVersion || manifest.formatVersion > FORMAT_VERSION) {
    throw new Error(
      `不支持的格式版本 ${manifest.formatVersion}。请升级应用。`
    );
  }
  if (!manifest.project?.id) {
    throw new Error("无效的 .novel 文件：缺少项目 ID");
  }

  // Handle duplicate project ID
  const existingProject = await getProject(manifest.project.id);
  if (existingProject) {
    if (duplicateMode === "error") {
      throw new Error(
        `DUPLICATE:${manifest.project.id}:${manifest.project.name}`
      );
    }
    if (duplicateMode === "copy") {
      manifest.project.id = crypto.randomUUID();
      // Remap chapter → segment → recording IDs
      const chapterIdMap = new Map<string, string>();
      const segmentIdMap = new Map<string, string>();

      for (const ch of manifest.chapters) {
        const newChId = crypto.randomUUID();
        chapterIdMap.set(ch.id, newChId);
        ch.id = newChId;
        ch.projectId = manifest.project.id;
      }
      for (const seg of manifest.segments) {
        const newSegId = crypto.randomUUID();
        segmentIdMap.set(seg.id, newSegId);
        seg.id = newSegId;
        seg.chapterId = chapterIdMap.get(seg.chapterId) || seg.chapterId;
      }
      for (const rec of manifest.recordings) {
        const newRecId = crypto.randomUUID();
        rec.segmentId = segmentIdMap.get(rec.segmentId) || rec.segmentId;
        rec.id = newRecId;
      }
      for (const role of manifest.roles) {
        role.id = crypto.randomUUID();
        role.projectId = manifest.project.id;
      }
    }
    // 'replace' mode: just proceed — existing data will be overwritten
  }

  // Import recordings from ZIP
  const recCount = manifest.recordings.length;
  onProgress?.({ step: "importing_recordings", current: 0, total: recCount });

  const recordingDataList: RecordingData[] = [];
  for (let i = 0; i < recCount; i++) {
    const meta = manifest.recordings[i];
    try {
      const zipEntry = zip.file(meta.fileName);
      if (!zipEntry) {
        console.warn(`[Import] Recording file not found in zip: ${meta.fileName}`);
        continue;
      }
      const audioBlob = await zipEntry.async("blob");
      recordingDataList.push({
        id: meta.id,
        segmentId: meta.segmentId,
        audioBlob,
        duration: meta.duration,
        createdAt: meta.createdAt,
      });
    } catch (err) {
      console.warn(`[Import] Skipping recording ${meta.id}:`, err);
    }
    onProgress?.({ step: "importing_recordings", current: i + 1, total: recCount });
  }

  // Save everything to IndexedDB
  onProgress?.({ step: "saving", current: 0, total: 1 });

  try {
    await saveProject(manifest.project);
    await saveRoles(manifest.roles);
    for (const ch of manifest.chapters) {
      await saveChapter(ch);
    }
    await saveSegments(manifest.segments);
    for (const rec of recordingDataList) {
      await saveRecording(rec);
    }
  } catch (err) {
    throw new Error(
      `保存数据失败：${err instanceof Error ? err.message : "未知错误"}`
    );
  }

  return manifest.project.id;
}

// ============================================================
// Utility
// ============================================================

/**
 * Sanitize a project name for use as a filename.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim() || "novel-project";
}

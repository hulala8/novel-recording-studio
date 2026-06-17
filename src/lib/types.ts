// ============================================================
// Core data types for the Novel Recording Studio
// ============================================================

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  roles: Role[];
}

export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  order: number;
  segments: Segment[];
}

export interface Segment {
  id: string;
  chapterId: string;
  text: string;
  roleId: string;
  roleName: string;
  index: number;
  recordingId?: string;
}

export interface Role {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface RecordingData {
  id: string;
  segmentId: string;
  audioBlob: Blob;
  duration: number;
  createdAt: string;
}

// ============================================================
// API types
// ============================================================

export interface ParseDocxResponse {
  success: boolean;
  text: string;
  error?: string;
}

export interface SegmentRequest {
  text: string;
}

export interface SegmentResponse {
  success: boolean;
  segments: RawSegment[];
  error?: string;
}

export interface RawSegment {
  text: string;
  index: number;
  type: "narration" | "dialogue";
}

export interface IdentifyRolesRequest {
  segments: RawSegment[];
}

export interface IdentifyRolesResponse {
  success: boolean;
  roles: { name: string; color: string }[];
  segmentRoles: { segmentIndex: number; roleName: string }[];
  error?: string;
}

// ============================================================
// App state (zustand store)
// ============================================================

export type RecordingStatus =
  | "idle"
  | "recording"
  | "paused"
  | "stopped";

export type AppView = "projects" | "studio";

// ============================================================
// Export / Import types
// ============================================================

export interface ExportManifest {
  formatVersion: number;
  exportedAt: string;
  project: Project;
  chapters: Chapter[];
  segments: Segment[];
  roles: Role[];
  recordings: ExportRecordingMeta[];
}

export interface ExportRecordingMeta {
  id: string;
  segmentId: string;
  duration: number;
  createdAt: string;
  fileName: string; // path inside ZIP, e.g. "recordings/<id>.wav"
}

export interface ImportProgress {
  step: "parsing" | "importing_recordings" | "saving";
  current: number;
  total: number;
}

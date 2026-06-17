// ============================================================
// IndexedDB database layer for local storage
// ============================================================

import { openDB, IDBPDatabase } from "idb";
import type { Project, Chapter, Segment, Role, RecordingData } from "./types";

const DB_NAME = "novel-recorder";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Projects store
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        // Chapters store
        if (!db.objectStoreNames.contains("chapters")) {
          const chapterStore = db.createObjectStore("chapters", {
            keyPath: "id",
          });
          chapterStore.createIndex("projectId", "projectId");
        }
        // Segments store
        if (!db.objectStoreNames.contains("segments")) {
          const segmentStore = db.createObjectStore("segments", {
            keyPath: "id",
          });
          segmentStore.createIndex("chapterId", "chapterId");
        }
        // Roles store
        if (!db.objectStoreNames.contains("roles")) {
          const roleStore = db.createObjectStore("roles", {
            keyPath: "id",
          });
          roleStore.createIndex("projectId", "projectId");
        }
        // Recordings store
        if (!db.objectStoreNames.contains("recordings")) {
          const recordingStore = db.createObjectStore("recordings", {
            keyPath: "id",
          });
          recordingStore.createIndex("segmentId", "segmentId");
        }
      },
    });
  }
  return dbPromise;
}

// ============================================================
// Projects
// ============================================================

export async function getAllProjects(): Promise<Project[]> {
  const db = await getDB();
  return db.getAll("projects");
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDB();
  return db.get("projects", id);
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDB();
  await db.put("projects", { ...project, updatedAt: new Date().toISOString() });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  // Delete all related data
  const chapters = await db.getAllFromIndex("chapters", "projectId", id);
  for (const ch of chapters) {
    const segments = await db.getAllFromIndex("segments", "chapterId", ch.id);
    for (const seg of segments) {
      if (seg.recordingId) {
        await db.delete("recordings", seg.recordingId);
      }
      await db.delete("segments", seg.id);
    }
    await db.delete("chapters", ch.id);
  }
  const roles = await db.getAllFromIndex("roles", "projectId", id);
  for (const role of roles) {
    await db.delete("roles", role.id);
  }
  await db.delete("projects", id);
}

// ============================================================
// Chapters
// ============================================================

export async function getChaptersByProject(
  projectId: string
): Promise<Chapter[]> {
  const db = await getDB();
  const chapters = await db.getAllFromIndex(
    "chapters",
    "projectId",
    projectId
  );
  return chapters.sort((a, b) => a.order - b.order);
}

export async function saveChapter(chapter: Chapter): Promise<void> {
  const db = await getDB();
  await db.put("chapters", chapter);
}

export async function deleteChapter(id: string): Promise<void> {
  const db = await getDB();
  const segments = await db.getAllFromIndex("segments", "chapterId", id);
  for (const seg of segments) {
    if (seg.recordingId) {
      await db.delete("recordings", seg.recordingId);
    }
    await db.delete("segments", seg.id);
  }
  await db.delete("chapters", id);
}

// ============================================================
// Segments
// ============================================================

export async function getSegmentsByChapter(
  chapterId: string
): Promise<Segment[]> {
  const db = await getDB();
  const segments = await db.getAllFromIndex(
    "segments",
    "chapterId",
    chapterId
  );
  return segments.sort((a, b) => a.index - b.index);
}

export async function saveSegment(segment: Segment): Promise<void> {
  const db = await getDB();
  await db.put("segments", segment);
}

export async function saveSegments(segments: Segment[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("segments", "readwrite");
  for (const seg of segments) {
    await tx.store.put(seg);
  }
  await tx.done;
}

export async function deleteSegment(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("segments", id);
}

export async function replaceSegments(
  chapterId: string,
  newSegments: Segment[]
): Promise<void> {
  const db = await getDB();
  // Delete all existing segments for this chapter
  const old = await db.getAllFromIndex("segments", "chapterId", chapterId);
  const tx = db.transaction("segments", "readwrite");
  for (const seg of old) {
    await tx.store.delete(seg.id);
  }
  for (const seg of newSegments) {
    await tx.store.put(seg);
  }
  await tx.done;
}

// ============================================================
// Roles
// ============================================================

export async function getRolesByProject(projectId: string): Promise<Role[]> {
  const db = await getDB();
  return db.getAllFromIndex("roles", "projectId", projectId);
}

export async function saveRole(role: Role): Promise<void> {
  const db = await getDB();
  await db.put("roles", role);
}

export async function saveRoles(roles: Role[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("roles", "readwrite");
  for (const role of roles) {
    await tx.store.put(role);
  }
  await tx.done;
}

// ============================================================
// Batch role operations
// ============================================================

/**
 * Batch-update role assignment for all segments in a chapter.
 * Used when user renames a role or bulk-reassigns segments.
 */
export async function replaceSegmentsRole(
  chapterId: string,
  oldRoleId: string,
  newRoleId: string,
  newRoleName: string
): Promise<void> {
  const db = await getDB();
  const segments = await db.getAllFromIndex("segments", "chapterId", chapterId);
  const tx = db.transaction("segments", "readwrite");
  for (const seg of segments) {
    if (seg.roleId === oldRoleId) {
      seg.roleId = newRoleId;
      seg.roleName = newRoleName;
      await tx.store.put(seg);
    }
  }
  await tx.done;
}

/**
 * Merge one role into another existing role across the whole project.
 * All segments owned by sourceRoleId are reassigned to targetRoleId, then the
 * source role is removed so the role list cannot contain duplicate names.
 */
export async function mergeRoleIntoExisting(
  sourceRoleId: string,
  targetRoleId: string,
  targetRoleName: string,
  projectId: string
): Promise<void> {
  if (sourceRoleId === targetRoleId) return;

  const db = await getDB();
  const chapters = await db.getAllFromIndex("chapters", "projectId", projectId);

  for (const ch of chapters) {
    const segments = await db.getAllFromIndex("segments", "chapterId", ch.id);
    const tx = db.transaction("segments", "readwrite");
    for (const seg of segments) {
      if (seg.roleId === sourceRoleId) {
        seg.roleId = targetRoleId;
        seg.roleName = targetRoleName;
        await tx.store.put(seg);
      }
    }
    await tx.done;
  }

  await db.delete("roles", sourceRoleId);
}

/**
 * Delete a role from a project and reassign its segments to 旁白 (narrator).
 * Returns the 旁白 role's id, or creates one if it doesn't exist.
 */
export async function deleteRoleAndReassignToNarrator(
  roleId: string,
  roleName: string,
  projectId: string
): Promise<void> {
  const db = await getDB();

  // Find or create narrator role
  let narratorId = "";
  const projectRoles = await db.getAllFromIndex("roles", "projectId", projectId);
  const narrator = projectRoles.find((r) => r.name === "旁白");
  if (narrator) {
    narratorId = narrator.id;
  } else {
    narratorId = crypto.randomUUID();
    await db.put("roles", {
      id: narratorId,
      projectId,
      name: "旁白",
      color: "#6B7280",
    });
  }

  // Delete the role
  await db.delete("roles", roleId);

  // Reassign all segments with this role to narrator
  const chapters = await db.getAllFromIndex("chapters", "projectId", projectId);
  for (const ch of chapters) {
    const segments = await db.getAllFromIndex("segments", "chapterId", ch.id);
    const tx = db.transaction("segments", "readwrite");
    for (const seg of segments) {
      if (seg.roleId === roleId) {
        seg.roleId = narratorId;
        seg.roleName = "旁白";
        await tx.store.put(seg);
      }
    }
    await tx.done;
  }
}

/**
 * Rename a role and update all segments referencing it across all chapters.
 */
export async function renameRole(
  roleId: string,
  projectId: string,
  newName: string
): Promise<void> {
  const db = await getDB();

  // Update the role itself
  const role = await db.get("roles", roleId);
  if (role) {
    role.name = newName;
    await db.put("roles", role);
  }

  // Update all segments with this roleId
  const chapters = await db.getAllFromIndex("chapters", "projectId", projectId);
  for (const ch of chapters) {
    const segments = await db.getAllFromIndex("segments", "chapterId", ch.id);
    const tx = db.transaction("segments", "readwrite");
    for (const seg of segments) {
      if (seg.roleId === roleId) {
        seg.roleName = newName;
        await tx.store.put(seg);
      }
    }
    await tx.done;
  }
}

// ============================================================
// Recordings
// ============================================================

export async function getRecording(
  id: string
): Promise<RecordingData | undefined> {
  const db = await getDB();
  return db.get("recordings", id);
}

export async function saveRecording(recording: RecordingData): Promise<void> {
  const db = await getDB();
  await db.put("recordings", recording);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("recordings", id);
}

export async function getAllRecordings(): Promise<RecordingData[]> {
  const db = await getDB();
  return db.getAll("recordings");
}

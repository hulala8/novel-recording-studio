// ============================================================
// useIndexedDB — React hook wrapping IndexedDB operations
// ============================================================

"use client";

import { useState, useCallback, useEffect } from "react";
import type { Project, Chapter, Segment, Role, RecordingData } from "@/lib/types";
import * as db from "@/lib/db";

function runAfterRender(task: () => void | Promise<void>) {
  queueMicrotask(() => {
    void task();
  });
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    const all = await db.getAllProjects();
    setProjects(all.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ));
    setLoading(false);
  }, []);

  useEffect(() => {
    runAfterRender(loadProjects);
  }, [loadProjects]);

  const createProject = useCallback(async (name: string) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const project: Project = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      roles: [
        { id: crypto.randomUUID(), projectId: id, name: "旁白", color: "#6B7280" },
      ],
    };
    await db.saveProject(project);
    await loadProjects();
    return project;
  }, [loadProjects]);

  const updateProject = useCallback(
    async (project: Project) => {
      await db.saveProject(project);
      await loadProjects();
    },
    [loadProjects]
  );

  const removeProject = useCallback(
    async (id: string) => {
      await db.deleteProject(id);
      await loadProjects();
    },
    [loadProjects]
  );

  return { projects, loading, loadProjects, createProject, updateProject, removeProject };
}

export function useChapters(projectId: string) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);

  const loadChapters = useCallback(async () => {
    if (!projectId) {
      setChapters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const chs = await db.getChaptersByProject(projectId);
    setChapters(chs);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    runAfterRender(loadChapters);
  }, [loadChapters]);

  const createChapter = useCallback(
    async (title: string) => {
      const chapter: Chapter = {
        id: crypto.randomUUID(),
        projectId,
        title,
        order: chapters.length,
        segments: [],
      };
      await db.saveChapter(chapter);
      await loadChapters();
      return chapter;
    },
    [projectId, chapters.length, loadChapters]
  );

  const updateChapter = useCallback(
    async (chapter: Chapter) => {
      await db.saveChapter(chapter);
      await loadChapters();
    },
    [loadChapters]
  );

  const removeChapter = useCallback(
    async (id: string) => {
      await db.deleteChapter(id);
      await loadChapters();
    },
    [loadChapters]
  );

  const reorderChapters = useCallback(
    async (reordered: Chapter[]) => {
      const updated = reordered.map((ch, i) => ({ ...ch, order: i }));
      for (const ch of updated) {
        await db.saveChapter(ch);
      }
      setChapters(updated);
    },
    []
  );

  return { chapters, loading, loadChapters, createChapter, updateChapter, removeChapter, reorderChapters };
}

export function useSegments(chapterId: string) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSegments = useCallback(async () => {
    if (!chapterId) {
      setSegments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSegments(await db.getSegmentsByChapter(chapterId));
    setLoading(false);
  }, [chapterId]);

  useEffect(() => {
    runAfterRender(loadSegments);
  }, [loadSegments]);

  const importSegments = useCallback(
    async (newSegments: Segment[]) => {
      await db.saveSegments(newSegments);
      setSegments(newSegments);
    },
    []
  );

  const updateSegment = useCallback(async (segment: Segment) => {
    await db.saveSegment(segment);
    setSegments((prev) =>
      prev.map((s) => (s.id === segment.id ? segment : s))
    );
  }, []);

  return { segments, loading, loadSegments, importSegments, updateSegment };
}

export function useRoles(projectId: string) {
  const [roles, setRoles] = useState<Role[]>([]);

  const loadRoles = useCallback(async () => {
    if (!projectId) {
      setRoles([]);
      return;
    }
    setRoles(await db.getRolesByProject(projectId));
  }, [projectId]);

  useEffect(() => {
    runAfterRender(loadRoles);
  }, [loadRoles]);

  const saveRolesBatch = useCallback(
    async (newRoles: Role[]) => {
      await db.saveRoles(newRoles);
      setRoles(newRoles);
    },
    []
  );

  const addRole = useCallback(
    async (name: string, color: string) => {
      const role: Role = {
        id: crypto.randomUUID(),
        projectId,
        name,
        color,
      };
      await db.saveRole(role);
      await loadRoles();
      return role;
    },
    [projectId, loadRoles]
  );

  return { roles, loadRoles, saveRolesBatch, addRole, setRoles };
}

export function useRecordings() {
  const [recordings, setRecordings] = useState<RecordingData[]>([]);

  const loadRecordings = useCallback(async () => {
    setRecordings(await db.getAllRecordings());
  }, []);

  useEffect(() => {
    runAfterRender(loadRecordings);
  }, [loadRecordings]);

  const saveRecording = useCallback(
    async (recording: RecordingData) => {
      await db.saveRecording(recording);
      await loadRecordings();
    },
    [loadRecordings]
  );

  const removeRecording = useCallback(
    async (id: string) => {
      await db.deleteRecording(id);
      await loadRecordings();
    },
    [loadRecordings]
  );

  return { recordings, loadRecordings, saveRecording, removeRecording };
}

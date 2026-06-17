// ============================================================
// useShortcuts — Global keyboard shortcut handler
// ============================================================

"use client";

import { useEffect } from "react";

export interface ShortcutMap {
  [key: string]: () => void;
}

/**
 * Register keyboard shortcuts.
 * Keys are formatted as "ctrl+key" or just "key".
 * Example: { "Space": startRecord, "ctrl+z": undo, "ArrowLeft": prevSegment }
 */
export function useShortcuts(
  shortcuts: ShortcutMap,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture shortcuts when typing in input/textarea
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      const isEditable =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target.isContentEditable;

      if (isEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;

      let combo = "";
      if (ctrl) combo += "ctrl+";
      if (shift) combo += "shift+";
      if (alt) combo += "alt+";
      combo += e.key;

      // Try matching in priority order: exact combo → key only → lowercase combo
      const handler =
        shortcuts[combo] ||
        shortcuts[e.key] ||
        shortcuts[combo.toLowerCase()];

      if (handler) {
        e.preventDefault();
        handler();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, enabled]);
}

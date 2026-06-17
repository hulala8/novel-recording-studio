// ============================================================
// useTeleprompter — Auto-scrolling teleprompter for recording
// ============================================================

"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface TeleprompterState {
  scrollSpeed: number; // pixels per second
  isAutoScrolling: boolean;
  fontSize: number;
}

export function useTeleprompter() {
  const [state, setState] = useState<TeleprompterState>({
    scrollSpeed: 30,
    isAutoScrolling: false,
    fontSize: 28,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startAutoScroll = useCallback(() => {
    setState((prev) => ({ ...prev, isAutoScrolling: true }));
  }, []);

  const stopAutoScroll = useCallback(() => {
    setState((prev) => ({ ...prev, isAutoScrolling: false }));
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Drive scrolling
  useEffect(() => {
    if (state.isAutoScrolling) {
      intervalRef.current = setInterval(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop +=
            state.scrollSpeed / 20; // 20 ticks per second
        }
      }, 50);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state.isAutoScrolling, state.scrollSpeed]);

  const setScrollSpeed = useCallback((speed: number) => {
    setState((prev) => ({ ...prev, scrollSpeed: Math.max(5, Math.min(100, speed)) }));
  }, []);

  const setFontSize = useCallback((size: number) => {
    setState((prev) => ({ ...prev, fontSize: Math.max(16, Math.min(72, size)) }));
  }, []);

  const toggleAutoScroll = useCallback(() => {
    setState((prev) => ({ ...prev, isAutoScrolling: !prev.isAutoScrolling }));
  }, []);

  const scrollToSegment = useCallback((elementId: string) => {
    const el = document.getElementById(elementId);
    if (el && containerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const scrollBy = useCallback((deltaY: number) => {
    if (containerRef.current) {
      containerRef.current.scrollTop += deltaY;
    }
  }, []);

  return {
    ...state,
    containerRef,
    startAutoScroll,
    stopAutoScroll,
    toggleAutoScroll,
    setScrollSpeed,
    setFontSize,
    scrollToSegment,
    scrollBy,
  };
}

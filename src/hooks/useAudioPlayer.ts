// ============================================================
// useAudioPlayer — Web Audio API playback hook
// ============================================================

"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type PlaybackStatus = "idle" | "playing" | "paused";

interface AudioPlayerState {
  status: PlaybackStatus;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  error: string | null;
}

export function useAudioPlayer() {
  const [state, setState] = useState<AudioPlayerState>({
    status: "idle",
    currentTime: 0,
    duration: 0,
    playbackRate: 1.0,
    volume: 0.8,
    error: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const gainNodeRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number>(0);
  const ignoreEndedRef = useRef(false);
  const playbackRunRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      sourceRef.current?.stop();
      audioContextRef.current?.close();
    };
  }, []);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
      gainNodeRef.current.gain.value = state.volume;
    }
    return audioContextRef.current;
  }, [state.volume]);

  const stopCurrentSource = useCallback((ignoreEnded = true) => {
    if (!sourceRef.current) return;
    if (ignoreEnded) {
      ignoreEndedRef.current = true;
    }
    try {
      sourceRef.current.stop();
    } catch {
      // Already stopped sources throw in some browsers; safe to ignore.
    }
    sourceRef.current = null;
  }, []);

  const resetAfterNaturalEnd = useCallback((runId: number) => {
    if (playbackRunRef.current !== runId) return;
    playbackRunRef.current += 1;
    sourceRef.current = null;
    pauseOffsetRef.current = 0;
    cancelAnimationFrame(rafRef.current);
    setState((prev) => ({
      ...prev,
      status: "idle",
      currentTime: 0,
    }));
  }, []);

  const loadAudio = useCallback(
    async (blob: Blob) => {
      try {
        stopCurrentSource();
        playbackRunRef.current += 1;
        pauseOffsetRef.current = 0;
        cancelAnimationFrame(rafRef.current);

        const ctx = getAudioContext();
        const arrayBuffer = await blob.arrayBuffer();
        audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer);

        setState((prev) => ({
          ...prev,
          duration: audioBufferRef.current!.duration,
          currentTime: 0,
          status: "idle",
          error: null,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error:
            err instanceof Error
              ? err.message
              : "Failed to load audio",
        }));
      }
    },
    [getAudioContext, stopCurrentSource]
  );

  const play = useCallback(() => {
    if (!audioBufferRef.current) return;

    const ctx = getAudioContext();
    // Stop any existing source without treating it as natural playback end.
    stopCurrentSource();
    playbackRunRef.current += 1;
    const runId = playbackRunRef.current;

    const source = ctx.createBufferSource();
    source.buffer = audioBufferRef.current;
    source.playbackRate.value = state.playbackRate;

    source.connect(gainNodeRef.current!);
    const duration = audioBufferRef.current.duration;
    const offset = Math.max(0, Math.min(pauseOffsetRef.current, duration));
    if (offset >= duration) {
      pauseOffsetRef.current = 0;
    }
    source.start(0, pauseOffsetRef.current);
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime - pauseOffsetRef.current;

    source.onended = () => {
      if (ignoreEndedRef.current) {
        ignoreEndedRef.current = false;
        return;
      }
      resetAfterNaturalEnd(runId);
    };

    setState((prev) => ({ ...prev, status: "playing" }));

    // Update currentTime via requestAnimationFrame
    const updateTime = () => {
      if (playbackRunRef.current !== runId) return;
      if (!audioContextRef.current) return;
      const elapsed =
        audioContextRef.current.currentTime - startTimeRef.current;
      setState((prev) => ({
        ...prev,
        currentTime: Math.min(elapsed, prev.duration),
      }));
      rafRef.current = requestAnimationFrame(updateTime);
    };
    rafRef.current = requestAnimationFrame(updateTime);
  }, [getAudioContext, resetAfterNaturalEnd, state.playbackRate, stopCurrentSource]);

  const pause = useCallback(() => {
    if (state.status !== "playing") return;

    const elapsed = getAudioContext().currentTime - startTimeRef.current;
    stopCurrentSource();
    pauseOffsetRef.current = Math.max(0, elapsed);
    cancelAnimationFrame(rafRef.current);

    setState((prev) => ({ ...prev, status: "paused" }));
  }, [state.status, getAudioContext, stopCurrentSource]);

  const stop = useCallback(() => {
    stopCurrentSource();
    playbackRunRef.current += 1;
    pauseOffsetRef.current = 0;
    cancelAnimationFrame(rafRef.current);

    setState((prev) => ({
      ...prev,
      status: "idle",
      currentTime: 0,
    }));
  }, [stopCurrentSource]);

  const seek = useCallback(
    (time: number) => {
      const nextTime = Math.max(
        0,
        Math.min(time, audioBufferRef.current?.duration || 0)
      );
      pauseOffsetRef.current = nextTime;
      setState((prev) => ({ ...prev, currentTime: nextTime }));

      if (state.status === "playing") {
        // Restart from new position
        stopCurrentSource();
        playbackRunRef.current += 1;
        const runId = playbackRunRef.current;
        const ctx = getAudioContext();
        const source = ctx.createBufferSource();
        source.buffer = audioBufferRef.current!;
        source.playbackRate.value = state.playbackRate;
        source.connect(gainNodeRef.current!);
        source.start(0, pauseOffsetRef.current);
        sourceRef.current = source;
        startTimeRef.current =
          ctx.currentTime - pauseOffsetRef.current;
        source.onended = () => {
          if (ignoreEndedRef.current) {
            ignoreEndedRef.current = false;
            return;
          }
          resetAfterNaturalEnd(runId);
        };
      }
    },
    [
      state.status,
      state.playbackRate,
      getAudioContext,
      resetAfterNaturalEnd,
      stopCurrentSource,
    ]
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      setState((prev) => ({ ...prev, playbackRate: rate }));
      if (sourceRef.current && state.status === "playing") {
        sourceRef.current.playbackRate.value = rate;
      }
    },
    [state.status]
  );

  const setVolume = useCallback((vol: number) => {
    setState((prev) => ({ ...prev, volume: vol }));
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = vol;
    }
  }, []);

  return {
    ...state,
    loadAudio,
    play,
    pause,
    stop,
    seek,
    setPlaybackRate,
    setVolume,
  };
}

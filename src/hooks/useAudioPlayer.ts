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

  const loadAudio = useCallback(
    async (blob: Blob) => {
      try {
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
    [getAudioContext]
  );

  const play = useCallback(() => {
    if (!audioBufferRef.current) return;

    const ctx = getAudioContext();
    // Stop any existing source
    sourceRef.current?.stop();

    const source = ctx.createBufferSource();
    source.buffer = audioBufferRef.current;
    source.playbackRate.value = state.playbackRate;

    source.connect(gainNodeRef.current!);
    source.start(0, pauseOffsetRef.current);
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime - pauseOffsetRef.current;

    source.onended = () => {
      if (pauseOffsetRef.current < (audioBufferRef.current?.duration || 0)) {
        setState((prev) => ({
          ...prev,
          status: "idle",
          currentTime: 0,
        }));
        pauseOffsetRef.current = 0;
        cancelAnimationFrame(rafRef.current);
      }
    };

    setState((prev) => ({ ...prev, status: "playing" }));

    // Update currentTime via requestAnimationFrame
    const updateTime = () => {
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
  }, [getAudioContext, state.playbackRate]);

  const pause = useCallback(() => {
    if (state.status !== "playing") return;

    sourceRef.current?.stop();
    pauseOffsetRef.current +=
      (getAudioContext().currentTime - startTimeRef.current);
    cancelAnimationFrame(rafRef.current);

    setState((prev) => ({ ...prev, status: "paused" }));
  }, [state.status, getAudioContext]);

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    pauseOffsetRef.current = 0;
    cancelAnimationFrame(rafRef.current);

    setState((prev) => ({
      ...prev,
      status: "idle",
      currentTime: 0,
    }));
  }, []);

  const seek = useCallback(
    (time: number) => {
      pauseOffsetRef.current = Math.max(
        0,
        Math.min(time, audioBufferRef.current?.duration || 0)
      );
      setState((prev) => ({ ...prev, currentTime: time }));

      if (state.status === "playing") {
        // Restart from new position
        sourceRef.current?.stop();
        const ctx = getAudioContext();
        const source = ctx.createBufferSource();
        source.buffer = audioBufferRef.current!;
        source.playbackRate.value = state.playbackRate;
        source.connect(gainNodeRef.current!);
        source.start(0, pauseOffsetRef.current);
        sourceRef.current = source;
        startTimeRef.current =
          ctx.currentTime - pauseOffsetRef.current;
      }
    },
    [state.status, state.playbackRate, getAudioContext]
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

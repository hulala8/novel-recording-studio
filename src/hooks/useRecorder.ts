// ============================================================
// useRecorder — MediaRecorder hook for voice recording
// ============================================================

"use client";

import { useState, useRef, useCallback } from "react";
import type { RecordingStatus } from "@/lib/types";

interface RecorderState {
  status: RecordingStatus;
  audioBlob: Blob | null;
  duration: number;
  error: string | null;
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    status: "idle",
    audioBlob: null,
    duration: 0,
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requestMicrophoneStream = useCallback(async () => {
    const voiceMicConstraints: MediaTrackConstraints = {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: voiceMicConstraints,
      });
    } catch (err) {
      console.warn(
        "[Recorder] Preferred USB mic constraints failed, retrying with basic mono input.",
        err
      );
      return navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      chunksRef.current = [];

      const stream = await requestMicrophoneStream();
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const duration =
          (Date.now() - startTimeRef.current) / 1000;

        setState((prev) => ({
          ...prev,
          status: "stopped",
          audioBlob: blob,
          duration,
        }));

        // Clean up stream
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
      };

      recorder.start();
      startTimeRef.current = Date.now();

      setState({
        status: "recording",
        audioBlob: null,
        duration: 0,
        error: null,
      });

      // Update duration every 100ms
      durationIntervalRef.current = setInterval(() => {
        setState((prev) =>
          prev.status === "recording"
            ? {
                ...prev,
                duration:
                  (Date.now() - startTimeRef.current) / 1000,
              }
            : prev
        );
      }, 100);
    } catch (err) {
      const message =
        err instanceof DOMException &&
        err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone access in your browser settings."
          : err instanceof Error
            ? err.message
            : "Failed to start recording";

      setState({
        status: "idle",
        audioBlob: null,
        duration: 0,
        error: message,
      });
    }
  }, [requestMicrophoneStream]);

  const pauseRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.pause();
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      setState((prev) => ({ ...prev, status: "paused" }));
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "paused"
    ) {
      mediaRecorderRef.current.resume();
      durationIntervalRef.current = setInterval(() => {
        setState((prev) =>
          prev.status === "recording"
            ? {
                ...prev,
                duration:
                  (Date.now() - startTimeRef.current) / 1000,
              }
            : prev
        );
      }, 100);
      setState((prev) => ({ ...prev, status: "recording" }));
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const resetRecording = useCallback(() => {
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    setState({
      status: "idle",
      audioBlob: null,
      duration: 0,
      error: null,
    });
  }, []);

  const replaceBlob = useCallback((newBlob: Blob, newDuration: number) => {
    setState((prev) => ({
      ...prev,
      status: "stopped",
      audioBlob: newBlob,
      duration: newDuration,
    }));
  }, []);

  return {
    ...state,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    resetRecording,
    replaceBlob,
  };
}

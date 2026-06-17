"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface TrackWaveformProps {
  audioBlob: Blob | null;
  duration: number;
  /** Called when user wants to trim (keep only selection region) */
  onTrim?: (startTime: number, endTime: number) => void;
  /** Called when user wants to cut (remove selection region) */
  onCut?: (startTime: number, endTime: number) => void;
  /** Called when user single-clicks to position playhead */
  onSeek?: (time: number) => void;
  currentTime?: number;
  /** Automatically-marked trim region (e.g. auto-trim start noise) */
  autoTrimStart?: number;
  autoTrimEnd?: number;
}

const EDGE_HANDLE_PX = 6; // visual width of edge handles in CSS px
const MIN_SELECTION = 0.01; // minimum selection width in ratio

function resizeCanvasToContainer(
  canvas: HTMLCanvasElement | null,
  container: HTMLDivElement | null
) {
  if (!canvas || !container) return false;
  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return false;
  const targetW = Math.floor(w * dpr);
  const targetH = Math.floor(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  return true;
}

function drawEdgeHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  h: number,
  dpr: number
) {
  const hw = EDGE_HANDLE_PX * dpr;
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(x - hw / 2, 2 * dpr, hw, h - 4 * dpr);
  ctx.fillStyle = "#fafafa";
  ctx.beginPath();
  const dir = x < ctx.canvas.width / 2 ? 1 : -1;
  ctx.moveTo(x + dir * 4 * dpr, 4 * dpr);
  ctx.lineTo(x, 8 * dpr);
  ctx.lineTo(x + dir * 4 * dpr, 12 * dpr);
  ctx.closePath();
  ctx.fill();
}

export default function TrackWaveform({
  audioBlob,
  duration,
  onTrim,
  onCut,
  onSeek,
  currentTime = 0,
  autoTrimStart,
  autoTrimEnd,
}: TrackWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [waveData, setWaveData] = useState<Float32Array | null>(null);
  const [loading, setLoading] = useState(false);

  // Selection state (ratio 0–1)
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [dragging, setDragging] = useState<"start" | "end" | "select" | null>(null);
  const dragAnchor = useRef<number>(0); // where drag started (ratio)

  // ---- Decode audio ----
  useEffect(() => {
    if (!audioBlob) {
      queueMicrotask(() => {
        setWaveData(null);
        setSelStart(null);
        setSelEnd(null);
        setLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    const ctx = new AudioContext();
    let ctxClosed = false;
    const closeCtx = () => { if (!ctxClosed) { ctxClosed = true; ctx.close(); } };
    audioBlob
      .arrayBuffer()
      .then((b) => {
        if (cancelled) { closeCtx(); throw new Error("cancelled"); }
        return ctx.decodeAudioData(b);
      })
      .then((buf) => {
        if (cancelled) return;
        const ch = buf.getChannelData(0);
        const pts = 1200;
        const step = Math.max(1, Math.floor(ch.length / pts));
        const down = new Float32Array(pts);
        for (let i = 0; i < pts; i++) {
          let max = 0;
          for (let j = i * step; j < Math.min((i + 1) * step, ch.length); j++) {
            max = Math.max(max, Math.abs(ch[j]));
          }
          down[i] = max;
        }
        setWaveData(down);
        setSelStart(null);
        setSelEnd(null);
      })
      .catch((err) => {
        if (!cancelled) { console.error("[Waveform] decode error:", err); setWaveData(null); }
      })
      .finally(() => { if (!cancelled) setLoading(false); closeCtx(); });
    return () => { cancelled = true; closeCtx(); };
  }, [audioBlob]);

  // ---- Resize canvas ----
  const resizeCanvas = useCallback(() => {
    if (!resizeCanvasToContainer(canvasRef.current, containerRef.current)) {
      requestAnimationFrame(() => {
        resizeCanvasToContainer(canvasRef.current, containerRef.current);
      });
    }
  }, []);

  // ---- Draw ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio;
    const W = canvas.width;
    const H = canvas.height;

    // Margins
    const mx = Math.max(8, EDGE_HANDLE_PX) * dpr;
    const drawX = mx;
    const drawW = Math.max(1, W - mx * 2);

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#27272a";
    ctx.fillRect(0, 0, W, H);

    // Waveform zone (slightly lighter than margins)
    ctx.fillStyle = "#1a1a1e";
    ctx.fillRect(drawX, 0, drawW, H);

    // Vertical grid lines at 25% intervals
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 0.5 * dpr;
    for (let i = 1; i <= 3; i++) {
      const x = drawX + (i / 4) * drawW;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = "#2a2a2e";
    ctx.lineWidth = 0.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(drawX, H / 2);
    ctx.lineTo(drawX + drawW, H / 2);
    ctx.stroke();

    if (!waveData) {
      if (loading) {
        ctx.fillStyle = "#71717a";
        ctx.font = `${12 * dpr}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("加载波形...", W / 2, H / 2);
      }
      return;
    }

    // ---- Draw waveform bars (normalized) ----
    const barW = drawW / waveData.length;
    const midY = H / 2;
    const hasSelection = selStart != null && selEnd != null;

    // Find peak value for normalization
    let peak = 0;
    for (let i = 0; i < waveData.length; i++) {
      peak = Math.max(peak, waveData[i]);
    }
    // Use peak for scaling; fall back to 1 if signal is dead silent
    const scale = peak > 0.001 ? (H * 0.85) / peak : H * 0.85;

    for (let i = 0; i < waveData.length; i++) {
      const x = drawX + i * barW;
      const barH = Math.max(1.5, waveData[i] * scale);
      const ratio = i / waveData.length;

      // Much brighter colors for visibility
      let color: string;
      if (hasSelection && ratio >= selStart! && ratio <= selEnd!) {
        color = "#ffffff"; // pure white = selected
      } else if (hasSelection && (ratio < selStart! || ratio > selEnd!)) {
        color = "#52525b"; // dim gray = outside selection
      } else {
        color = "#3B82F6"; // blue = default waveform
      }

      ctx.fillStyle = color;
      // barW may be <1 for dense waveforms; let canvas anti-alias it
      ctx.fillRect(x, midY - barH / 2, Math.max(barW, 0.5), barH);
    }

    // ---- Auto-trim overlay (red tint over region to be cut) ----
    if (autoTrimStart != null && autoTrimEnd != null && duration > 0) {
      const startRatio = Math.max(0, autoTrimStart / duration);
      const endRatio = Math.min(1, autoTrimEnd / duration);
      if (endRatio > startRatio) {
        const tX = drawX + startRatio * drawW;
        const tW = (endRatio - startRatio) * drawW;

        // Red tint fill
        ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
        ctx.fillRect(tX, 0, tW, H);

        // Striped pattern overlay
        ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
        ctx.lineWidth = 1 * dpr;
        const stripeSpacing = 8 * dpr;
        for (let y = 0; y < H; y += stripeSpacing) {
          ctx.beginPath();
          ctx.moveTo(tX + (y % (stripeSpacing * 2) === 0 ? 0 : stripeSpacing / 2), y);
          ctx.lineTo(Math.min(tX + tW, tX + (y % (stripeSpacing * 2) === 0 ? tW : tW - stripeSpacing / 2)), y);
          ctx.stroke();
        }

        // Label
        const labelW = tW;
        if (labelW > 40 * dpr) {
          ctx.fillStyle = "#fca5a5";
          ctx.font = `bold ${10 * dpr}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("将被切除", tX + tW / 2, H / 2 - 6 * dpr);
          ctx.fillText(`${((endRatio - startRatio) * duration).toFixed(1)}s`, tX + tW / 2, H / 2 + 8 * dpr);
        }
      }
    }

    // ---- Selection overlay ----
    if (hasSelection) {
      const sX = drawX + selStart! * drawW;
      const eX = drawX + selEnd! * drawW;

      // Dim outside selection (semi-transparent)
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(0, 0, sX, H);
      ctx.fillRect(eX, 0, W - eX, H);

      // Bright highlight on selection
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(sX, 0, eX - sX, H);

      // Edge handles (Audition-style thin white lines with small triangles)
      drawEdgeHandle(ctx, sX, H, dpr);
      drawEdgeHandle(ctx, eX, H, dpr);
    }

    // ---- Playhead ----
    if (duration > 0) {
      const safeCurrentTime = Math.max(0, Math.min(currentTime, duration));
      const px = drawX + (safeCurrentTime / duration) * drawW;
      ctx.fillStyle = "#EF4444";
      ctx.beginPath();
      ctx.moveTo(px - 5 * dpr, 2 * dpr);
      ctx.lineTo(px + 5 * dpr, 2 * dpr);
      ctx.lineTo(px, 9 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#EF4444";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(px, 9 * dpr);
      ctx.lineTo(px, H);
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(drawX, 0, drawW, H);

    // ---- Time ruler at bottom ----
    ctx.fillStyle = "#52525b";
    ctx.font = `${9 * dpr}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let i = 0; i <= 4; i++) {
      const x = drawX + (i / 4) * drawW;
      ctx.fillText(formatTime((i / 4) * duration), x, H - 2 * dpr);
    }

    // ---- Selection time labels ----
    if (hasSelection) {
      const sX = drawX + selStart! * drawW;
      const eX = drawX + selEnd! * drawW;
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${10 * dpr}px sans-serif`;
      ctx.textBaseline = "top";
      // Start time above left handle
      ctx.textAlign = "left";
      ctx.fillText(formatTime(selStart! * duration), sX + 4 * dpr, 2 * dpr);
      // End time above right handle
      ctx.textAlign = "right";
      ctx.fillText(formatTime(selEnd! * duration), eX - 4 * dpr, 2 * dpr);
    }
  }, [
    waveData,
    selStart,
    selEnd,
    currentTime,
    duration,
    loading,
    autoTrimStart,
    autoTrimEnd,
  ]);

  // ---- Pointer interaction ----
  const toRatio = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const mx = Math.max(8, EDGE_HANDLE_PX); // matches draw margin in CSS px
      const drawLeft = rect.left + mx;
      const drawW = Math.max(1, rect.width - mx * 2);
      return Math.max(0, Math.min(1, (clientX - drawLeft) / drawW));
    },
    []
  );

  const nearEdge = useCallback(
    (ratio: number): "start" | "end" | null => {
      if (selStart == null || selEnd == null) return null;
      const hitZone = 0.02; // 2% of waveform = generous tap target
      if (Math.abs(ratio - selStart) < hitZone) return "start";
      if (Math.abs(ratio - selEnd) < hitZone) return "end";
      return null;
    },
    [selStart, selEnd]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const ratio = toRatio(e.clientX);
      const edge = nearEdge(ratio);

      if (edge) {
        // Drag existing edge
        setDragging(edge);
        dragAnchor.current = edge === "start" ? (selEnd ?? 1) : (selStart ?? 0);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else {
        // Start new selection drag
        setSelStart(ratio);
        setSelEnd(ratio);
        setDragging("select");
        dragAnchor.current = ratio;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [toRatio, nearEdge, selStart, selEnd]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ratio = toRatio(e.clientX);

      if (dragging === "start") {
        const anchor = Math.min(ratio, dragAnchor.current - MIN_SELECTION);
        setSelStart(Math.max(0, anchor));
      } else if (dragging === "end") {
        const anchor = Math.max(ratio, dragAnchor.current + MIN_SELECTION);
        setSelEnd(Math.min(1, anchor));
      } else if (dragging === "select") {
        const anchor = dragAnchor.current;
        if (ratio >= anchor) {
          setSelStart(anchor);
          setSelEnd(ratio);
        } else {
          setSelStart(ratio);
          setSelEnd(anchor);
        }
      }
    },
    [dragging, toRatio]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
    // If selection is too small, treat as single click → seek
    if (selStart != null && selEnd != null && selEnd - selStart < MIN_SELECTION) {
      const clickTime = selStart * duration;
      setSelStart(null);
      setSelEnd(null);
      if (onSeek && isFinite(clickTime)) onSeek(clickTime);
    }
  }, [selStart, selEnd, duration, onSeek]);

  // ---- Effects: resize + draw ----
  useEffect(() => {
    resizeCanvas();
    draw();
  }, [resizeCanvas, draw]);

  useEffect(() => {
    const onResize = () => { resizeCanvas(); draw(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resizeCanvas, draw]);

  // ---- Keyboard shortcuts for cut/trim ----
  useEffect(() => {
    const hasSelection = selStart != null && selEnd != null && (selEnd - selStart) >= MIN_SELECTION;
    if (!hasSelection) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;

      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        if (onCut && selStart != null && selEnd != null) {
          onCut(selStart * duration, selEnd * duration);
          setSelStart(null);
          setSelEnd(null);
        }
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        if (onTrim && selStart != null && selEnd != null) {
          onTrim(selStart * duration, selEnd * duration);
          setSelStart(null);
          setSelEnd(null);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSelStart(null);
        setSelEnd(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selStart, selEnd, duration, onCut, onTrim]);

  const selDuration =
    selStart != null && selEnd != null
      ? (selEnd - selStart) * duration
      : 0;

  return (
    <div className="select-none">
      {/* Waveform canvas */}
      <div
        ref={containerRef}
        className="w-full relative group"
        style={{ height: 128 }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-lg border border-zinc-700 block cursor-crosshair"
          style={{ background: "#1a1a1e" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-500 px-0.5">
        <span>
          {waveData ? (
            <>
              总时长 {formatTime(duration)}
              {selStart != null && selEnd != null && (
                <span className="text-white ml-2">
                  选区 {formatTime(selDuration)}
                </span>
              )}
            </>
          ) : loading ? (
            "解析中..."
          ) : (
            "无音频数据"
          )}
        </span>
        {dragging && (
          <span className="text-yellow-400 text-[10px]">
            {dragging === "select" ? "拖拽选择区域" : "调整选区边界"}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-2">
        {selStart != null && selEnd != null && selDuration > 0.05 ? (
          <>
            <span className="text-[11px] text-zinc-400">
              ✂ 选区: {formatTime(selDuration)}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => { setSelStart(null); setSelEnd(null); }}
              className="px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
              title="清除选区 (Esc)"
            >
              清除选区
            </button>
            {onCut && (
              <button
                onClick={() => {
                  onCut(selStart! * duration, selEnd! * duration);
                  setSelStart(null);
                  setSelEnd(null);
                }}
                className="px-3 py-1 text-[10px] font-medium bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                title="删除选区内容 (X)"
              >
                剪切删除 <kbd className="text-[8px] opacity-60">X</kbd>
              </button>
            )}
            {onTrim && (
              <button
                onClick={() => {
                  onTrim(selStart! * duration, selEnd! * duration);
                  setSelStart(null);
                  setSelEnd(null);
                }}
                className="px-3 py-1 text-[10px] font-medium bg-yellow-600 hover:bg-yellow-500 text-white rounded transition-colors"
                title="保留选区内容 (T)"
              >
                裁剪保留 <kbd className="text-[8px] opacity-60">T</kbd>
              </button>
            )}
          </>
        ) : (
          <span className="text-[11px] text-zinc-600">
            🖱 拖拽选区域 · X 剪切 · T 裁剪
          </span>
        )}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

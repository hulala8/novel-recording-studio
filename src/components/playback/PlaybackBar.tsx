"use client";

interface PlayerState {
  status: "idle" | "playing" | "paused";
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (vol: number) => void;
}

interface PlaybackBarProps {
  player: PlayerState;
  hasRecording: boolean;
  onPlay: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function PlaybackBar({ player, hasRecording, onPlay }: PlaybackBarProps) {
  const { status, currentTime, duration, playbackRate, volume } = player;

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-zinc-400">回放控制</p>

      {!hasRecording ? (
        <p className="text-xs text-zinc-600">暂无录音</p>
      ) : (
        <>
          {/* Progress bar */}
          <div
            className="h-1.5 bg-zinc-800 rounded-full cursor-pointer relative"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              player.seek(ratio * duration);
            }}
          >
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%" }}
            />
          </div>

          {/* Time */}
          <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-1">
            {status === "playing" ? (
              <button
                onClick={player.pause}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800 text-sm"
                title="暂停 (P)"
              >
                ⏸
              </button>
            ) : (
              <button
                onClick={() => {
                  if (status === "idle") onPlay();
                  else player.play();
                }}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800 text-sm"
                title="播放 (P)"
              >
                ▶
              </button>
            )}
            <button
              onClick={player.stop}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800 text-sm"
              title="停止"
            >
              ⏹
            </button>

            <div className="flex-1" />

            {/* Speed selector */}
            <select
              value={playbackRate}
              onChange={(e) => player.setPlaybackRate(Number(e.target.value))}
              className="text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500">🔊</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => player.setVolume(Number(e.target.value))}
              className="flex-1 h-1 accent-blue-500"
            />
          </div>
        </>
      )}
    </div>
  );
}

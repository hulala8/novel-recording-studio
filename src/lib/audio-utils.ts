// ============================================================
// Audio processing utilities: concatenation, trimming, MP3 encoding
// ============================================================

/**
 * Decode an AudioBlob into an AudioBuffer for processing.
 */
export async function decodeAudioBlob(
  blob: Blob,
  audioContext: BaseAudioContext
): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  console.log(`[decodeAudioBlob] size=${blob.size} type=${blob.type} byteLength=${arrayBuffer.byteLength}`);
  try {
    return await audioContext.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.error(`[decodeAudioBlob] Failed: size=${blob.size} type="${blob.type}"`, err);
    throw err;
  }
}

/**
 * Encode an AudioBuffer to a WAV Blob.
 */
export function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;

  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(audioBuffer.getChannelData(c));
  }

  const length = channelData[0].length;
  const dataLength = length * numChannels * (bitsPerSample / 8);
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // Write interleaved PCM data
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      const intSample =
        sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

let lamejsReady: Promise<void> | null = null;

type LameJsGlobal = {
  Mp3Encoder: new (
    channels: number,
    sampleRate: number,
    kbps: number
  ) => {
    encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
    flush(): Uint8Array;
  };
};

function getLamejs(): LameJsGlobal | undefined {
  return (window as Window & { lamejs?: LameJsGlobal }).lamejs;
}

function ensureLamejs(): Promise<void> {
  if (getLamejs()?.Mp3Encoder) return Promise.resolve();
  if (lamejsReady) return lamejsReady;

  lamejsReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/lamejs.js";
    script.onload = () => {
      if (getLamejs()?.Mp3Encoder) {
        resolve();
      } else {
        reject(new Error("lamejs script loaded but Mp3Encoder not found"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load /vendor/lamejs.js"));
    document.head.appendChild(script);
  });

  return lamejsReady;
}

/**
 * WAV → MP3 encoding using lamejs (browser-side).
 * Note: lamejs requires mono or stereo 16-bit PCM input.
 */
export async function wavBlobToMp3(wavBlob: Blob): Promise<Blob> {
  // Load lamejs as a global script (bundler can't handle its internal require() calls)
  await ensureLamejs();

  const L = getLamejs();
  if (!L?.Mp3Encoder) {
    throw new Error("lamejs failed to initialize");
  }

  const arrayBuffer = await wavBlob.arrayBuffer();
  const wav = readWavHeader(new DataView(arrayBuffer));

  const mp3Encoder = new L.Mp3Encoder(
    wav.channels,
    wav.sampleRate,
    128 // kbps bitrate
  );

  const samples = new Int16Array(arrayBuffer, wav.dataOffset);
  const blockSize = 1152;

  const mp3Chunks: Uint8Array[] = [];

  // Encode in blocks, handling mono/stereo
  if (wav.channels === 1) {
    for (let i = 0; i < samples.length; i += blockSize) {
      const chunk = samples.subarray(i, i + blockSize);
      const mp3buf = mp3Encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        mp3Chunks.push(mp3buf);
      }
    }
  } else {
    // Stereo: split interleaved samples into left/right
    for (let i = 0; i < samples.length; i += blockSize * 2) {
      const left: Int16Array = new Int16Array(blockSize);
      const right: Int16Array = new Int16Array(blockSize);
      for (let j = 0; j < blockSize && i + j * 2 < samples.length; j++) {
        left[j] = samples[i + j * 2];
        right[j] = samples[i + j * 2 + 1] || 0;
      }
      const mp3buf = mp3Encoder.encodeBuffer(left, right);
      if (mp3buf.length > 0) {
        mp3Chunks.push(mp3buf);
      }
    }
  }

  // Flush remaining data
  const finalChunk = mp3Encoder.flush();
  if (finalChunk.length > 0) {
    mp3Chunks.push(finalChunk);
  }

  return new Blob(mp3Chunks as BlobPart[], { type: "audio/mp3" });
}

interface WavHeader {
  channels: number;
  sampleRate: number;
  dataOffset: number;
}

function readWavHeader(view: DataView): WavHeader {
  // Minimal WAV header parser
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);

  // Find "data" chunk (skip format chunk)
  let offset = 12;
  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    if (chunkId === "data") {
      return {
        channels,
        sampleRate,
        dataOffset: offset + 8,
      };
    }
    const chunkSize = view.getUint32(offset + 4, true);
    offset += 8 + chunkSize;
  }

  // Fallback: assume PCM data starts at offset 44
  return { channels, sampleRate, dataOffset: 44 };
}

/**
 * Concatenate multiple audio blobs into a single WAV blob.
 * All blobs must have the same sample rate and channel count.
 */
export async function concatAudioBlobs(
  blobs: Blob[]
): Promise<Blob> {
  if (blobs.length === 0) {
    throw new Error("Cannot concatenate empty blob array");
  }
  if (blobs.length === 1) {
    return blobs[0];
  }

  // Phase 1: decode all blobs to AudioBuffers to measure total size
  const audioBuffers: AudioBuffer[] = [];
  for (const blob of blobs) {
    try {
      const ctx = new AudioContext();
      try {
        const arrayBuffer = await blob.arrayBuffer();
        if (arrayBuffer.byteLength === 0) continue;
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        if (buffer.length > 0) audioBuffers.push(buffer);
      } finally {
        ctx.close();
      }
    } catch (err) {
      console.warn("[concatAudioBlobs] Skipping corrupt blob:", err);
    }
  }

  if (audioBuffers.length === 0) {
    throw new Error("No valid audio blobs to concatenate");
  }
  if (audioBuffers.length === 1) {
    return audioBufferToWav(audioBuffers[0]);
  }

  // Phase 2: render merged output via OfflineAudioContext (handles resampling correctly)
  const sampleRate = audioBuffers[0].sampleRate;
  const channels = Math.min(audioBuffers[0].numberOfChannels, 2); // max stereo
  const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);

  const offlineCtx = new OfflineAudioContext(channels, totalLength, sampleRate);

  let timeOffset = 0;
  for (const buf of audioBuffers) {
    const source = offlineCtx.createBufferSource();
    // Resample if needed to match output sample rate
    if (buf.sampleRate !== sampleRate || buf.numberOfChannels !== channels) {
      const resampled = offlineCtx.createBuffer(channels, buf.length, sampleRate);
      for (let c = 0; c < Math.min(channels, buf.numberOfChannels); c++) {
        resampled.getChannelData(c).set(buf.getChannelData(c));
      }
      source.buffer = resampled;
    } else {
      source.buffer = buf;
    }
    source.connect(offlineCtx.destination);
    source.start(timeOffset);
    timeOffset += buf.duration;
  }

  const rendered = await offlineCtx.startRendering();
  return audioBufferToWav(rendered);
}

/**
 * Trim an audio blob to the specified start/end times (in seconds).
 */
export async function trimAudio(
  blob: Blob,
  startTime: number,
  endTime: number
): Promise<Blob> {
  // Use live AudioContext for decoding — avoids OfflineAudioContext length issues
  const ctx = new AudioContext();
  const audioBuffer = await decodeAudioBlob(blob, ctx);

  const sampleRate = audioBuffer.sampleRate;
  const maxSample = audioBuffer.length;
  const startSample = Math.max(0, Math.floor(startTime * sampleRate));
  const endSample = Math.min(maxSample, Math.floor(endTime * sampleRate));
  const trimmedLength = Math.max(1, endSample - startSample);

  const trimmed = ctx.createBuffer(
    audioBuffer.numberOfChannels,
    trimmedLength,
    sampleRate
  );

  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    trimmed
      .getChannelData(c)
      .set(
        audioBuffer.getChannelData(c).slice(startSample, endSample)
      );
  }

  ctx.close();

  return audioBufferToWav(trimmed);
}

/**
 * Detect and remove silence from an audio blob.
 *
 * Uses an energy-based voice activity detector:
 * - Splits audio into short analysis windows
 * - Windows with RMS below `silenceThreshold` count as silent
 * - Consecutive silent windows longer than `minSilenceDuration` are removed
 * - Kept regions get a small padding to avoid clipping the start/end of speech
 * - Very short kept segments (< minKeepDuration) are merged into surrounding silence
 */
export async function stripSilence(
  blob: Blob,
  options: {
    silenceThreshold?: number;   // RMS amplitude below this = silence (default 0.02, ~ -34 dB)
    minSilenceDuration?: number; // silence shorter than this is kept (seconds, default 0.3)
    minKeepDuration?: number;    // speech shorter than this counts as silence (seconds, default 0.08)
    paddingDuration?: number;    // small fade-in/out padding around kept regions (seconds, default 0.03)
  } = {}
): Promise<Blob> {
  const {
    silenceThreshold = 0.015,
    minSilenceDuration = 0.8,
    minKeepDuration = 0.1,
    paddingDuration = 0.06,
  } = options;

  // Use live AudioContext — avoids OfflineAudioContext length issues
  const ctx = new AudioContext();
  const audioBuffer = await decodeAudioBlob(blob, ctx);
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;

  // Analyze the first channel (or average of all channels) for silence detection
  const channelData = audioBuffer.getChannelData(0);
  const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
  const totalWindows = Math.ceil(channelData.length / windowSize);

  // Compute RMS per window
  const rmsPerWindow: number[] = [];
  for (let w = 0; w < totalWindows; w++) {
    const start = w * windowSize;
    const end = Math.min(start + windowSize, channelData.length);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      sumSq += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(sumSq / (end - start));
    rmsPerWindow.push(rms);
  }

  // Classify each window as speech (true) or silence (false)
  const minSilenceWindows = Math.ceil(minSilenceDuration / 0.01);
  const minKeepWindows = Math.ceil(minKeepDuration / 0.01);
  const padWindows = Math.ceil(paddingDuration / 0.01);

  // First pass: find speech windows
  const isSpeech: boolean[] = rmsPerWindow.map((rms) => rms >= silenceThreshold);

  // Second pass: fill short gaps (brief silences within speech should be kept)
  const merged = [...isSpeech];
  for (let w = 1; w < totalWindows - 1; w++) {
    if (!merged[w]) {
      // Look ahead to see if this silence is short enough to bridge
      let gapEnd = w;
      while (gapEnd < totalWindows && !isSpeech[gapEnd]) gapEnd++;
      const gapLen = gapEnd - w;
      if (gapLen < minSilenceWindows) {
        // Short gap — merge into speech
        for (let j = w; j < gapEnd; j++) merged[j] = true;
      }
      w = gapEnd;
    }
  }

  // Third pass: remove short speech bursts (noise that's not real speech)
  const cleaned = [...merged];
  for (let w = 0; w < totalWindows; w++) {
    if (cleaned[w]) {
      let burstEnd = w;
      while (burstEnd < totalWindows && merged[burstEnd]) burstEnd++;
      const burstLen = burstEnd - w;
      if (burstLen < minKeepWindows) {
        // Too short — treat as silence
        for (let j = w; j < burstEnd; j++) cleaned[j] = false;
      }
      w = burstEnd;
    }
  }

  // Find contiguous speech regions with padding
  interface Region {
    start: number;
    end: number;
  }
  const regions: Region[] = [];
  let i = 0;
  while (i < totalWindows) {
    if (cleaned[i]) {
      const start = Math.max(0, i - padWindows);
      let end = i;
      while (end < totalWindows && cleaned[end]) end++;
      end = Math.min(totalWindows, end + padWindows);
      regions.push({
        start: (start * windowSize) / sampleRate,
        end: (end * windowSize) / sampleRate,
      });
      i = end;
    } else {
      i++;
    }
  }

  // If everything is silence, return a very short silence (or the original)
  if (regions.length === 0) {
    ctx.close();
    // Return a tiny blip of silence rather than the whole thing
    const silenceBuf = ctx.createBuffer(numChannels, Math.floor(sampleRate * 0.1), sampleRate);
    return audioBufferToWav(silenceBuf);
  }

  ctx.close();

  // Trim each region and concatenate
  const trimmedBlobs: Blob[] = [];
  for (const region of regions) {
    // Clamp to valid range
    const s = Math.max(0, region.start);
    const e = Math.min(audioBuffer.duration, region.end);
    if (e - s < 0.01) continue; // skip sub-10ms fragments
    const trimmed = await trimAudio(blob, s, e);
    trimmedBlobs.push(trimmed);
  }

  if (trimmedBlobs.length === 0) {
    // Fallback: return original (shouldn't happen given the check above)
    return blob;
  }

  return concatAudioBlobs(trimmedBlobs);
}

/**
 * Insert silence (in seconds) into the audio buffer.
 */
export function createSilence(
  duration: number,
  sampleRate = 44100,
  channels = 1
): AudioBuffer {
  const length = Math.floor(duration * sampleRate);
  const audioContext = new OfflineAudioContext(channels, length, sampleRate);
  const buffer = audioContext.createBuffer(channels, length, sampleRate);
  // Buffer is already silent (zero-filled)
  return buffer;
}

/**
 * Get the duration of an audio blob in seconds.
 */
export async function getAudioDuration(blob: Blob): Promise<number> {
  const ctx = new AudioContext();
  try {
    const buffer = await decodeAudioBlob(blob, ctx);
    return buffer.duration;
  } finally {
    ctx.close();
  }
}

/**
 * Download a blob as a file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

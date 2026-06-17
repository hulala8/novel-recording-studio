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

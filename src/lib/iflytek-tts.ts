// ============================================================
// iFlytek (讯飞) TTS WebSocket Client
// ============================================================
// Supports Shaanxi dialect and other regional voices via
// the iFlytek Open Platform WebSocket TTS v2 API.
//
// Docs: https://www.xfyun.cn/doc/tts/online_tts/API.html
// ============================================================

import crypto from "crypto";
import WebSocket from "ws";

// ---- Voice codes ----
// Full list: https://www.xfyun.cn/doc/tts/online_tts/API.html#voice-name
export const VOICES: Record<string, string> = {
  // Mandarin (标准普通话) — 免费套餐可用
  "普通话-小燕": "xiaoyan",       // 女声（推荐）
  "普通话-小峰": "xiaofeng",      // 男声
  "普通话-许小宝": "x_xiaobao",   // 童声

  // Dialects (方言) — 免费套餐可用
  "陕西话-青山": "x_qingshan",     // 陕西方言 男声 ✅
  "湖南话-小亮": "x_xiaoliang",    // 湖南方言 男声 ✅
};

export interface TtsOptions {
  /** Text to synthesize (UTF-8) */
  text: string;
  /** Voice code (use VOICES lookup or pass directly) */
  voice: string;
  /** Speed: 0-100, default 50 */
  speed?: number;
  /** Volume: 0-100, default 50 */
  volume?: number;
  /** Pitch: 0-100, default 50 */
  pitch?: number;
  /** Audio format (default raw PCM 16kHz 16bit) */
  audioFormat?: string;
}

interface TtsResponse {
  code: number;
  message: string;
  sid: string;
  data: {
    audio: string;   // base64-encoded PCM audio
    status: number;  // 1=more, 2=last
    ced: string;
    text: string;
  };
}

/**
 * Build the authenticated WebSocket URL for iFlytek TTS v2.
 */
function buildAuthUrl(): string {
  const appId = process.env.IFLYTEK_APP_ID;
  const apiKey = process.env.IFLYTEK_API_KEY;
  const apiSecret = process.env.IFLYTEK_API_SECRET;

  if (!appId || !apiKey || !apiSecret) {
    throw new Error("iFlytek credentials not configured");
  }

  const host = "tts-api.xfyun.cn";
  const path = "/v2/tts";
  const date = new Date().toUTCString();

  // Build the string to sign: "host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
  const signString = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;

  // HMAC-SHA256 signature → base64
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(signString)
    .digest("base64");

  // Assemble the authorization origin string
  const authOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

  // Base64-encode for URL
  const authorization = Buffer.from(authOrigin).toString("base64");

  const url = new URL(`wss://${host}${path}`);
  url.searchParams.set("authorization", authorization);
  url.searchParams.set("date", date);
  url.searchParams.set("host", host);

  return url.toString();
}

/**
 * Synthesize speech via iFlytek TTS WebSocket API.
 * Returns a Buffer of PCM audio data (16kHz, 16-bit, mono).
 */
export async function synthesizeSpeech(options: TtsOptions): Promise<{
  audioBuffer: Buffer;
  sampleRate: number;
  format: string;
}> {
  const {
    text,
    voice,
    speed = 50,
    volume = 50,
    pitch = 50,
    audioFormat = "audio/L16;rate=16000",
  } = options;

  if (!text.trim()) {
    throw new Error("Text is empty");
  }

  const wsUrl = buildAuthUrl();

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const audioChunks: Buffer[] = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error("TTS request timed out after 30 seconds"));
      }
    }, 30000);

    ws.on("open", () => {
      // Send TTS parameters
      const requestBody = {
        common: {
          app_id: process.env.IFLYTEK_APP_ID,
        },
        business: {
          aue: "raw",
          auf: audioFormat,
          vcn: voice,
          speed,
          volume,
          pitch,
          tte: "utf8",
        },
        data: {
          status: 2, // 2 = end-of-data (all text in one go)
          text: Buffer.from(text, "utf8").toString("base64"),
        },
      };

      ws.send(JSON.stringify(requestBody));
    });

    ws.on("message", (data: Buffer) => {
      try {
        const response: TtsResponse = JSON.parse(data.toString());

        if (response.code !== 0) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`TTS error ${response.code}: ${response.message}`));
          }
          return;
        }

        // Collect audio data
        if (response.data?.audio) {
          const chunk = Buffer.from(response.data.audio, "base64");
          audioChunks.push(chunk);
        }

        // status === 2 means last frame
        if (response.data?.status === 2) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve({
              audioBuffer: Buffer.concat(audioChunks),
              sampleRate: 16000,
              format: audioFormat,
            });
          }
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          reject(err);
        }
      }
    });

    ws.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${err.message}`));
      }
    });

    ws.on("close", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error("WebSocket closed unexpectedly"));
      }
    });
  });
}

/**
 * Convert raw PCM Buffer (16-bit, 16kHz, mono) to a WAV Blob-like Buffer.
 * We can't use Blob on the server, so return a Buffer with WAV headers.
 */
export function pcmToWavBuffer(
  pcm: Buffer,
  sampleRate: number = 16000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = Buffer.alloc(totalSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(totalSize - 8, 4);
  buffer.write("WAVE", 8);

  // fmt subchunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);        // subchunk size
  buffer.writeUInt16LE(1, 20);         // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);

  return buffer;
}

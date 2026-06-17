import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech, pcmToWavBuffer, VOICES } from "@/lib/iflytek-tts";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, voice } = body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { success: false, error: "缺少文本内容" },
        { status: 400 }
      );
    }

    const voiceCode = voice || VOICES["陕西话-青山"];

    const speed = typeof body.speed === "number" ? body.speed : 50;
    const volume = typeof body.volume === "number" ? body.volume : 60;
    const pitch = typeof body.pitch === "number" ? body.pitch : 50;

    // Synthesize via WebSocket
    const { audioBuffer: pcmBuffer, sampleRate } = await synthesizeSpeech({
      text: text.trim(),
      voice: voiceCode,
      speed,
      volume,
      pitch,
    });

    // Convert PCM → WAV
    const wavBuffer = pcmToWavBuffer(pcmBuffer, sampleRate);

    // Return WAV audio as binary response
    return new NextResponse(new Uint8Array(wavBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": 'inline; filename="tts.wav"',
        "Content-Length": wavBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("TTS error:", error);
    const message =
      error instanceof Error ? error.message : "TTS synthesis failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tts — returns list of available voices (for UI)
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    voices: Object.entries(VOICES).map(([name, code]) => ({ name, code })),
  });
}

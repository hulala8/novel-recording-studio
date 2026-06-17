// ============================================================
// API Route: Segment raw text into structured paragraphs
// POST /api/segment-text
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { segmentText } from "@/lib/text-parser";
import type { SegmentRequest } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body: SegmentRequest = await request.json();

    if (!body.text || body.text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "No text provided" },
        { status: 400 }
      );
    }

    const segments = segmentText(body.text);

    if (segments.length === 0) {
      return NextResponse.json(
        { success: false, error: "No segments could be extracted from the text." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      segments,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Segmentation failed: ${message}` },
      { status: 500 }
    );
  }
}

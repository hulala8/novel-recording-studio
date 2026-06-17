// ============================================================
// API Route: Parse .docx files to plain text
// POST /api/parse-docx
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    if (
      !file.name.endsWith(".docx") &&
      !file.name.endsWith(".doc")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported file format. Please upload a .docx file.",
        },
        { status: 400 }
      );
    }

    // Use mammoth to extract text from the .docx file
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await mammoth.extractRawText({ buffer });

    if (!result.value || result.value.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "The document appears to be empty." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      text: result.value,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Failed to parse document: ${message}` },
      { status: 500 }
    );
  }
}

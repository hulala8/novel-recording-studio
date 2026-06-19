// ============================================================
// API Route: Identify character roles in novel text (rule-based)
// POST /api/identify-roles
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { pruneUnusedDialogueRoles } from "@/lib/deepseek";
import { extractCharacterNames, extractBracketNames, ruleBasedRoleAssign } from "@/lib/text-parser";
import type { IdentifyRolesRequest } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body: IdentifyRolesRequest = await request.json();

    if (!body.segments || body.segments.length === 0) {
      return NextResponse.json(
        { success: false, error: "No segments provided" },
        { status: 400 }
      );
    }

    // Rule-based role identification.
    // Names are extracted from three sources, each with different text scope:
    //   1. Bracket markers 【Name】 — from ALL text (reliable in any context)
    //   2. Speech-verb patterns "XX说/道/问" — from NARRATION ONLY
    //      (speech verbs inside dialogue are spoken content, not speaker indicators)
    //   3. Post-quote names "dialogue"NAME — from dialogue+following-narration PAIRS
    const segments = body.segments;
    const allText = segments.map((s) => s.text).join("\n");
    const bracketNames = extractBracketNames(allText);

    // Narration-only text for speech-verb extraction
    const narrationText = segments
      .filter((s) => s.type === "narration")
      .map((s) => s.text)
      .join("\n");

    // Dialogue+narration pairs for post-quote name extraction
    // (e.g., "text"陈九宸咬牙 — needs the quote→name boundary)
    const pairedTexts: string[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
      if (segments[i].type === "dialogue" && segments[i + 1].type === "narration") {
        pairedTexts.push(segments[i].text + segments[i + 1].text);
      }
    }
    const pairedText = pairedTexts.join("\n");

    // Merge all extracted names
    const namesFromNarration = extractCharacterNames(narrationText);
    const namesFromPairs = pairedText ? extractCharacterNames(pairedText) : [];
    const characterNames = Array.from(
      new Set(["旁白", ...bracketNames, ...namesFromNarration, ...namesFromPairs])
    );

    const segmentRoles = ruleBasedRoleAssign(body.segments, characterNames);
    const defaultColors = [
      "#6B7280", "#EF4444", "#3B82F6", "#10B981",
      "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4",
    ];
    const roles = characterNames.map((name, i) => ({
      name,
      color: defaultColors[i % defaultColors.length],
    }));

    return NextResponse.json(
      pruneUnusedDialogueRoles(body.segments, roles, segmentRoles)
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Role identification failed: ${message}` },
      { status: 500 }
    );
  }
}

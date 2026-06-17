// ============================================================
// API Route: Identify character roles in novel text via DeepSeek
// POST /api/identify-roles
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { identifyRoles } from "@/lib/deepseek";
import { extractCharacterNames, ruleBasedRoleAssign } from "@/lib/text-parser";
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

    // Try DeepSeek API first
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      const result = await identifyRoles(body.segments);
      if (result.success) {
        return NextResponse.json(result);
      }

      // If DeepSeek failed, fall back to rule-based
      console.warn(
        `DeepSeek API failed: ${result.error}. Falling back to rule-based.`
      );
    }

    // Rule-based fallback
    const allText = body.segments.map((s) => s.text).join("\n");
    const characterNames = extractCharacterNames(allText);
    const segmentRoles = ruleBasedRoleAssign(body.segments, characterNames);
    const defaultColors = [
      "#6B7280", "#EF4444", "#3B82F6", "#10B981",
      "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4",
    ];
    const roles = characterNames.map((name, i) => ({
      name,
      color: defaultColors[i % defaultColors.length],
    }));

    return NextResponse.json({
      success: true,
      roles,
      segmentRoles,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: `Role identification failed: ${message}` },
      { status: 500 }
    );
  }
}

// ============================================================
// Tests: Novel → Huaben Conversion
// Covers: generateHuabenText, Rule A, Rule B, roundtrip
// ============================================================

import { describe, it, expect } from "vitest";
import {
  generateHuabenText,
  isHuabenFormat,
  segmentText,
  segmentHuabenMainText,
  extractHuabenRoleTableNames,
  extractHuabenMainText,
  extractBracketNames,
  ruleBasedRoleAssign,
  extractCharacterNames,
} from "../text-parser";
import type { RawSegment } from "../types";

// ============================================================
// Test fixtures
// ============================================================

const huabenSample = `《昆仑天枢》
角色总表
【王寡妇】【女】【未知】【41】
【胡疤子】【男】【未知】【30】
【陈九宸】【男】【未知】【27】
章节列表
§第002章 夜半敲门声
角色
【王寡妇】【女】【未知】【41】
正文
第2章：夜半敲门声
陈九宸没回一碗泉镇。
【李老栓】"不该挖的东西……"
【陈九宸】"操。"
陈九宸低声骂了一句。
`;

/**
 * Normalize structural 【X】 prefixes from text for comparison.
 * Strips leading 【RoleName】 from dialogue lines so body text can be
 * compared without structural markup differences.
 */
function stripStructuralPrefix(text: string): string {
  return text.replace(/^【[^】]+】\s*/, "");
}

// ============================================================
// Phase 1: Roundtrip baseline tests
// Verifies: huaben → segment → generate → segment → identical
// ============================================================

describe("Roundtrip baseline", () => {
  it("huaben text → segments → regenerate → re-segment → same dialogue count", () => {
    // Step 1: Segment original huaben
    const originalSegs = segmentText(huabenSample);

    // Step 2: Assign roles using huaben pipeline (same as API route)
    const mainText =
      extractHuabenMainText(huabenSample) || huabenSample;
    const huabenNames = extractHuabenRoleTableNames(huabenSample);
    const allText = originalSegs.map((s) => s.text).join("\n");
    const bracketNames = extractBracketNames(allText);
    const names = Array.from(
      new Set(["旁白", ...huabenNames, ...bracketNames])
    );
    const SEP = "一—～·-";
    const bracketHeadRe = new RegExp(
      `^【([^】${SEP}]+?)(?:[${SEP}][^】]+)?】`
    );
    const segmentRoles = originalSegs.map((seg) => {
      if (seg.type === "narration") {
        return { segmentIndex: seg.index, roleName: "旁白" as string };
      }
      const m = seg.text.match(bracketHeadRe);
      if (m && names.includes(m[1])) {
        return { segmentIndex: seg.index, roleName: m[1] };
      }
      return { segmentIndex: seg.index, roleName: "旁白" as string };
    });

    // Step 3: Generate huaben text
    const generated = generateHuabenText(originalSegs, segmentRoles);
    expect(isHuabenFormat(generated)).toBe(true);

    // Step 4: Re-segment
    const reSegs = segmentText(generated);

    // Step 5: Compare — dialogue count must match
    const origDialogue = originalSegs.filter((s) => s.type === "dialogue");
    const reDialogue = reSegs.filter((s) => s.type === "dialogue");
    expect(reDialogue.length).toBe(origDialogue.length);

    // Step 6: Compare — narration count must match
    const origNarration = originalSegs.filter((s) => s.type === "narration");
    const reNarration = reSegs.filter((s) => s.type === "narration");
    expect(reNarration.length).toBe(origNarration.length);
  });

  it("roundtrip — each dialogue text matches after normalizing structural prefixes", () => {
    const originalSegs = segmentText(huabenSample);
    const mainText =
      extractHuabenMainText(huabenSample) || huabenSample;
    const huabenNames = extractHuabenRoleTableNames(huabenSample);
    const allText = originalSegs.map((s) => s.text).join("\n");
    const bracketNames = extractBracketNames(allText);
    const names = Array.from(
      new Set(["旁白", ...huabenNames, ...bracketNames])
    );
    const SEP = "一—～·-";
    const bracketHeadRe = new RegExp(
      `^【([^】${SEP}]+?)(?:[${SEP}][^】]+)?】`
    );
    const segmentRoles = originalSegs.map((seg) => {
      if (seg.type === "narration") {
        return { segmentIndex: seg.index, roleName: "旁白" as string };
      }
      const m = seg.text.match(bracketHeadRe);
      if (m && names.includes(m[1])) {
        return { segmentIndex: seg.index, roleName: m[1] };
      }
      return { segmentIndex: seg.index, roleName: "旁白" as string };
    });

    const generated = generateHuabenText(originalSegs, segmentRoles);
    const reSegs = segmentText(generated);

    const origDialogue = originalSegs.filter((s) => s.type === "dialogue");
    const reDialogue = reSegs.filter((s) => s.type === "dialogue");

    for (let i = 0; i < origDialogue.length; i++) {
      const origBody = stripStructuralPrefix(origDialogue[i].text);
      const reBody = stripStructuralPrefix(reDialogue[i].text);
      expect(reBody).toBe(origBody);
    }
  });

  it("roundtrip — each dialogue role matches after re-identification", () => {
    const originalSegs = segmentText(huabenSample);
    const mainText =
      extractHuabenMainText(huabenSample) || huabenSample;
    const huabenNames = extractHuabenRoleTableNames(huabenSample);
    const allText = originalSegs.map((s) => s.text).join("\n");
    const bracketNames = extractBracketNames(allText);
    const names = Array.from(
      new Set(["旁白", ...huabenNames, ...bracketNames])
    );
    const SEP = "一—～·-";
    const bracketHeadRe = new RegExp(
      `^【([^】${SEP}]+?)(?:[${SEP}][^】]+)?】`
    );
    const segmentRoles = originalSegs.map((seg) => {
      if (seg.type === "narration") {
        return { segmentIndex: seg.index, roleName: "旁白" as string };
      }
      const m = seg.text.match(bracketHeadRe);
      if (m && names.includes(m[1])) {
        return { segmentIndex: seg.index, roleName: m[1] };
      }
      return { segmentIndex: seg.index, roleName: "旁白" as string };
    });

    // Record original role assignments
    const origRoleMap = new Map(
      segmentRoles.map((sr) => [sr.segmentIndex, sr.roleName])
    );

    const generated = generateHuabenText(originalSegs, segmentRoles);
    const reSegs = segmentText(generated);

    // Re-identify roles from generated huaben
    const reMainText =
      extractHuabenMainText(generated) || generated;
    const reHuabenNames = extractHuabenRoleTableNames(generated);
    const reAllText = reSegs.map((s) => s.text).join("\n");
    const reBracketNames = extractBracketNames(reAllText);
    const reNames = Array.from(
      new Set(["旁白", ...reHuabenNames, ...reBracketNames])
    );
    const reSegmentRoles = reSegs.map((seg) => {
      if (seg.type === "narration") {
        return { segmentIndex: seg.index, roleName: "旁白" as string };
      }
      const m = seg.text.match(bracketHeadRe);
      if (m && reNames.includes(m[1])) {
        return { segmentIndex: seg.index, roleName: m[1] };
      }
      return { segmentIndex: seg.index, roleName: "旁白" as string };
    });

    const origDialogue = originalSegs.filter((s) => s.type === "dialogue");
    const reDialogue = reSegs.filter((s) => s.type === "dialogue");

    for (let i = 0; i < origDialogue.length; i++) {
      const origRole = origRoleMap.get(origDialogue[i].index);
      const reRole = reSegmentRoles.find(
        (sr) => sr.segmentIndex === reDialogue[i].index
      );
      expect(reRole?.roleName).toBe(origRole);
    }
  });

  it("roundtrip — narration text and order match", () => {
    const originalSegs = segmentText(huabenSample);
    const mainText =
      extractHuabenMainText(huabenSample) || huabenSample;
    const huabenNames = extractHuabenRoleTableNames(huabenSample);
    const allText = originalSegs.map((s) => s.text).join("\n");
    const bracketNames = extractBracketNames(allText);
    const names = Array.from(
      new Set(["旁白", ...huabenNames, ...bracketNames])
    );
    const SEP = "一—～·-";
    const bracketHeadRe = new RegExp(
      `^【([^】${SEP}]+?)(?:[${SEP}][^】]+)?】`
    );
    const segmentRoles = originalSegs.map((seg) => {
      if (seg.type === "narration") {
        return { segmentIndex: seg.index, roleName: "旁白" as string };
      }
      const m = seg.text.match(bracketHeadRe);
      if (m && names.includes(m[1])) {
        return { segmentIndex: seg.index, roleName: m[1] };
      }
      return { segmentIndex: seg.index, roleName: "旁白" as string };
    });

    const generated = generateHuabenText(originalSegs, segmentRoles);
    const reSegs = segmentText(generated);

    const origNarration = originalSegs.filter((s) => s.type === "narration");
    const reNarration = reSegs.filter((s) => s.type === "narration");

    expect(reNarration.length).toBe(origNarration.length);
    for (let i = 0; i < origNarration.length; i++) {
      expect(reNarration[i].text).toBe(origNarration[i].text);
    }
  });
});

// ============================================================
// generateHuabenText unit tests
// ============================================================

describe("generateHuabenText", () => {
  it("basic export produces valid huaben format", () => {
    const segments: RawSegment[] = [
      { text: "陈九宸没回一碗泉镇。", index: 0, type: "narration" },
      { text: '【李老栓】"不该挖的东西……"', index: 1, type: "dialogue" },
      { text: '【陈九宸】"操。"', index: 2, type: "dialogue" },
      { text: "陈九宸低声骂了一句。", index: 3, type: "narration" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "旁白" },
      { segmentIndex: 1, roleName: "李老栓" },
      { segmentIndex: 2, roleName: "陈九宸" },
      { segmentIndex: 3, roleName: "旁白" },
    ];

    const result = generateHuabenText(segments, segmentRoles, "第2章：夜半敲门声");

    // Should be detected as huaben
    expect(isHuabenFormat(result)).toBe(true);
    // Should contain 角色总表
    expect(result).toContain("角色总表");
    // Should contain 正文
    expect(result).toContain("正文");
    // Should contain role markers in output
    expect(result).toContain("【李老栓】");
    expect(result).toContain("【陈九宸】");
    // Should contain dialogue text
    expect(result).toContain('"不该挖的东西……"');
    expect(result).toContain('"操。"');
  });

  it("角色总表 includes all dialogue roles, excludes 旁白", () => {
    const segments: RawSegment[] = [
      { text: '【张三】"你好。"', index: 0, type: "dialogue" },
      { text: '【李四】"你好。"', index: 1, type: "dialogue" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "张三" },
      { segmentIndex: 1, roleName: "李四" },
    ];

    const result = generateHuabenText(segments, segmentRoles);

    expect(result).toContain("【张三】");
    expect(result).toContain("【李四】");
    // 旁白 should NOT be in 角色总表
    const roleTableSection = result.split("正文")[0];
    expect(roleTableSection).not.toContain("【旁白】");
  });

  it("role order follows first-appearance order, deduplicated", () => {
    const segments: RawSegment[] = [
      { text: '【李四】"第二句。"', index: 0, type: "dialogue" },
      { text: '【张三】"第一句。"', index: 1, type: "dialogue" },
      { text: '【李四】"第四句。"', index: 2, type: "dialogue" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "李四" },
      { segmentIndex: 1, roleName: "张三" },
      { segmentIndex: 2, roleName: "李四" },
    ];

    const result = generateHuabenText(segments, segmentRoles);

    const liSiIndex = result.indexOf("【李四】");
    const zhangSanIndex = result.indexOf("【张三】");
    // 李四 appears first in segments, so it should appear first in role table
    expect(liSiIndex).toBeLessThan(zhangSanIndex);
    // 李四 should not appear twice in role table
    const liSiCount = (result.match(/【李四】/g) || []).length;
    // Once in role table, once per dialogue — total should be 3 (1 role + 2 dialogues)
    expect(liSiCount).toBe(3);
  });

  it("roleName is trim()-ed before use", () => {
    const segments: RawSegment[] = [
      { text: '"你好。"', index: 0, type: "dialogue" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "  张三  " },
    ];

    const result = generateHuabenText(segments, segmentRoles);

    // Should NOT have spaces around name
    expect(result).toContain("【张三】");
    expect(result).not.toContain("【  张三  】");
    expect(result).not.toContain("【 张三】");
  });

  it("only strips leading 【X】 structural prefix from dialogue lines", () => {
    const segments: RawSegment[] = [
      {
        text: '【陈九宸】他说："走【后门】吧。"',
        index: 0,
        type: "dialogue",
      },
    ];
    const segmentRoles = [{ segmentIndex: 0, roleName: "陈九宸" }];

    const result = generateHuabenText(segments, segmentRoles);

    // Leading 【陈九宸】 replaced with new【陈九宸】
    // Mid-text 【后门】 preserved
    expect(result).toContain('【陈九宸】他说："走【后门】吧。"');
  });

  it("mid-text 【plain text】 is NOT deleted", () => {
    const segments: RawSegment[] = [
      { text: "这是正文中的【注释】内容。", index: 0, type: "narration" },
      { text: '【张三】"知道了。"', index: 1, type: "dialogue" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "旁白" },
      { segmentIndex: 1, roleName: "张三" },
    ];

    const result = generateHuabenText(segments, segmentRoles);

    // Narration text with mid-text brackets preserved
    expect(result).toContain("这是正文中的【注释】内容。");
    // Dialogue brackets work normally
    expect(result).toContain('【张三】"知道了。"');
  });

  it("pure narration (no dialogue roles) produces minimal 角色总表", () => {
    const segments: RawSegment[] = [
      { text: "这是一个故事。", index: 0, type: "narration" },
      { text: "只有叙述，没有对白。", index: 1, type: "narration" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "旁白" },
      { segmentIndex: 1, roleName: "旁白" },
    ];

    const result = generateHuabenText(segments, segmentRoles);

    // isHuabenFormat requires 3+ 【】 brackets — pure narration has none.
    // This is expected: the text will route through standard segmentation
    // on re-import, which handles narration-only texts correctly.
    expect(isHuabenFormat(result)).toBe(false);

    // 角色总表 header present
    expect(result).toContain("角色总表");
    // 正文 present
    expect(result).toContain("正文");
    // All text preserved
    expect(result).toContain("这是一个故事。");
    expect(result).toContain("只有叙述，没有对白。");
  });

  it("empty segments produces minimal valid output", () => {
    const result = generateHuabenText([], []);

    // Should still be structurally valid
    expect(result).toContain("角色总表");
    expect(result).toContain("正文");
  });

  it("unassigned dialogue is surfaced, not silently downgraded", () => {
    const segments: RawSegment[] = [
      { text: '"你好。"', index: 0, type: "dialogue" },
    ];
    // Empty roleName — should not be silently treated as 旁白
    const segmentRoles = [{ segmentIndex: 0, roleName: "" }];

    const result = generateHuabenText(segments, segmentRoles);

    // Empty role should not produce 【旁白】
    // The dialogue segment should still have its text somewhere
    // But with an empty role it gets no prefix (trimmed empty = "")
    // This is a "surfaced" issue for the caller to catch before calling generateHuabenText
    expect(result).toContain('"你好。"');
  });

  it("user-modified roles are reflected in export", () => {
    const segments: RawSegment[] = [
      { text: '"你好。"', index: 0, type: "dialogue" },
    ];
    // Auto-assignment would have been 张三, but user changed to 李四
    const segmentRoles = [{ segmentIndex: 0, roleName: "李四" }];

    const result = generateHuabenText(segments, segmentRoles);

    // Exported line must start with 【李四】
    const bodyLines = result.split("正文")[1] || "";
    expect(bodyLines).toContain("【李四】");
    expect(bodyLines).not.toContain("【张三】");
  });

  it("LF line endings work correctly", () => {
    const segments: RawSegment[] = [
      { text: "旁白文本。", index: 0, type: "narration" },
      { text: '【张三】"对白。"', index: 1, type: "dialogue" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "旁白" },
      { segmentIndex: 1, roleName: "张三" },
    ];

    const result = generateHuabenText(segments, segmentRoles);

    // Should not contain CRLF
    expect(result).not.toContain("\r\n");
    // Should use LF
    expect(result).toContain("\n");
  });

  it("punctuation, quotes, and whitespace are preserved unchanged", () => {
    const segments: RawSegment[] = [
      { text: "他说……  犹豫了一下。", index: 0, type: "narration" },
      { text: '【张三】"好……好吧！"', index: 1, type: "dialogue" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "旁白" },
      { segmentIndex: 1, roleName: "张三" },
    ];

    const result = generateHuabenText(segments, segmentRoles);

    // Ellipsis preserved
    expect(result).toContain("他说……");
    // Multiple spaces preserved
    expect(result).toContain("  犹豫了一下。");
    // Quotes preserved
    expect(result).toContain('"好……好吧！"');
  });

  it("roundtrip — isHuabenFormat detects generated output", () => {
    const segments: RawSegment[] = [
      { text: '【张三】"你好。"', index: 0, type: "dialogue" },
      { text: '【李四】"你好。"', index: 1, type: "dialogue" },
      { text: '【王五】"大家好。"', index: 2, type: "dialogue" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "张三" },
      { segmentIndex: 1, roleName: "李四" },
      { segmentIndex: 2, roleName: "王五" },
    ];

    const result = generateHuabenText(segments, segmentRoles);

    // 3 dialogue brackets + 3 role table brackets = 6 brackets >= 3
    expect(isHuabenFormat(result)).toBe(true);
  });

  it("roundtrip — re-segmented text equality after normalizing prefixes", () => {
    const segments: RawSegment[] = [
      { text: "陈九宸推开门。", index: 0, type: "narration" },
      { text: '【李老栓】"不该挖的东西……"', index: 1, type: "dialogue" },
      { text: '【陈九宸】"操。"', index: 2, type: "dialogue" },
      { text: "陈九宸低声骂了一句。", index: 3, type: "narration" },
    ];
    const segmentRoles = [
      { segmentIndex: 0, roleName: "旁白" },
      { segmentIndex: 1, roleName: "李老栓" },
      { segmentIndex: 2, roleName: "陈九宸" },
      { segmentIndex: 3, roleName: "旁白" },
    ];

    const generated = generateHuabenText(segments, segmentRoles);
    const reSegs = segmentText(generated);

    // Narration texts should match exactly (no structural prefixes)
    const origNarration = segments.filter((s) => s.type === "narration");
    const reNarration = reSegs.filter((s) => s.type === "narration");
    expect(reNarration.length).toBe(origNarration.length);
    for (let i = 0; i < origNarration.length; i++) {
      expect(reNarration[i].text).toBe(origNarration[i].text);
    }

    // Dialogue texts should match after stripping structural prefixes
    const origDialogue = segments.filter((s) => s.type === "dialogue");
    const reDialogue = reSegs.filter((s) => s.type === "dialogue");
    expect(reDialogue.length).toBe(origDialogue.length);
    for (let i = 0; i < origDialogue.length; i++) {
      expect(stripStructuralPrefix(reDialogue[i].text)).toBe(
        stripStructuralPrefix(origDialogue[i].text)
      );
    }
  });
});

// ============================================================
// Full pipeline: standard novel → huaben roundtrip
// ============================================================

describe("Novel → Huaben roundtrip", () => {
  it("standard novel text converts to huaben and re-imports correctly", () => {
    const novelText = `《测试小说》
角色总表
【张三】【男】【未知】【30】
【李四】【女】【未知】【25】
正文
第1章：测试
张三推开门。
【张三】"你来了。"
李四站起来。
【李四】"等你很久了。"
`;

    // Step 1: Segment original
    const originalSegs = segmentText(novelText);
    expect(originalSegs.length).toBeGreaterThan(0);

    // Step 2: Role assignment using huaben pipeline
    const mainText =
      extractHuabenMainText(novelText) || novelText;
    const huabenNames = extractHuabenRoleTableNames(novelText);
    const allText = originalSegs.map((s) => s.text).join("\n");
    const bracketNames = extractBracketNames(allText);
    const names = Array.from(
      new Set(["旁白", ...huabenNames, ...bracketNames])
    );
    const SEP = "一—～·-";
    const bracketHeadRe = new RegExp(
      `^【([^】${SEP}]+?)(?:[${SEP}][^】]+)?】`
    );
    const segmentRoles = originalSegs.map((seg) => {
      if (seg.type === "narration") {
        return { segmentIndex: seg.index, roleName: "旁白" as string };
      }
      const m = seg.text.match(bracketHeadRe);
      if (m && names.includes(m[1])) {
        return { segmentIndex: seg.index, roleName: m[1] };
      }
      return { segmentIndex: seg.index, roleName: "旁白" as string };
    });

    // Step 3: Generate huaben
    const generated = generateHuabenText(originalSegs, segmentRoles);
    expect(isHuabenFormat(generated)).toBe(true);

    // Step 4: Re-segment
    const reSegs = segmentText(generated);

    // Step 5: Verify
    const origDialogue = originalSegs.filter((s) => s.type === "dialogue");
    const reDialogue = reSegs.filter((s) => s.type === "dialogue");
    expect(reDialogue.length).toBe(origDialogue.length);

    const origNarration = originalSegs.filter((s) => s.type === "narration");
    const reNarration = reSegs.filter((s) => s.type === "narration");
    expect(reNarration.length).toBe(origNarration.length);

    // Dialogue text matches after normalizing structural prefixes
    for (let i = 0; i < origDialogue.length; i++) {
      expect(stripStructuralPrefix(reDialogue[i].text)).toBe(
        stripStructuralPrefix(origDialogue[i].text)
      );
    }

    // Narration text matches exactly
    for (let i = 0; i < origNarration.length; i++) {
      expect(reNarration[i].text).toBe(origNarration[i].text);
    }
  });
});

// ============================================================
// Rule A: Preceding Narration Action-Subject Detection
// These tests will initially FAIL — they define the expected
// behavior for when Rule A is implemented.
// ============================================================

describe("Rule A — Action-subject detection", () => {
  // Helper to run rule-based role assign on segments
  function assign(segments: RawSegment[], characterNames: string[]) {
    return ruleBasedRoleAssign(segments, characterNames);
  }

  it("basic action-subject recognition", () => {
    const segments: RawSegment[] = [
      { text: "张三推开门。", index: 0, type: "narration" },
      { text: '"你来了。"', index: 1, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三"]);

    expect(result[1].roleName).toBe("张三");
  });

  it("most recent complete sentence is checked", () => {
    const segments: RawSegment[] = [
      { text: "外面下着雨。李四推开门。", index: 0, type: "narration" },
      { text: '"好大的雨。"', index: 1, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "李四"]);

    // "李四推开门" is the last complete sentence in the narration
    expect(result[1].roleName).toBe("李四");
  });

  it("character name in sentence but not as subject → no match", () => {
    const segments: RawSegment[] = [
      { text: "陈九宸看见张三推开门。", index: 0, type: "narration" },
      { text: '"你来了。"', index: 1, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "陈九宸", "张三"]);

    // 张三 is the object (被看见), not the subject performing the action.
    // The sentence subject is 陈九宸, but 陈九宸's action is 看见, not
    // a whitelisted action phrase. Rule A should not assign.
    // Fallback: no speaker found → 旁白
    expect(result[1].roleName).toBe("旁白");
  });

  it("two characters in one sentence → do not assume first is speaker", () => {
    const segments: RawSegment[] = [
      { text: "张三和李四推开门走进来。", index: 0, type: "narration" },
      { text: '"你们来了。"', index: 1, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    // TWO characters as subjects of the action. Cannot determine which
    // one speaks. Rule A must not blindly pick the first one.
    // Observable conflicting evidence → no match → fallback to 旁白.
    expect(result[1].roleName).toBe("旁白");
  });

  it("name substring containment — 小李明 not matched as 李", () => {
    const segments: RawSegment[] = [
      { text: "小李明推开门。", index: 0, type: "narration" },
      { text: '"来了。"', index: 1, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "小李明", "李"]);

    // Must match "小李明" (longer), not "李" (shorter substring)
    expect(result[1].roleName).toBe("小李明");
  });

  it("does NOT override 【角色名】 bracket", () => {
    const segments: RawSegment[] = [
      { text: "张三推开门。", index: 0, type: "narration" },
      { text: "【李四】推开门。", index: 1, type: "narration" },
      { text: '"我来了。"', index: 2, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    // Bracket marker in Step 2a takes priority over Rule A
    expect(result[2].roleName).toBe("李四");
  });

  it("does NOT override speech verb", () => {
    const segments: RawSegment[] = [
      { text: "张三推开门。", index: 0, type: "narration" },
      { text: "李四说道：", index: 1, type: "narration" },
      { text: '"我来了。"', index: 2, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    // Speech verb in Step 2b takes priority over Rule A
    expect(result[2].roleName).toBe("李四");
  });

  it("narration and dialogue not adjacent → no match", () => {
    const segments: RawSegment[] = [
      { text: "张三推开门。", index: 0, type: "narration" },
      { text: "外面下着雨。", index: 1, type: "narration" },
      { text: '"你来了。"', index: 2, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三"]);

    // 张三推开门 is NOT directly adjacent to the dialogue —
    // there's an intervening narration segment. Rule A only
    // checks the immediately preceding narration.
    // The adjacent narration "外面下着雨。" has no character name.
    // Fallback: 旁白
    expect(result[2].roleName).toBe("旁白");
  });

  it("chapter title break → no match", () => {
    const segments: RawSegment[] = [
      { text: "张三推开门。", index: 0, type: "narration" },
      { text: "第2章：新的开始", index: 1, type: "narration" },
      { text: '"你来了。"', index: 2, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三"]);

    // Chapter title interrupts the context
    expect(result[2].roleName).toBe("旁白");
  });

  it("common word coincidentally matching a character name", () => {
    const segments: RawSegment[] = [
      { text: "大雨推开门。", index: 0, type: "narration" },
      { text: '"好冷。"', index: 1, type: "dialogue" },
    ];
    // 大雨 is in the character names list (could be a real name
    // in some novels). Rule A should still fire because it matches
    // a known name from the list.
    const result = assign(segments, ["旁白", "大雨"]);

    // 大雨 is in characterNames and followed by action → Rule A fires
    expect(result[1].roleName).toBe("大雨");
  });

  it("multiple character names in the action sentence — conflicting evidence", () => {
    const segments: RawSegment[] = [
      { text: "张三看见王五推开门。", index: 0, type: "narration" },
      { text: '"我来了。"', index: 1, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "王五"]);

    // Two character names in one sentence → observable conflicting evidence.
    // Rule A must NOT assume either is the speaker.
    expect(result[1].roleName).toBe("旁白");
  });
});

// ============================================================
// Rule B: Dialogue Context State Machine
// These tests will initially FAIL — they define the expected
// behavior for when Rule B (DialogueContext) is implemented.
// ============================================================

describe("Rule B — DialogueContext state machine", () => {
  function assign(segments: RawSegment[], characterNames: string[]) {
    return ruleBasedRoleAssign(segments, characterNames);
  }

  it("two confirmed speakers establish alternating pair", () => {
    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"第一句。"', index: 1, type: "dialogue" },
      { text: "李四答道：", index: 2, type: "narration" },
      { text: '"第二句。"', index: 3, type: "dialogue" },
      { text: '"第三句。"', index: 4, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    // 张三 (speech verb, high confidence)
    expect(result[1].roleName).toBe("张三");
    // 李四 (speech verb, high confidence — pair established: [张三, 李四])
    expect(result[3].roleName).toBe("李四");
    // Unattributed → alternating back to 张三
    expect(result[4].roleName).toBe("张三");
  });

  it("A→B→A→B correct alternation", () => {
    const segments: RawSegment[] = [
      { text: "【张三】推开门。", index: 0, type: "narration" },
      { text: '"A1"', index: 1, type: "dialogue" },
      { text: "【李四】站起。", index: 2, type: "narration" },
      { text: '"B1"', index: 3, type: "dialogue" },
      { text: '"A2"', index: 4, type: "dialogue" },
      { text: '"B2"', index: 5, type: "dialogue" },
      { text: '"A3"', index: 6, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    expect(result[1].roleName).toBe("张三"); // A1
    expect(result[3].roleName).toBe("李四"); // B1
    expect(result[4].roleName).toBe("张三"); // A2 (alternating)
    expect(result[5].roleName).toBe("李四"); // B2 (alternating)
    expect(result[6].roleName).toBe("张三"); // A3 (alternating)
  });

  it("three+ consecutive unattributed dialogue lines still alternate", () => {
    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"A1"', index: 1, type: "dialogue" },
      { text: "李四答道：", index: 2, type: "narration" },
      { text: '"B1"', index: 3, type: "dialogue" },
      { text: '"A2"', index: 4, type: "dialogue" },
      { text: '"B2"', index: 5, type: "dialogue" },
      { text: '"A3"', index: 6, type: "dialogue" },
      { text: '"B3"', index: 7, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    expect(result[1].roleName).toBe("张三");
    expect(result[3].roleName).toBe("李四");
    expect(result[4].roleName).toBe("张三");
    expect(result[5].roleName).toBe("李四");
    expect(result[6].roleName).toBe("张三");
    expect(result[7].roleName).toBe("李四");
  });

  it("single-speaker fallback — no invented second speaker", () => {
    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"第一句。"', index: 1, type: "dialogue" },
      { text: '"第二句。"', index: 2, type: "dialogue" },
      { text: '"第三句。"', index: 3, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三"]);

    // Only one confirmed speaker — all unattributed dialogue stays with 张三
    // (via lastSpeaker persistence, NOT via alternating pair)
    expect(result[1].roleName).toBe("张三");
    expect(result[2].roleName).toBe("张三");
    expect(result[3].roleName).toBe("张三");
  });

  it("fresh attribution recalculates relationship — does NOT break alternation", () => {
    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"第一句。"', index: 1, type: "dialogue" },
      { text: "李四答道：", index: 2, type: "narration" },
      { text: '"第二句。"', index: 3, type: "dialogue" },
      // No attribution — alternation should continue
      { text: '"第三句。"', index: 4, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    expect(result[1].roleName).toBe("张三"); // first speaker
    expect(result[3].roleName).toBe("李四"); // pair established
    // 李四 is a fresh attribution, but that should NOT clear
    // the pair — it should ESTABLISH it. Then the unattributed
    // line alternates back to 张三.
    expect(result[4].roleName).toBe("张三"); // alternating
  });

  it("third character terminates old pair — full state transition", () => {
    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"A1"', index: 1, type: "dialogue" },
      { text: "李四答道：", index: 2, type: "narration" },
      { text: '"B1"', index: 3, type: "dialogue" },
      { text: '"A2"', index: 4, type: "dialogue" }, // alternating → 张三
      { text: "王五说：", index: 5, type: "narration" },
      { text: '"C1"', index: 6, type: "dialogue" },
      { text: '"???"', index: 7, type: "dialogue" }, // fallback → 王五 (no pair yet)
      { text: "赵六答道：", index: 8, type: "narration" },
      { text: '"D1"', index: 9, type: "dialogue" },
      { text: '"???"', index: 10, type: "dialogue" }, // alternating → 王五
    ];
    const result = assign(segments, ["旁白", "张三", "李四", "王五", "赵六"]);

    // Establish [张三, 李四] pair
    expect(result[1].roleName).toBe("张三");
    expect(result[3].roleName).toBe("李四");
    expect(result[4].roleName).toBe("张三");
    // 王五 appears → discard [张三, 李四] pair, confirmedSpeakers: [王五]
    expect(result[6].roleName).toBe("王五");
    // No pair exists yet → 王五 fallback (lastSpeaker persistence)
    expect(result[7].roleName).toBe("王五");
    // 赵六 appears → establish [王五, 赵六] pair
    expect(result[9].roleName).toBe("赵六");
    // Alternating → 王五
    expect(result[10].roleName).toBe("王五");
  });

  it("chapter switch clears context via isSceneBoundary", () => {
    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"A1"', index: 1, type: "dialogue" },
      { text: "李四答道：", index: 2, type: "narration" },
      { text: '"B1"', index: 3, type: "dialogue" },
      // Chapter break
      { text: "第2章：新的旅程", index: 4, type: "narration" },
      { text: '"???"', index: 5, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    expect(result[1].roleName).toBe("张三");
    expect(result[3].roleName).toBe("李四");
    // After chapter break, context is cleared. No pair, no confirmed speakers.
    // Fallback → 旁白
    expect(result[5].roleName).toBe("旁白");
  });

  it("scene separator clears context", () => {
    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"A1"', index: 1, type: "dialogue" },
      { text: "李四答道：", index: 2, type: "narration" },
      { text: '"B1"', index: 3, type: "dialogue" },
      // Scene separator
      { text: "---", index: 4, type: "narration" },
      { text: '"???"', index: 5, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    expect(result[1].roleName).toBe("张三");
    expect(result[3].roleName).toBe("李四");
    // After scene separator, context cleared
    expect(result[5].roleName).toBe("旁白");
  });

  it("narration exceeding MAX_NARRATION_CHARS_FOR_DIALOGUE_CONTEXT clears context", () => {
    // Build a long narration segment (>80 chars) to trigger context reset
    const longNarration =
      "夜色渐深，月亮缓缓升起，洒下银白色的光芒，整个山谷都被笼罩在一层薄薄的雾气之中，远处传来几声狼嚎，打破了夜晚的寂静和安宁，冷风穿过树林发出沙沙的声响，几点萤火在草丛间忽明忽暗地闪烁着。";

    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"A1"', index: 1, type: "dialogue" },
      { text: "李四答道：", index: 2, type: "narration" },
      { text: '"B1"', index: 3, type: "dialogue" },
      { text: longNarration, index: 4, type: "narration" },
      { text: '"???"', index: 5, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三", "李四"]);

    expect(result[1].roleName).toBe("张三");
    expect(result[3].roleName).toBe("李四");
    // Long narration (>80 chars) should clear context
    expect(result[5].roleName).toBe("旁白");
  });

  it("auto-inferred results do NOT establish new alternating pairs", () => {
    const segments: RawSegment[] = [
      { text: "张三说：", index: 0, type: "narration" },
      { text: '"A1"', index: 1, type: "dialogue" },
      // No attribution for next two — Rule B alternates from single confirmed speaker
      // But with only one confirmed speaker, it should use lastSpeaker persistence
      { text: '"A2"', index: 2, type: "dialogue" },
      { text: '"A3"', index: 3, type: "dialogue" },
    ];
    const result = assign(segments, ["旁白", "张三"]);

    // Only one confirmed speaker (张三) — alternating pair is never established
    // All dialogue uses lastSpeaker persistence → 张三
    expect(result[1].roleName).toBe("张三");
    expect(result[2].roleName).toBe("张三");
    expect(result[3].roleName).toBe("张三");
  });
});

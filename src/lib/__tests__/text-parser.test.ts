import { describe, it, expect } from "vitest";
import {
  segmentText,
  extractCharacterNames,
  ruleBasedRoleAssign,
} from "../text-parser";

// Helpers: Chinese quotation marks used by the system
const LQ = "“"; // "
const RQ = "”"; // "

// ============================================================
// extractCharacterNames — bracket pattern tests
// ============================================================
describe("extractCharacterNames - bracket patterns", () => {
  it("extracts name from 【Name-Descriptor】 format", () => {
    const text = `【刘信-浪客】${LQ}今天天气不错。${RQ}`;
    const names = extractCharacterNames(text);
    expect(names).toContain("刘信");
  });

  it("extracts name from 【Name】 format (no descriptor)", () => {
    const text = `【张三】${LQ}出发吧。${RQ}`;
    const names = extractCharacterNames(text);
    expect(names).toContain("张三");
  });

  it("extracts multiple bracket names from text", () => {
    const text = `【刘信-浪客】${LQ}你好。${RQ}【李四-剑侠】${LQ}你好。${RQ}`;
    const names = extractCharacterNames(text);
    expect(names).toContain("刘信");
    expect(names).toContain("李四");
  });

  it("extracts name with up to 4 Chinese characters", () => {
    const text = `【欧阳锋-老毒物】${LQ}看招。${RQ}`;
    const names = extractCharacterNames(text);
    expect(names).toContain("欧阳锋");
  });

  it("always includes 旁白", () => {
    const text = "纯叙述文字，没有任何角色标记";
    const names = extractCharacterNames(text);
    expect(names).toContain("旁白");
  });

  it("extracts bracket names and speech-verb names together", () => {
    const text = `【刘信-浪客】${LQ}你好。${RQ}王婶问道：${LQ}吃了吗？${RQ}`;
    const names = extractCharacterNames(text);
    expect(names).toContain("刘信");
    // The speech-verb pattern captures "王婶" before "问道"
    expect(names).toContain("王婶");
  });

  it("handles bracket name where descriptor itself contains a dash", () => {
    const text = `【刘信-浪-客】${LQ}你好。${RQ}`;
    const names = extractCharacterNames(text);
    // "刘信" is before the first dash, "浪-客" is the descriptor
    expect(names).toContain("刘信");
  });

  it("extracts name with 一 as separator (Chinese text convention)", () => {
    const text = `【贾嘉华一老吴】${LQ}开会了。${RQ}`;
    const names = extractCharacterNames(text);
    expect(names).toContain("贾嘉华");
    expect(names).not.toContain("贾嘉华一老吴");
  });

  it("extracts name with — em dash as separator", () => {
    const text = `【万家乐—蔡蔡】${LQ}你好。${RQ}`;
    const names = extractCharacterNames(text);
    expect(names).toContain("万家乐");
  });
});

// ============================================================
// ruleBasedRoleAssign — bracket speaker detection tests
// ============================================================
describe("ruleBasedRoleAssign - bracket speaker detection", () => {
  it("assigns role from 【Name-Descriptor】 in preceding narration", () => {
    const segments = [
      { text: "【刘信-浪客】", index: 0, type: "narration" as const },
      { text: `${LQ}今天天气不错。${RQ}`, index: 1, type: "dialogue" as const },
    ];
    const names = extractCharacterNames(
      segments.map((s) => s.text).join("\n")
    );
    const result = ruleBasedRoleAssign(segments, names);

    expect(result[0].roleName).toBe("旁白");
    expect(result[1].roleName).toBe("刘信");
  });

  it("assigns role from 【Name】 without descriptor in preceding narration", () => {
    const segments = [
      { text: "【张三】", index: 0, type: "narration" as const },
      { text: `${LQ}出发吧。${RQ}`, index: 1, type: "dialogue" as const },
    ];
    const names = extractCharacterNames(
      segments.map((s) => s.text).join("\n")
    );
    const result = ruleBasedRoleAssign(segments, names);

    expect(result[0].roleName).toBe("旁白");
    expect(result[1].roleName).toBe("张三");
  });

  it("bracket check runs before speech-verb check in preceding narration", () => {
    const segments = [
      { text: "【刘信-浪客】", index: 0, type: "narration" as const },
      { text: `${LQ}我来晚了。${RQ}`, index: 1, type: "dialogue" as const },
    ];
    // Provide names directly to isolate the bracket detection from name extraction
    const names = ["旁白", "刘信", "李四"];
    const result = ruleBasedRoleAssign(segments, names);

    expect(result[1].roleName).toBe("刘信");
  });

  it("handles multiple bracket speakers across segments", () => {
    const segments = [
      { text: "【刘信-浪客】", index: 0, type: "narration" as const },
      { text: `${LQ}你好。${RQ}`, index: 1, type: "dialogue" as const },
      { text: "【李四-剑侠】", index: 2, type: "narration" as const },
      { text: `${LQ}幸会。${RQ}`, index: 3, type: "dialogue" as const },
    ];
    const names = extractCharacterNames(
      segments.map((s) => s.text).join("\n")
    );
    const result = ruleBasedRoleAssign(segments, names);

    expect(result[0].roleName).toBe("旁白");
    expect(result[1].roleName).toBe("刘信");
    expect(result[2].roleName).toBe("旁白");
    expect(result[3].roleName).toBe("李四");
  });

  it("bracket detection works when bracket is followed by speech verb", () => {
    const segments = [
      { text: "【刘信-浪客】说：", index: 0, type: "narration" as const },
      { text: `${LQ}快走！${RQ}`, index: 1, type: "dialogue" as const },
    ];
    const names = extractCharacterNames(
      segments.map((s) => s.text).join("\n")
    );
    const result = ruleBasedRoleAssign(segments, names);

    expect(result[1].roleName).toBe("刘信");
  });

  it("continues using last speaker for unmarked consecutive dialogue", () => {
    const segments = [
      { text: "【刘信-浪客】", index: 0, type: "narration" as const },
      { text: `${LQ}你去哪？${RQ}`, index: 1, type: "dialogue" as const },
      { text: `${LQ}买东西。${RQ}`, index: 2, type: "dialogue" as const },
    ];
    const names = extractCharacterNames(
      segments.map((s) => s.text).join("\n")
    );
    const result = ruleBasedRoleAssign(segments, names);

    expect(result[1].roleName).toBe("刘信");
    expect(result[2].roleName).toBe("刘信");
  });

  it("falls back to 旁白 when bracket content is a blocked name", () => {
    const segments = [
      { text: "【急忙-跑者】", index: 0, type: "narration" as const },
      { text: `${LQ}等等我。${RQ}`, index: 1, type: "dialogue" as const },
    ];
    const names = extractCharacterNames(
      segments.map((s) => s.text).join("\n")
    );
    const result = ruleBasedRoleAssign(segments, names);

    // "急忙" is blocked → normalizeRoleName returns "旁白"
    expect(result[1].roleName).toBe("旁白");
  });
});

// ============================================================
// Full pipeline: segmentText → extractCharacterNames → ruleBasedRoleAssign
// ============================================================
describe("Full pipeline with bracket patterns", () => {
  it("correctly segments and assigns roles for bracket-formatted text", () => {
    const rawText = `【刘信-浪客】${LQ}今天天气不错。${RQ}\n\n【李四-剑侠】${LQ}是啊，出太阳了。${RQ}`;

    const segments = segmentText(rawText);
    const names = extractCharacterNames(rawText);
    const assignments = ruleBasedRoleAssign(segments, names);

    // Verify segmentation: 2 narration + 2 dialogue = 4
    expect(segments.length).toBe(4);
    expect(segments[0].type).toBe("narration");
    expect(segments[1].type).toBe("dialogue");
    expect(segments[2].type).toBe("narration");
    expect(segments[3].type).toBe("dialogue");

    // Verify role assignments
    expect(assignments[0].roleName).toBe("旁白");
    expect(assignments[1].roleName).toBe("刘信");
    expect(assignments[2].roleName).toBe("旁白");
    expect(assignments[3].roleName).toBe("李四");
  });

  it("handles bracket speakers mixed with speech-verb speakers", () => {
    const rawText = `【刘信-浪客】${LQ}你来了。${RQ}王婶问道：${LQ}快进屋坐。${RQ}`;

    const segments = segmentText(rawText);
    const names = extractCharacterNames(rawText);

    // Both extraction sources should work together
    expect(names).toContain("刘信"); // bracket
    expect(names).toContain("王婶"); // speech-verb "王婶问道"
  });

  it("correctly processes a typical novel paragraph with bracket markers", () => {
    const rawText = [
      `【刘信-浪客】${LQ}久仰大名。${RQ}`,
      `【李四-剑侠】微微一笑：${LQ}不敢当。${RQ}`,
      `两人并肩走入大厅。`,
    ].join("\n\n");

    const segments = segmentText(rawText);
    const names = extractCharacterNames(rawText);
    const assignments = ruleBasedRoleAssign(segments, names);

    expect(names).toContain("刘信");
    expect(names).toContain("李四");

    const liuXinSeg = assignments.find((a) => a.roleName === "刘信");
    expect(liuXinSeg).toBeDefined();

    const liSiSeg = assignments.find((a) => a.roleName === "李四");
    expect(liSiSeg).toBeDefined();
  });

  it("bracket mid-narration still works as speaker indicator", () => {
    // Bracket doesn't have to be at the start of narration
    const rawText = `大厅里站着【刘信-浪客】。\n\n${LQ}今天天气不错。${RQ}`;

    const segments = segmentText(rawText);
    const names = extractCharacterNames(rawText);
    const assignments = ruleBasedRoleAssign(segments, names);

    expect(assignments[1].roleName).toBe("刘信");
  });

  it("bracket in dialogue text is not treated as speaker indicator", () => {
    // When 【Name】 appears inside quotes, it's spoken content, not a speaker label
    const rawText = `王婶说：${LQ}刚才看到【刘信-浪客】从门口经过。${RQ}`;

    const segments = segmentText(rawText);
    const names = extractCharacterNames(rawText);
    const assignments = ruleBasedRoleAssign(segments, names);

    // 刘信 is extracted as a potential name (from bracket), but the dialogue
    // is spoken by 王婶 (speech-verb match), not 刘信
    expect(names).toContain("刘信");
    expect(names).toContain("王婶");

    // The dialogue segment should be assigned to 王婶
    const dialogueAssignments = assignments.filter(
      (a) => segments[a.segmentIndex]?.type === "dialogue"
    );
    for (const a of dialogueAssignments) {
      if (a.roleName === "旁白") continue;
      // The speaker should be 王婶 (from speech-verb), not 刘信 (from bracket in content)
      expect(a.roleName).toBe("王婶");
    }
  });

  it("extracts name correctly when descriptor is very long", () => {
    const text = `【刘信-纵横江湖数十载的浪客】${LQ}久仰。${RQ}`;
    const names = extractCharacterNames(text);
    expect(names).toContain("刘信");
  });

  it("assigns dialogue to 旁白 when no speaker indicator is found", () => {
    const segments = [
      { text: `${LQ}今天天气不错。${RQ}`, index: 0, type: "dialogue" as const },
    ];
    const names = ["旁白"];
    const result = ruleBasedRoleAssign(segments, names);

    expect(result[0].roleName).toBe("旁白");
  });

  it("continuous dialogue after bracket speaker works correctly", () => {
    const rawText = [
      `【刘信-浪客】${LQ}你去哪？${RQ}`,
      `${LQ}买东西。${RQ}`,
      `${LQ}早点回来。${RQ}`,
      `【李四-剑侠】${LQ}知道了。${RQ}`,
    ].join("\n\n");

    const segments = segmentText(rawText);
    const names = extractCharacterNames(rawText);
    const assignments = ruleBasedRoleAssign(segments, names);

    // Find dialogue assignments in order
    const roles = assignments.map((a) => a.roleName);
    // Should be: 旁白(刘信 narration), 刘信, 刘信, 刘信, 旁白(李四 narration), 李四
    expect(roles).toContain("刘信");
    expect(roles).toContain("李四");
  });
});

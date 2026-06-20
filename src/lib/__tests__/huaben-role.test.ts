import { describe, it, expect } from "vitest";
import {
  isHuabenFormat,
  extractHuabenMainText,
  extractHuabenRoleTableNames,
  segmentText,
  extractBracketNames,
} from "../text-parser";

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

// ============================================================
// isHuabenFormat
// ============================================================
describe("isHuabenFormat", () => {
  it("detects huaben format with 正文 and 【】 markers", () => {
    expect(isHuabenFormat(huabenSample)).toBe(true);
  });

  it("rejects text without 正文 delimiter", () => {
    expect(isHuabenFormat("普通小说文本")).toBe(false);
  });

  it("rejects text without 【】 bracket markers", () => {
    expect(isHuabenFormat("正文\n普通文本。")).toBe(false);
  });
});

// ============================================================
// extractHuabenMainText
// ============================================================
describe("extractHuabenMainText", () => {
  it("extracts content after 正文", () => {
    const main = extractHuabenMainText(huabenSample);
    expect(main).not.toBeNull();
    expect(main!).toContain("第2章：夜半敲门声");
    expect(main!).toContain("【李老栓】");
    expect(main!).not.toContain("角色总表");
    expect(main!).not.toContain("《昆仑天枢》");
  });
});

// ============================================================
// extractHuabenRoleTableNames
// ============================================================
describe("extractHuabenRoleTableNames", () => {
  it("extracts names from 角色总表", () => {
    const names = extractHuabenRoleTableNames(huabenSample);
    expect(names).toContain("王寡妇");
    expect(names).toContain("胡疤子");
    expect(names).toContain("陈九宸");
    expect(names.length).toBe(3);
  });
});

// ============================================================
// segmentText — huaben mode
// ============================================================
describe("segmentText with huaben format", () => {
  it("produces segments with correct types", () => {
    const segs = segmentText(huabenSample);
    expect(segs.length).toBeGreaterThan(0);

    // Lines with 【X】 should produce narration (bracket) + dialogue (text)
    const dialogueSegs = segs.filter((s) => s.type === "dialogue");
    expect(dialogueSegs.length).toBe(2);
  });

  it("classifies【X】text without quotes as dialogue", () => {
    const text = `《测试》
正文
第1章：测试
【胡疤子】后头有人来过。
他站起来，对身后的人说。
【李四】知道了。
【王五】走吧。
`;
    const segs = segmentText(text);
    const dialogueSegs = segs.filter((s) => s.type === "dialogue");
    expect(dialogueSegs.length).toBe(3);
    // 【X】is now merged into the dialogue segment head
    expect(dialogueSegs[0].text).toBe("【胡疤子】后头有人来过。");
  });

  it("classifies lines without【X】as narration", () => {
    const text = `《测试》
正文
第1章：测试
这是一段叙述文字。
这也是叙述。
`;
    const segs = segmentText(text);
    const narrationOnly = segs.every((s) => s.type === "narration");
    expect(narrationOnly).toBe(true);
  });
});

// ============================================================
// Full pipeline: segmentText → ruleBasedRoleAssign (huaben)
// ============================================================
describe("Full huaben pipeline", () => {
  it("assigns roles from leading 【X】 in dialogue segments", () => {
    const segs = segmentText(huabenSample);
    const huabenNames = extractHuabenRoleTableNames(huabenSample);
    const bracketNames = extractBracketNames(
      segs.map((s) => s.text).join("\n")
    );
    const nameSet = new Set(["旁白", ...huabenNames, ...bracketNames]);
    const bracketHeadRe = /^【([^】]+)】/;

    // Direct role assignment: narration → 旁白, dialogue → leading【X】
    const dialogueWithRoles = segs
      .filter((s) => s.type === "dialogue")
      .map((ds) => {
        const m = ds.text.match(bracketHeadRe);
        const role = m && nameSet.has(m[1]) ? m[1] : "旁白";
        return { text: ds.text, role };
      });

    expect(dialogueWithRoles.length).toBe(2);
    expect(dialogueWithRoles[0].role).toBe("李老栓");
    expect(dialogueWithRoles[1].role).toBe("陈九宸");
  });

  it("all narration segments are assigned to 旁白", () => {
    const segs = segmentText(huabenSample);
    const huabenNames = extractHuabenRoleTableNames(huabenSample);
    const bracketNames = extractBracketNames(
      segs.map((s) => s.text).join("\n")
    );
    const nameSet = new Set(["旁白", ...huabenNames, ...bracketNames]);
    const bracketHeadRe = /^【([^】]+)】/;

    const narrationSegs = segs.filter((s) => s.type === "narration");
    for (const ns of narrationSegs) {
      // Narration segments should NOT start with 【X】after huaben segmentation
      // (they were either pure narration or bracket-cues that got merged into dialogue)
      const m = ns.text.match(bracketHeadRe);
      expect(m).toBeNull();
    }
  });
});

  // ==========================================================
  // Mid-line 【X】 handling
  // ==========================================================
  it("handles 【X】 mid-line: text before bracket is narration", () => {
    const text = `《测试》
正文
第1章：测试
白松华说：【白松华】"你好啊！"
【李四】"你好。"
【王五】"大家好。"`;

    const segs = segmentText(text);

    const narrationSegs = segs.filter((s) => s.type === "narration");
    const dialogueSegs = segs.filter((s) => s.type === "dialogue");

    // "白松华说：" should be narration, 【白松华】"你好啊！" should be dialogue
    expect(dialogueSegs.length).toBe(3);
    expect(dialogueSegs[0].text).toBe('【白松华】"你好啊！"');
    // There should be narration containing "白松华说："
    const hasNarrationWithSpeechVerb = narrationSegs.some(
      (s) => s.text.includes("白松华说")
    );
    expect(hasNarrationWithSpeechVerb).toBe(true);
  });

  it("dialogue after 【X】 ends at the line boundary", () => {
    const text = `《测试》
正文
第1章：测试
【胡疤子】后头有人来过。
他站起来，对身后的人说。
【李四】知道了。
【王五】走吧。`;

    const segs = segmentText(text);
    const dialogueSegs = segs.filter((s) => s.type === "dialogue");

    // Three dialogue lines (3 【X】 brackets)
    expect(dialogueSegs.length).toBe(3);
    expect(dialogueSegs[0].text).toBe("【胡疤子】后头有人来过。");

    // Narration lines between dialogues
    const narrationSegs = segs.filter((s) => s.type === "narration");
    const hasSecondLine = narrationSegs.some(
      (s) => s.text.includes("他站起来")
    );
    expect(hasSecondLine).toBe(true);
  });

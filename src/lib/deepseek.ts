// ============================================================
// DeepSeek API client for character role identification
// ============================================================

import type { IdentifyRolesResponse, RawSegment } from "./types";
import { normalizeRoleName } from "./role-name-utils";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const CHUNK_SIZE = 25; // Process 25 segments per API call

/**
 * Build a detailed system prompt for character identification.
 */
function buildSystemPrompt(): string {
  return `你是一位精通中文小说文本分析的专家。你的任务是从小说片段中识别所有角色（说话人）并为每段文本标注角色归属。

## 核心原则

**所有 type="narration" 的段落（引号外的叙述性文字），一律标注为"旁白"。你只需要为 type="dialogue" 的段落（引号内的对话内容）识别说话人。**

## 如何判断引号内对话的说话人

引号内的对话（如 "你好。"）可能紧邻一个旁白段落（如 张三微笑着说：），你需要结合上下文判断：

### 模式 1：前文旁白段中有说话提示
旁白段：张三微笑着说：
对话段："你来了。"
→ 对话段属于【张三】

### 模式 2：后文旁白段中有说话提示
对话段："该出发了。"
旁白段：李四催促道。
→ 对话段属于【李四】

### 模式 3：前文旁白段末尾指出说话人
旁白段：张三推开门：
对话段："好久不见。"
→ 对话段属于【张三】

### 模式 4：连续对话（无说话提示）
对话段："你去哪？"
对话段："买东西。"
→ 根据上下文推断。如果前文是张三和李四在对话，则依次标注

### 模式 5：内心独白
旁白段：他心里嘀咕：
对话段："这下麻烦了。"
→ 对话段属于【"他"所指代的人物】，用该人物真名而非"他"

### 模式 6：多人同时说话
旁白段：众人齐声高呼：
对话段："万岁！"
→ 可标记为【众人】或根据上下文判断

## 关键规则

- **你只需要为 type="dialogue" 的段落（引号内容）分配说话人**
- **type="narration" 的段落（引号外文字）永远是"旁白"**
- 识别旁白段中的"说、道、问、答、喊、叫、嚷、骂、吼、嘀咕、嘟囔、呢喃、惊叹、自言自语、开口、回话、插嘴、补充"等说话标记，找到说话人名字
- 同一个人物可能用不同称呼（如"张三"、"小张"、"张总"），尽量统一为最常用的名字
- 角色名必须是原文中明确出现的人名、称谓、身份称呼或稳定群体称呼，例如"张三"、"王婶"、"李总"、"母亲"、"村长"、"众人"
- **禁止**把代词、句子碎片、动作短语、情绪短语、疑问短语、动宾结构当角色名
- 以下都不是角色名，必须标注为"旁白"或使用上下文中的真实人物名： "你"、"我"、"他"、"有人"、"听"、"你们这样"、"你不知道"、"咱都不知"、"也能给娃"、"把人"、"跟勇搭腔"、"急忙掩嘴"、"对胡彩香"
- 如果实在无法确定引号内容的说话人，标注为"旁白"（用户可在审核阶段修改）`;

}

/**
 * Build the user prompt with segments to analyze.
 */
function buildUserPrompt(
  segments: RawSegment[],
  knownRoles: { name: string; color: string }[]
): string {
  const knownRoleHint =
    knownRoles.length > 0
      ? `\n已识别的角色：${knownRoles.map((r) => r.name).join("、")}\n如果是这些角色中的某一个，请使用已有名称；如果是新角色，请使用原文中的名称。`
      : "";

  return `请分析以下小说片段。${knownRoleHint}

**重要提醒：type="narration" 的段落（引号外的叙述文字）一律标注为"旁白"。你只需要为 type="dialogue" 的段落（引号内的对话内容）标注对应的说话人角色。**

文本段落（[编号] type 格式）：
${segments.map((s) => `[${s.index}] type=${s.type} | ${s.text}`).join("\n\n")}

要求：
1. 只输出真正的说话角色名（包括"旁白"），不要输出没有对白归属的名字
2. 角色名必须是人名/称谓/身份称呼/稳定群体称呼，不能是代词、动词、半句话、动作短语或情绪短语
3. 如果只能判断成"你/我/他/有人/某人"或类似短语，但无法对应真实人物名，请标注为"旁白"
4. 为每个角色分配颜色：旁白=#6B7280，第一个对话角色=#EF4444，第二个=#3B82F6，第三个=#10B981，第四个=#F59E0B，第五个=#8B5CF6，第六个=#EC4899
5. 为每个段落标注它属于哪个角色 — narration段落必须标注为"旁白"

只返回纯JSON（不要用\`\`\`json包裹），格式如下：
{"roles":[{"name":"旁白","color":"#6B7280"},{"name":"张三","color":"#EF4444"}],"segmentRoles":[{"segmentIndex":0,"roleName":"旁白"},{"segmentIndex":1,"roleName":"张三"}]}`;
}

/**
 * Call DeepSeek API for character identification on a single chunk.
 */
async function callDeepSeek(
  segments: RawSegment[],
  knownRoles: { name: string; color: string }[]
): Promise<IdentifyRolesResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      roles: [],
      segmentRoles: [],
      error: "DEEPSEEK_API_KEY not configured",
    };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(segments, knownRoles);

  const response = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 8192,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return {
      success: false,
      roles: [],
      segmentRoles: [],
      error: `DeepSeek API error (${response.status}): ${errText.slice(0, 300)}`,
    };
  }

  const data = await response.json();
  const content: string = data.choices?.[0]?.message?.content || "";

  // Parse JSON response
  let parsed: { roles?: { name: string; color: string }[]; segmentRoles?: { segmentIndex: number; roleName: string }[] };
  try {
    // Strip markdown code blocks if present
    const clean = content
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    parsed = JSON.parse(clean);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return {
          success: false,
          roles: [],
          segmentRoles: [],
          error: `JSON parse failed. Response: ${content.slice(0, 300)}`,
        };
      }
    } else {
      return {
        success: false,
        roles: [],
        segmentRoles: [],
        error: `No JSON found in response: ${content.slice(0, 300)}`,
      };
    }
  }

  return pruneUnusedDialogueRoles(
    segments,
    parsed.roles || [],
    parsed.segmentRoles || []
  );
}

/**
 * Post-process AI results: ensure all narration-typed segments are assigned to "旁白".
 */
function forceNarrationToNarrator(
  segments: RawSegment[],
  segmentRoles: { segmentIndex: number; roleName: string }[]
): { segmentIndex: number; roleName: string }[] {
  const segTypeMap = new Map(segments.map((s) => [s.index, s.type]));
  return segmentRoles.map((sr) => {
    if (segTypeMap.get(sr.segmentIndex) === "narration") {
      return { ...sr, roleName: "旁白" };
    }
    return sr;
  });
}

// Default color palette for role assignment
const ROLE_COLORS = [
  "#EF4444", "#3B82F6", "#10B981", "#F59E0B",
  "#8B5CF6", "#EC4899", "#06B6D4", "#F97316",
  "#84CC16", "#14B8A6", "#E11D48", "#A855F7",
];

/**
 * Keep only roles that are actually assigned to dialogue segments.
 * This removes zero-dialogue false positives from AI/rule extraction.
 */
export function pruneUnusedDialogueRoles(
  segments: RawSegment[],
  roles: { name: string; color: string }[],
  segmentRoles: { segmentIndex: number; roleName: string }[]
): IdentifyRolesResponse {
  const forcedSegmentRoles = forceNarrationToNarrator(segments, segmentRoles);
  const segmentTypeByIndex = new Map(segments.map((s) => [s.index, s.type]));
  const cleanedSegmentRoles = forcedSegmentRoles.map((assignment) => {
    return { ...assignment, roleName: normalizeRoleName(assignment.roleName) };
  });

  const usedDialogueRoles = new Set<string>();
  for (const assignment of cleanedSegmentRoles) {
    if (
      assignment.roleName &&
      assignment.roleName !== "旁白" &&
      segmentTypeByIndex.get(assignment.segmentIndex) === "dialogue"
    ) {
      usedDialogueRoles.add(assignment.roleName);
    }
  }

  const existingByName = new Map(roles.map((r) => [r.name, r]));
  const cleanedRoles = [
    existingByName.get("旁白") || { name: "旁白", color: "#6B7280" },
  ];

  for (const roleName of usedDialogueRoles) {
    cleanedRoles.push(
      existingByName.get(roleName) || {
        name: roleName,
        color: ROLE_COLORS[(cleanedRoles.length - 1) % ROLE_COLORS.length],
      }
    );
  }

  return {
    success: true,
    roles: cleanedRoles,
    segmentRoles: cleanedSegmentRoles,
  };
}

/**
 * Main entry point: identify roles from text segments.
 * Uses chunking for large texts and merges results.
 */
export async function identifyRoles(
  segments: RawSegment[]
): Promise<IdentifyRolesResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      roles: [],
      segmentRoles: [],
      error: "DEEPSEEK_API_KEY environment variable is not configured",
    };
  }

  // If few segments, process in one shot
  if (segments.length <= CHUNK_SIZE) {
    return callDeepSeek(segments, []);
  }

  // For large texts, use a two-pass strategy:
  // Pass 1: Send a representative sample to identify ALL characters
  // Pass 2: Use those characters to label all segments in chunks

  try {
    // Pass 1: Extract characters from evenly sampled segments
    const sampleSize = Math.min(CHUNK_SIZE, segments.length);
    const step = Math.max(1, Math.floor(segments.length / sampleSize));
    const sample: RawSegment[] = [];
    for (let i = 0; i < segments.length && sample.length < sampleSize; i += step) {
      sample.push(segments[i]);
    }

    const pass1Result = await callDeepSeek(sample, []);
    if (!pass1Result.success) {
      return pass1Result;
    }

    const allRoles = pass1Result.roles;
    const allSegmentRoles: { segmentIndex: number; roleName: string }[] = [...pass1Result.segmentRoles];

    // Pass 2: Process remaining segments in chunks, referencing known roles
    const sampledIndices = new Set(sample.map((s) => s.index));
    const remainingSegments = segments.filter((s) => !sampledIndices.has(s.index));

    for (let i = 0; i < remainingSegments.length; i += CHUNK_SIZE) {
      const chunk = remainingSegments.slice(i, i + CHUNK_SIZE);
      const chunkResult = await callDeepSeek(chunk, allRoles);

      if (chunkResult.success) {
        // Merge new roles
        for (const role of chunkResult.roles) {
          if (!allRoles.find((r) => r.name === role.name)) {
            allRoles.push(role);
          }
        }
        // Merge segment assignments
        allSegmentRoles.push(...chunkResult.segmentRoles);
      }
      // If a chunk fails, we skip it and rely on rule-based fallback later
    }

    // Deduplicate roles by name and assign colors
    const seen = new Map<string, { name: string; color: string }>();
    for (const role of allRoles) {
      if (!seen.has(role.name)) {
        const idx = seen.size;
        seen.set(role.name, {
          name: role.name,
          color: role.name === "旁白" ? "#6B7280" : ROLE_COLORS[(idx - 1) % ROLE_COLORS.length],
        });
      }
    }

    return pruneUnusedDialogueRoles(
      segments,
      Array.from(seen.values()),
      allSegmentRoles
    );
  } catch (err) {
    return {
      success: false,
      roles: [],
      segmentRoles: [],
      error: `DeepSeek API request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

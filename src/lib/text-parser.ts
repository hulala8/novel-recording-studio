// ============================================================
// Text segmentation and paragraph parsing utilities
// ============================================================

import type { RawSegment } from "./types";
import { normalizeRoleName } from "./role-name-utils";

// Chinese quote pairs: left → right
const LEFT_QUOTES = new Set([
  "“", // " (left double)
  "‘", // ' (left single)
  "「", // 「 (left corner bracket)
  "『", // 『 (left white corner bracket)
]);

const RIGHT_QUOTES = new Set([
  "”", // " (right double)
  "’", // ' (right single)
  "」", // 」 (right corner bracket)
  "』", // 』 (right white corner bracket)
]);

const QUOTE_PAIR: Record<string, string> = {
  "“": "”", // " → "
  "‘": "’", // ' → '
  "「": "」", // 「 → 」
  "『": "』", // 『 → 』
};

// Speech-verb regex pattern — reused across extractCharacterNames and ruleBasedRoleAssign
// Multi-char verbs listed FIRST so "问道" is tried before "道", "笑道" before "笑", etc.
// Non-capturing for ruleBasedRoleAssign compatibility; capturing version used in extractCharacterNames
const SPEECH_VERBS =
  "(?:问道|说道|答道|笑道|怒道|叹道|喊道|叫道|嘀咕|嘟囔|呢喃|惊叹|开口|回话|插嘴|补充|反驳|质疑|冷笑|怒喝|轻叹|告诉|吩咐|嘱咐|说|道|问|答|喊|叫|嚷|骂|吼)";

// Compound words where the second character is a speech verb — these are NOT "name + speech verb"
// e.g., "知道" is a compound (to know), not "知" saying something
const SPEECH_VERB_COMPOUNDS = new Set([
  // 道-based compounds
  "知道", "味道", "频道", "街道", "人道", "地道", "公道", "霸道",
  "赤道", "航道", "轨道", "力道", "门道", "难道", "渠道",
  "隧道", "一道", "正道", "管道", "说道",
  // 说-based compounds
  "小说", "传说", "解说", "再说", "虽说", "别说", "胡说",
  "劝说", "诉说", "话说", "细说", "直说", "实说",
  // 问-based compounds
  "疑问", "访问", "顾问", "学问", "发问", "反问",
  // 答-based compounds
  "回答", "解答", "对答",
]);

interface QuotedPart {
  text: string;
  inQuote: boolean;
}

/**
 * Split a text paragraph into alternating non-quoted / quoted parts
 * using character-by-character scanning with a quote stack.
 *
 * Supports:
 * - Chinese curly quotes: "" '' 「」 『』
 * - ASCII straight double quotes: " (toggles open/close)
 */
function extractQuotedParts(text: string): QuotedPart[] {
  const result: QuotedPart[] = [];
  let buffer = "";
  const quoteStack: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // ASCII straight double quote " — toggles in/out (same char opens and closes)
    if (ch === '"') {
      if (quoteStack.length > 0 && quoteStack[quoteStack.length - 1] === '"') {
        // End ASCII quote
        buffer += ch;
        result.push({ text: buffer, inQuote: true });
        buffer = "";
        quoteStack.pop();
      } else if (quoteStack.length === 0) {
        // Start ASCII quote (only start when not already inside a quote)
        if (buffer.trim().length > 0) {
          result.push({ text: buffer, inQuote: false });
        }
        buffer = ch;
        quoteStack.push(ch);
      } else {
        // Inside a different quote type — treat as regular character
        buffer += ch;
      }
    } else if (LEFT_QUOTES.has(ch) && quoteStack.length === 0) {
      // Start of a Chinese curly quote
      if (buffer.trim().length > 0) {
        result.push({ text: buffer, inQuote: false });
      }
      buffer = ch;
      quoteStack.push(ch);
    } else if (
      RIGHT_QUOTES.has(ch) &&
      quoteStack.length > 0 &&
      QUOTE_PAIR[quoteStack[quoteStack.length - 1]] === ch
    ) {
      // End of matching Chinese curly quote
      buffer += ch;
      result.push({ text: buffer, inQuote: true });
      buffer = "";
      quoteStack.pop();
    } else {
      buffer += ch;
    }

    i++;
  }

  // Flush trailing text
  if (buffer.trim().length > 0) {
    result.push({ text: buffer, inQuote: false });
  }

  return result;
}

/**
 * Merge quoted parts that are too short with their neighbors.
 */
function mergeTinyQuoteParts(parts: QuotedPart[], minLen: number): QuotedPart[] {
  if (parts.length <= 1) return parts;

  const merged: QuotedPart[] = [];
  let i = 0;

  while (i < parts.length) {
    const current = parts[i];

    if (current.text.trim().length < minLen) {
      if (merged.length > 0) {
        merged[merged.length - 1] = {
          text: merged[merged.length - 1].text + current.text,
          inQuote: merged[merged.length - 1].inQuote,
        };
      } else if (i + 1 < parts.length) {
        parts[i + 1] = {
          text: current.text + parts[i + 1].text,
          inQuote: parts[i + 1].inQuote,
        };
      } else {
        merged.push(current);
      }
    } else {
      merged.push(current);
    }
    i++;
  }

  return merged;
}

/**
 * Check whether the text follows the 画本 (huaben) script format.
 *
 * Detected by the presence of 【角色名】 bracket cues. Works with or
 * without the 正文 / 角色总表 metadata sections.
 */
export function isHuabenFormat(text: string): boolean {
  const bracketMatches = text.match(/【[^】]+】/g);
  return bracketMatches !== null && bracketMatches.length >= 3;
}

/**
 * Extract the main text portion (everything after "正文") from 画本 format.
 */
export function extractHuabenMainText(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "正文") {
      return lines.slice(i + 1).join("\n");
    }
  }
  return null;
}

/**
 * Extract character names from the 角色总表 section of a 画本 text.
 */
export function extractHuabenRoleTableNames(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const names = new Set<string>();
  const charLineRe = /^【(.+?)】【.+?】【.+?】【\d+】$/;

  for (const line of normalized.split("\n")) {
    const match = line.trim().match(charLineRe);
    if (match) {
      const name = match[1].trim();
      if (name.length >= 1 && name.length <= 4) {
        names.add(name);
      }
    }
  }

  return Array.from(names);
}

/**
 * Segment the main text of a 画本 script using its explicit 【Role】 cues.
 *
 * Core rule: 【X】marks the start of dialogue by character X. The dialogue
 * extends to the end of the LINE. Everything else is narration.
 *
 * Handles both:
 *   - Line-start:  【胡疤子】后头有人来过。
 *   - Mid-line:    白松华说：【白松华】"你好啊！"
 */
function segmentHuabenMainText(mainText: string): RawSegment[] {
  const normalized = mainText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const bracketRe = /【([^】]+?)】/g;
  const segments: RawSegment[] = [];
  let index = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Find ALL 【X】 markers on this line
    bracketRe.lastIndex = 0;
    const matches: { start: number; end: number; roleName: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = bracketRe.exec(line)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, roleName: m[1] });
    }

    if (matches.length === 0) {
      // No bracket — pure narration line
      const last = segments[segments.length - 1];
      if (last && last.type === "narration") {
        last.text += line;
      } else {
        segments.push({ text: line, index: index++, type: "narration" });
      }
      continue;
    }

    let pos = 0;
    for (const cue of matches) {
      // Text before this【X】on the same line → narration
      if (cue.start > pos) {
        const before = line.slice(pos, cue.start).trim();
        if (before) {
          const last = segments[segments.length - 1];
          if (last && last.type === "narration") {
            last.text += before;
          } else {
            segments.push({ text: before, index: index++, type: "narration" });
          }
        }
      }

      // Text from【X】to end of line → dialogue
      const dialogueText = line.slice(cue.start).trim();
      if (dialogueText) {
        segments.push({ text: dialogueText, index: index++, type: "dialogue" });
      }

      // After the first【X】on a line, the rest (to end of line)
      // is already consumed as dialogue. Skip remaining matches
      // on this line — they're inside the dialogue content.
      break;
    }
  }

  return segments;
}

/**
 * Segment raw text into structured paragraphs suitable for role identification.
 *
 * Automatically detects 画本 format and uses specialized segmentation.
 */
export function segmentText(text: string): RawSegment[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "    ");

  if (isHuabenFormat(normalized)) {
    const mainText = extractHuabenMainText(normalized) || normalized;
    const segments = segmentHuabenMainText(mainText);
    if (segments.length > 0) return segments;
  }

  const paragraphs = normalized
    .split(/\n\n+/)
    .map((p) => p.replace(/\n/g, "").trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  const segments: RawSegment[] = [];
  let index = 0;

  for (const para of paragraphs) {
    const parts = extractQuotedParts(para);
    const cleaned = mergeTinyQuoteParts(parts, 3);

    for (const part of cleaned) {
      const trimmed = part.text.trim();
      if (trimmed.length > 0) {
        segments.push({
          text: trimmed,
          index: index++,
          type: part.inQuote ? "dialogue" : "narration",
        });
      }
    }
  }

  return segments;
}

/**
 * Extract names from 【Name-Separator-Descriptor】 bracket patterns.
 * Common separators: - (dash), 一 (U+4E00, used as dash in some texts),
 * — (em dash U+2014), ～ (wave dash), · (middle dot)
 * e.g., 【刘信-浪客】→ 刘信, 【贾嘉华一老吴】→ 贾嘉华, 【张三】→ 张三
 */
// Character class for allowed separators between name and descriptor.
// Put - at end so it's literal, not a range.
const BRACKET_SEP_CHARS = "一—～·-";
// Global regex for extractBracketNames (used with .exec() in a loop)
const BRACKET_NAME_RE_G = new RegExp(
  `【([^】${BRACKET_SEP_CHARS}]+?)(?:[${BRACKET_SEP_CHARS}][^】]+)?】`,
  "g"
);
// Non-global regex for single-match use in ruleBasedRoleAssign step 2a
const BRACKET_NAME_RE = new RegExp(
  `【([^】${BRACKET_SEP_CHARS}]+?)(?:[${BRACKET_SEP_CHARS}][^】]+)?】`
);

export function extractBracketNames(text: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = BRACKET_NAME_RE_G.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length >= 1 && name.length <= 4) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Shared validation for a candidate name extracted from text patterns.
 * Returns true if the string looks like a plausible person name (not a pronoun,
 * adverb, structural particle, common noun, etc.).
 */
function isValidExtractedName(name: string): boolean {
  if (
    name.length < 1 ||
    name.length > 4 ||
    /^(?:的|了|在|是|和|就|也|都|还|要|会|能|可以|这个|那个|什么|怎么|哪个)$/.test(name) ||
    /^(?:一下|起来|出来|过来|过去|下来)$/.test(name) ||
    /^(?:忽然|突然|然后|于是|接着|便|又|再|才|就|已经|曾经|正在)$/.test(name) ||
    /^(?:轻轻|淡淡|微微|冷冷|慢慢|静静|缓缓|悠悠|悄悄|默默|狠狠|重重)$/.test(name) ||
    /^(?:轻声|低声|小声|大声|高声|柔声|厉声|沉声|冷声|怒声|笑着|微笑着|大笑着|苦笑着|冷笑着|淡笑着|笑|微笑|大笑|苦笑|冷笑|淡笑)$/.test(name) ||
    /^(?:压低声音|提高声音|放低声音|头也不抬|头也不回)$/.test(name) ||
    /^(?:没有|不是|不会|不能|不要|不用|不必)$/.test(name) ||
    /^(?:抬起头|低下头|转过头|站起身|坐直|站起|坐下)$/.test(name) ||
    /^(?:街|路|巷|灯|门|窗|墙|楼|屋|房|树|花|草|山|水|河|海|天|地|日|月|星|云|风|雨|雪)$/.test(name) ||
    /^(?:街道|知道|味道|频道)$/.test(name) ||
    // Exact pronoun matches
    /^(?:你|我|他|她|它|你们|我们|他们|她们|它们|有人|别人|这人|那人|某人)$/.test(name) ||
    // Names starting with pronoun (e.g., "他说", "我在")
    /^(?:你|我|他|她|它|你们|我们|他们|她们|它们|有人|别人|这人|那人|某人)[一-鿿]+/.test(name) ||
    // Prepositional/grammatical particles inside a name (e.g., "舅对娘" from "舅对娘说")
    /[对跟向和给朝冲替为让叫把被]/.test(name) ||
    // Speech verbs inside the name (e.g., "补了一句" from "补了一句说")
    /(?:问道|说道|答道|笑道|怒道|叹道|喊道|叫道|嘀咕|嘟囔|呢喃|惊叹|开口|回话|插嘴|补充|反驳|质疑|冷笑|怒喝|轻叹|告诉|吩咐|嘱咐|说|道|问|答|喊|叫|嚷|骂|吼)/.test(name) ||
    /[的得]/.test(name)
  ) {
    return false;
  }
  return true;
}

/**
 * Extract potential character names using speech-verb patterns, bracket markers,
 * and post-quote positions.
 *
 * Three sources:
 * 1. 【Name-Descriptor】or【Name】bracket markers — direct speaker indicators
 * 2. "XX说/道/问..." speech-verb patterns — XX is a candidate character name
 * 3. "dialogue"NAME — NAME right after a closing quote (even without speech verb)
 */
export function extractCharacterNames(text: string): string[] {
  const names = new Set<string>();
  names.add("旁白"); // 旁白

  // Source 1: 【Name-Descriptor】bracket patterns — high-confidence speaker markers
  for (const name of extractBracketNames(text)) {
    names.add(name);
  }

  // Source 2: Match 1-4 Chinese characters before a speech verb
  // {1,4}? is non-greedy so "王婶问道" captures "王婶" not "王婶问"
  // Capturing groups: [1]=name, [2]=speech verb
  const CAPTURING_SPEECH_VERBS = SPEECH_VERBS.replace("(?:", "(");
  const speakerPattern = new RegExp(
    `([一-鿿]{1,4}?)\\s*${CAPTURING_SPEECH_VERBS}`,
    "g"
  );

  let match: RegExpExecArray | null;
  while ((match = speakerPattern.exec(text)) !== null) {
    const name = match[1].trim();
    const verb = match[2];

    // Skip if name + first verb char forms a compound word (e.g., 知道, 味道)
    const possibleCompound = name + (verb[0] || "");
    if (SPEECH_VERB_COMPOUNDS.has(possibleCompound)) continue;

    if (isValidExtractedName(name)) {
      names.add(name);
    }
  }

  // Source 3: Names appearing right after a closing quote
  // Pattern: "dialogue"NAME or "dialogue"NAME — NAME is often the speaker
  // even when not followed by a speech verb (e.g., "走！"陈九宸咬牙)
  // Uses {2,3} (not {2,4}) to avoid greedily capturing the first char of an action verb.
  // Common single-char verbs that follow names (咬, 扯, 盯, 看, etc.) are used to trim
  // false-positive 3-char captures like "王婶咬" → "王婶".
  // Quote chars: \\u201c = ", \\u201d = ", \\u0022 = " (ASCII)
  const POST_NAME_ACTION_CHARS = new Set(
    "咬牙扯抓看走跑站坐笑哭说问道答喊叫叹骂吼想转抬低回点摇摆挥推拉拍摸指瞪望瞥闭睁吸呼咳嗽吐吞咽颤抖踹踢踩踏跃跳跪趴躺倒冲闯奔飞闪躲藏逃追赶护挡拦扶抱搂握捏掐拧按压砸敲打揍劈砍刺捅割切".split("")
  );
  const ALL_QUOTE_CHARS = '"“”';
  const postQuotePattern = new RegExp(
    `[${ALL_QUOTE_CHARS}][^${ALL_QUOTE_CHARS}]*?[${ALL_QUOTE_CHARS}]\\s*([一-鿿]{2,3})`,
    "g"
  );
  while ((match = postQuotePattern.exec(text)) !== null) {
    const chunk = match[1];
    let name = chunk;
    // If 3 chars and the last char is a common post-name action verb,
    // trim to 2 chars — the third char is likely the start of the action
    if (chunk.length === 3 && POST_NAME_ACTION_CHARS.has(chunk[2])) {
      name = chunk.slice(0, 2);
    }
    if (isValidExtractedName(name)) {
      names.add(name);
    }
  }

  return Array.from(names);
}

/**
 * Rule-based role assignment as fallback when AI is unavailable.
 */
export function ruleBasedRoleAssign(
  segments: RawSegment[],
  characterNames: string[]
): { segmentIndex: number; roleName: string }[] {
  let lastSpeaker = "旁白"; // 旁白

  // For pure-dialogue texts (zero narration) with no character names extracted,
  // use alternating speakers instead of lumping everything under 旁白
  const hasNarration = segments.some((s) => s.type === "narration");
  const hasRealNames = characterNames.some((n) => n !== "旁白");
  const useAlternating = !hasNarration && !hasRealNames;
  let altToggle = 0;

  return segments.map((seg) => {
    // Narration is ALWAYS 旁白
    if (seg.type === "narration") {
      return { segmentIndex: seg.index, roleName: "旁白" };
    }

    let roleName: string | null = null;

    // 1. Check if this segment's own text contains a speaker attribution
    for (const name of characterNames) {
      if (name === "旁白") continue;

      const patterns = [
        new RegExp(`${name}\\s*${SPEECH_VERBS}`),
        new RegExp(`${name}[：:]\\s*["“”「『]`),
      ];

      if (patterns.some((p) => p.test(seg.text))) {
        roleName = name;
        break;
      }
    }

    // 2. If no speaker found, check preceding narration segment
    //    (for "XX说：" or 【Name-Descriptor】 patterns)
    if (!roleName) {
      const thisIdx = segments.indexOf(seg);
      if (thisIdx > 0) {
        const prevSeg = segments[thisIdx - 1];
        if (prevSeg.type === "narration") {
          // 2a. Check for 【Name-Descriptor】 bracket pattern (high-confidence)
          //     Supports separators: - 一 — ～ ·
          const bracketNameMatch = prevSeg.text.match(
            BRACKET_NAME_RE
          );
          if (bracketNameMatch) {
            roleName = bracketNameMatch[1].trim();
          }

          // 2b. Check for speech-verb patterns
          if (!roleName) {
            for (const name of characterNames) {
              if (name === "旁白") continue;
              if (
                new RegExp(
                  `${name}\\s*${SPEECH_VERBS}[：:]?\\s*$`
                ).test(prevSeg.text)
              ) {
                roleName = name;
                break;
              }
            }
          }
        }
      }
    }

    // 3. If still no speaker, check the FOLLOWING narration segment
    //    (post-dialogue attribution patterns)
    if (!roleName) {
      const thisIdx = segments.indexOf(seg);
      if (thisIdx >= 0 && thisIdx < segments.length - 1) {
        const nextSeg = segments[thisIdx + 1];
        if (nextSeg.type === "narration") {
          for (const name of characterNames) {
            if (name === "旁白") continue;
            // Pattern A: "NAME说/道/问..." at start of next narration
            if (
              new RegExp(`^${name}\\s*${SPEECH_VERBS}`).test(nextSeg.text)
            ) {
              roleName = name;
              break;
            }
            // Pattern B: "是NAME" at start — explicitly identifies speaker
            if (
              new RegExp(`^是${name}[，。\\s]`).test(nextSeg.text)
            ) {
              roleName = name;
              break;
            }
            // Pattern C: "NAME的声音/NAME的语气" — voice attribution
            if (
              new RegExp(`^${name}的(?:声音|嗓子|语气|话|语调|口气)`).test(
                nextSeg.text
              )
            ) {
              roleName = name;
              break;
            }
            // Pattern D: NAME at the very start of next narration (no speech verb needed)
            // Catches cases like "走！"陈九宸咬牙 where 咬牙 is not a speech verb
            // Uses startsWith instead of regex because the character after the name
            // could be ANYTHING (action verb, body part, emotion, etc.)
            if (nextSeg.text.startsWith(name)) {
              roleName = name;
              break;
            }
          }
        }
      }
    }

    // 4. Fall back to last known speaker for continued dialogue
    // Skip in alternating mode — we want deliberate alternation, not chaining
    if (!roleName && !useAlternating && lastSpeaker !== "旁白") {
      roleName = lastSpeaker;
    }

    // 5. Final fallback
    if (!roleName) {
      if (useAlternating) {
        roleName = altToggle % 2 === 0 ? "角色A" : "角色B";
        altToggle++;
      } else {
        roleName = "旁白";
      }
    }

    roleName = normalizeRoleName(roleName);

    lastSpeaker = roleName;

    return { segmentIndex: seg.index, roleName };
  });
}

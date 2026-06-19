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

interface QuotedPart {
  text: string;
  inQuote: boolean;
}

/**
 * Split a text paragraph into alternating non-quoted / quoted parts
 * using character-by-character scanning with a quote stack.
 *
 * Example:
 *   input:  张三说："你好。"然后转身离开。
 *   output: [{text:"张三说：", inQuote:false}, {text:""你好。"", inQuote:true}, {text:"然后转身离开。", inQuote:false}]
 */
function extractQuotedParts(text: string): QuotedPart[] {
  const result: QuotedPart[] = [];
  let buffer = "";
  const quoteStack: string[] = []; // tracks which left quote we're inside
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (LEFT_QUOTES.has(ch) && quoteStack.length === 0) {
      // Start of a new quote — flush non-quoted buffer first
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
      // End of current quote
      buffer += ch;
      result.push({ text: buffer, inQuote: true });
      buffer = "";
      quoteStack.pop();
    } else {
      buffer += ch;
    }

    i++;
  }

  // Flush any trailing non-quoted text
  if (buffer.trim().length > 0) {
    result.push({ text: buffer, inQuote: false });
  }

  return result;
}

/**
 * Merge quoted parts that are too short with their neighbors.
 * A standalone short fragment (< minLen) gets merged into the adjacent part.
 */
function mergeTinyQuoteParts(parts: QuotedPart[], minLen: number): QuotedPart[] {
  if (parts.length <= 1) return parts;

  const merged: QuotedPart[] = [];
  let i = 0;

  while (i < parts.length) {
    const current = parts[i];

    // If current part is very short, try to merge with neighbor
    if (current.text.trim().length < minLen) {
      if (merged.length > 0) {
        // Merge into previous
        merged[merged.length - 1] = {
          text: merged[merged.length - 1].text + current.text,
          inQuote: merged[merged.length - 1].inQuote,
        };
      } else if (i + 1 < parts.length) {
        // Merge into next
        parts[i + 1] = {
          text: current.text + parts[i + 1].text,
          inQuote: parts[i + 1].inQuote,
        };
      } else {
        // Standalone tiny part — keep it
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
 * Segment raw text into structured paragraphs suitable for role identification.
 *
 * Rules:
 * - Content inside Chinese quotes ("", '', 「」, 『』) → type:"dialogue"
 * - Content outside quotes → type:"narration" (always 旁白)
 * - Paragraphs split by blank lines
 */
export function segmentText(text: string): RawSegment[] {
  // Normalize line endings
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "    ");

  // Split by double newlines (paragraph breaks)
  const paragraphs = normalized
    .split(/\n\n+/)
    .map((p) => p.replace(/\n/g, "").trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return [];
  }

  const segments: RawSegment[] = [];
  let index = 0;

  for (const para of paragraphs) {
    // Extract quoted and non-quoted parts
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
 * Extract names from 【Name-Descriptor】 or 【Name】 bracket patterns.
 * e.g., 【刘信-浪客】→ 刘信, 【张三】→ 张三
 */
const BRACKET_NAME_PATTERN = /【([^】-]+?)(?:-[^】]+)?】/g;

function extractBracketNames(text: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = BRACKET_NAME_PATTERN.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length >= 1 && name.length <= 4) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Extract potential character names using speech-verb patterns and bracket markers.
 *
 * Two sources:
 * 1. 【Name-Descriptor】or【Name】bracket markers — direct speaker indicators
 * 2. "XX说/道/问..." speech-verb patterns — XX is a candidate character name
 */
export function extractCharacterNames(text: string): string[] {
  const names = new Set<string>();
  names.add("旁白");

  // Source 1: 【Name-Descriptor】bracket patterns — high-confidence speaker markers
  for (const name of extractBracketNames(text)) {
    names.add(name);
  }

  // Source 2: Match 1-4 Chinese characters before a speech verb
  const speakerPattern =
    /([一-鿿]{1,4})\s*(?:说|道|问|答|喊|叫|嚷|骂|吼|嘀咕|嘟囔|呢喃|惊叹|开口|回话|插嘴|补充|反驳|质疑|冷笑|怒喝|轻叹|告诉|吩咐|嘱咐|问道|说道|答道|笑道|怒道|叹道|喊道|叫道)/g;

  let match: RegExpExecArray | null;
  while ((match = speakerPattern.exec(text)) !== null) {
    const name = match[1].trim();
    // Filter out non-name words
    if (
      name.length >= 1 &&
      name.length <= 4 &&
      // Exclude structural particles
      !/^(?:的|了|在|是|和|就|也|都|还|要|会|能|可以|这个|那个|什么|怎么|哪个)$/.test(name) &&
      // Exclude directional/complement compounds
      !/^(?:一下|起来|出来|过来|过去|下来)$/.test(name) &&
      // Exclude temporal adverbs
      !/^(?:忽然|突然|然后|于是|接着|便|又|再|才|就|已经|曾经|正在)$/.test(name) &&
      // Exclude manner adverbs (common before speech verbs)
      !/^(?:轻轻|淡淡|微微|冷冷|慢慢|静静|缓缓|悠悠|悄悄|默默|狠狠|重重)$/.test(name) &&
      // Exclude speech-manner adverbials
      !/^(?:轻声|低声|小声|大声|高声|柔声|厉声|沉声|冷声|怒声|笑着|微笑着|大笑着|苦笑着|冷笑着|淡笑着|笑|微笑|大笑|苦笑|冷笑|淡笑)$/.test(name) &&
      !/^(?:压低声音|提高声音|放低声音|头也不抬|头也不回)$/.test(name) &&
      // Exclude negation and auxiliary
      !/^(?:没有|不是|不会|不能|不要|不用|不必)$/.test(name) &&
      // Exclude body-part + verb combinations
      !/^(?:抬起头|低下头|转过头|站起身|坐直|站起|坐下)$/.test(name) &&
      // Exclude single-char false positives (common compounds with speech verbs)
      !/^(?:街|路|巷|灯|门|窗|墙|楼|屋|房|树|花|草|山|水|河|海|天|地|日|月|星|云|风|雨|雪)$/.test(name) &&
      // Exclude common noun compounds ending in speech verb characters
      !/^(?:街道|知道|味道|频道)$/.test(name)
    ) {
      names.add(name);
    }
  }

  return Array.from(names);
}

/**
 * Rule-based role assignment as fallback when AI is unavailable.
 *
 * Rules:
 * - narration segments → always 旁白
 * - dialogue segments → find speaker from nearby context
 */
export function ruleBasedRoleAssign(
  segments: RawSegment[],
  characterNames: string[]
): { segmentIndex: number; roleName: string }[] {
  let lastSpeaker = "旁白";

  return segments.map((seg) => {
    // Narration is ALWAYS 旁白
    if (seg.type === "narration") {
      return { segmentIndex: seg.index, roleName: "旁白" };
    }

    // Dialogue: try to find the speaker
    let roleName: string | null = null;

    // 1. Check if this segment's own text contains a speaker attribution
    for (const name of characterNames) {
      if (name === "旁白") continue;

      const patterns = [
        new RegExp(`${name}\\s*(?:说|道|问|答|喊|叫|嚷|骂|吼|嘀咕|嘟囔|呢喃|惊叹|开口|回话|插嘴|补充|反驳|质疑|冷笑|怒喝|轻叹|告诉|吩咐|嘱咐|问道|说道|答道|笑道|怒道|叹道|喊道|叫道)`),
        new RegExp(`${name}[：:]\\s*[""「『]`),
      ];

      if (patterns.some((p) => p.test(seg.text))) {
        roleName = name;
        break;
      }
    }

    // 2. If no speaker found in this segment, check preceding narration segments
    //    (the segment before this one often contains "XX说：" or 【Name-Descriptor】)
    if (!roleName) {
      const thisIdx = segments.indexOf(seg);
      if (thisIdx > 0) {
        const prevSeg = segments[thisIdx - 1];
        if (prevSeg.type === "narration") {
          // 2a. Check for 【Name-Descriptor】 bracket pattern first (high-confidence)
          //     e.g., 【刘信-浪客】→ 刘信 is the speaker
          const bracketNameMatch = prevSeg.text.match(
            /【([^】-]+?)(?:-[^】]+)?】/
          );
          if (bracketNameMatch) {
            roleName = bracketNameMatch[1].trim();
          }

          // 2b. Check for speech-verb patterns (XX说/道/问 etc.)
          if (!roleName) {
            for (const name of characterNames) {
              if (name === "旁白") continue;
              if (
                new RegExp(
                  `${name}\\s*(?:说|道|问|答|喊|叫|嚷|骂|吼|嘀咕|嘟囔|呢喃|惊叹|开口|回话|插嘴|补充|反驳|质疑|冷笑|怒喝|轻叹|告诉|吩咐|嘱咐|问道|说道|答道|笑道|怒道|叹道|问道|喊道|叫道)[：:]?\\s*$`
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

    // 3. Fall back to last known speaker if this looks like continued dialogue
    if (!roleName && lastSpeaker !== "旁白") {
      roleName = lastSpeaker;
    }

    // 4. Final fallback
    if (!roleName) {
      roleName = "旁白"; // user can fix in review
    }

    roleName = normalizeRoleName(roleName);

    lastSpeaker = roleName;

    return { segmentIndex: seg.index, roleName };
  });
}

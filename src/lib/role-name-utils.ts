const BLOCKED_ROLE_NAMES = new Set([
  "你",
  "我",
  "他",
  "她",
  "它",
  "你们",
  "我们",
  "他们",
  "她们",
  "它们",
  "有人",
  "别人",
  "听",
  "据",
  "说",
  "问",
  "急忙",
  "赶紧",
  "突然",
  "连忙",
  "轻轻",
  "悄悄",
  "慌忙",
  "明显",
  "还是",
  "已经",
  "也能",
  "不知",
  "不知道",
  "咱都不知",
  "你不知道",
  "你不知",
  "你们这样",
  "青娥才知",
  "又撒撒嘴",
  "敢跟你多",
  "也能给娃",
  "跟勇搭腔",
  "急忙掩嘴",
  "对胡彩香",
]);

export function isLikelyRealRoleName(name: string): boolean {
  const trimmed = name.trim().replace(/[，。！？!?、\s]+$/g, "");
  if (!trimmed || trimmed === "旁白") return true;
  if (BLOCKED_ROLE_NAMES.has(trimmed)) return false;
  if (/^[你我他她它们我们听说问喊叫]+$/.test(trimmed)) return false;
  if (/^[0-9A-Za-z]+$/.test(trimmed)) return false;
  if (trimmed.length > 6) return false;
  if (/^(?:和|跟|对|向|给|把|被|在|到|从|用|让|叫|使|把人|有人|没人)/.test(trimmed)) {
    return false;
  }
  if (/^(?:又|再|才|就|都|也|还|只|却|便|要|会|能|可以|敢|忙|急忙|赶紧|连忙)/.test(trimmed)) {
    return false;
  }
  if (/^(?:你|我|他|她|它|你们|我们|他们|她们|它们|有人|别人)/.test(trimmed)) {
    return false;
  }
  if (/^(?:急忙|赶紧|突然|连忙|轻轻|悄悄|慌忙|明显|还是|已经|也能|不知|不知道)/.test(trimmed)) {
    return false;
  }
  if (/(?:才知|才知道|都不知|不知道|不知|搭腔|掩嘴|撒嘴|撇嘴|嘴)$/.test(trimmed)) {
    return false;
  }
  return true;
}

export function normalizeRoleName(name: string): string {
  return isLikelyRealRoleName(name) ? name.trim() : "旁白";
}

/**
 * VRChat swaps ASCII punctuation in user-written text (bios, statuses, names, notes…) for
 * look-alike Unicode so it can't be used for formatting tricks. This maps them back for display.
 * Same table VRCX uses, plus the full-width apostrophe.
 */
const LOOKALIKES: Record<string, string> = {
  "＠": "@",
  "＃": "#",
  "＄": "$",
  "％": "%",
  "＆": "&",
  "＝": "=",
  "＋": "+",
  "⁄": "/",
  "＼": "\\",
  ";": ";", // Greek question mark, renders exactly like a semicolon
  "˸": ":",
  "‚": ",",
  "？": "?",
  "ǃ": "!",
  "＂": '"',
  "＇": "'",
  "≺": "<",
  "≻": ">",
  "․": ".",
  "＾": "^",
  "｛": "{",
  "｝": "}",
  "［": "[",
  "］": "]",
  "（": "(",
  "）": ")",
  "｜": "|",
  "∗": "*",
};

const PATTERN = new RegExp(`[${Object.keys(LOOKALIKES).join("").replace(/[\\\]^-]/g, "\\$&")}]`, "g");

export function fixSymbols(text: string): string {
  return text.replace(PATTERN, (c) => LOOKALIKES[c] ?? c);
}

/** Apply `fixSymbols` to every string inside a JSON-like value (keys are left alone). */
export function fixDeep<T>(value: T): T {
  if (typeof value === "string") return fixSymbols(value) as T;
  if (Array.isArray(value)) return value.map(fixDeep) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = fixDeep(v);
    return out as T;
  }
  return value;
}

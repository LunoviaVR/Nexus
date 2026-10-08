import { describe, expect, it } from "vitest";
import { diffStats, lineDiff } from "./diff";
import { fixDeep, fixSymbols } from "./text";

describe("fixSymbols", () => {
  it("restores VRChat's look-alike punctuation", () => {
    expect(fixSymbols("Owner˸ Sage; co-owner［Jay］ ｛x｝ hiǃ end․")).toBe("Owner: Sage; co-owner[Jay] {x} hi! end.");
    expect(fixSymbols("a‚ b？ （c） ＂d＂ e⁄f ＃1 ＠me")).toBe('a, b? (c) "d" e/f #1 @me');
  });
  it("leaves normal text alone", () => {
    expect(fixSymbols("Peekaboo :3 — 愛して")).toBe("Peekaboo :3 — 愛して");
  });
  it("fixes nested values but not keys", () => {
    expect(fixDeep({ "a˸b": ["x˸y", { bio: "hiǃ" }], n: 3 })).toEqual({ "a˸b": ["x:y", { bio: "hi!" }], n: 3 });
  });
});

describe("lineDiff", () => {
  it("marks changed lines with word highlights", () => {
    const lines = lineDiff("Hello there\nSecond line", "Hello friend\nSecond line\nNew line");
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
    expect(lines[0]).toMatchObject({ type: "del", oldNo: 1 });
    expect(lines[0].parts.filter((p) => p.changed).map((p) => p.text)).toEqual(["there"]);
    expect(lines[1].parts.filter((p) => p.changed).map((p) => p.text)).toEqual(["friend"]);
    expect(lines.at(-1)).toMatchObject({ type: "add", newNo: 3 });
  });
  it("handles identical and empty inputs", () => {
    expect(diffStats(lineDiff("same", "same"))).toEqual({ added: 0, removed: 0 });
    expect(diffStats(lineDiff("", "now has a bio"))).toEqual({ added: 1, removed: 1 });
  });
});

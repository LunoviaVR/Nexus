import { describe, expect, it } from "vitest";
import { ACCENTS, isTheme, nearestAccent } from "./ui";

describe("ACCENTS", () => {
  it("runs through the rainbow in order", () => {
    expect(ACCENTS.map((a) => a.name)).toEqual(["Red", "Orange", "Yellow", "Green", "Blue", "Indigo", "Violet"]);
    expect(ACCENTS.map((a) => a.hue)).toEqual([...ACCENTS.map((a) => a.hue)].sort((a, b) => a - b));
  });
});

describe("nearestAccent", () => {
  it("keeps colors that are offered", () => {
    for (const { hue } of ACCENTS) expect(nearestAccent(hue)).toBe(hue);
  });

  it("moves colors from older versions to the closest one offered", () => {
    expect(nearestAccent(260)).toBe(268); // old indigo
    expect(nearestAccent(220)).toBe(245); // old blue
    expect(nearestAccent(130)).toBe(145); // old green
    expect(nearestAccent(60)).toBe(55); // old amber
    expect(nearestAccent(350)).toBe(25); // old pink wraps round to red
  });

  it("falls back to the default for junk", () => {
    expect(nearestAccent(Number.NaN)).toBe(290);
  });
});

describe("isTheme", () => {
  it("accepts only known themes", () => {
    expect(["dark", "oled", "light", "system"].every(isTheme)).toBe(true);
    expect(isTheme("amoled")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

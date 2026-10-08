import { describe, expect, it } from "vitest";
import { DEFAULT_EMOJIS } from "@/components/BoopButton";

describe("boop emoji ids", () => {
  it("are all valid default emoji ids", () => {
    for (const [, id] of DEFAULT_EMOJIS) expect(id).toMatch(/^default_[a-z_]+$/);
    expect(new Set(DEFAULT_EMOJIS.map(([, id]) => id)).size).toBe(DEFAULT_EMOJIS.length);
  });

  it("uses VRChat's ids where they differ from the names", () => {
    const id = Object.fromEntries(DEFAULT_EMOJIS);
    expect(id["Can't see"]).toBe("default_cantsee");
    expect(id["Arrow Point"]).toBe("default_arrowpoint");
    expect(id["No Headphones"]).toBe("default_noheadphones");
    expect(id["No Mic"]).toBe("default_nomic");
    expect(id["Bats"]).toBe("default_bat");
  });
});

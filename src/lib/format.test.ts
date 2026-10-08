import { describe, expect, it } from "vitest";
import { list } from "./format";

describe("list", () => {
  it("passes arrays through", () => {
    expect(list([1, 2])).toEqual([1, 2]);
  });

  it("treats anything else as empty", () => {
    // VRChat has sent objects, strings and null for list fields like unityPackages.
    for (const odd of [null, undefined, {}, { 0: "x" }, "android", 3]) {
      expect(list(odd)).toEqual([]);
    }
  });
});

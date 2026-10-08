import { describe, expect, it } from "vitest";
import { isJoinable, parseLocation, sameInstance } from "./location";

const W = "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b";

describe("parseLocation", () => {
  it("handles special locations", () => {
    expect(parseLocation("offline").kind).toBe("offline");
    expect(parseLocation("").kind).toBe("offline");
    expect(parseLocation(undefined).kind).toBe("offline");
    expect(parseLocation("private").kind).toBe("private");
    expect(parseLocation("traveling").kind).toBe("traveling");
  });

  it("parses a public instance", () => {
    const p = parseLocation(`${W}:12345`);
    expect(p).toMatchObject({ kind: "instance", worldId: W, name: "12345", access: "public", region: "us" });
    expect(isJoinable(p)).toBe(true);
  });

  it("parses friends+ with region", () => {
    const p = parseLocation(`${W}:777~hidden(usr_abc)~region(eu)`);
    expect(p).toMatchObject({ access: "friends+", ownerId: "usr_abc", region: "eu" });
  });

  it("distinguishes invite and invite+", () => {
    expect(parseLocation(`${W}:1~private(usr_a)~region(jp)`).access).toBe("invite");
    const p = parseLocation(`${W}:1~private(usr_a)~canRequestInvite~region(jp)`);
    expect(p.access).toBe("invite+");
    expect(isJoinable(p)).toBe(false);
  });

  it("parses group instances", () => {
    expect(parseLocation(`${W}:1~group(grp_x)~groupAccessType(public)`).access).toBe("group public");
    expect(parseLocation(`${W}:1~group(grp_x)~groupAccessType(plus)`).access).toBe("group+");
    const g = parseLocation(`${W}:1~group(grp_x)~groupAccessType(members)`);
    expect(g).toMatchObject({ access: "group", groupId: "grp_x" });
  });

  it("compares instances ignoring nonce tags", () => {
    expect(sameInstance(`${W}:1~region(eu)`, `${W}:1~region(eu)~nonce(abc)`)).toBe(true);
    expect(sameInstance(`${W}:1~region(eu)`, `${W}:1~private(usr_a)`)).toBe(true);
    expect(sameInstance(`${W}:1`, `${W}:2`)).toBe(false);
  });
});

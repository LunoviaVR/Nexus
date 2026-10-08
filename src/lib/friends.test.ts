import { describe, expect, it } from "vitest";
import { byRecent } from "./friends";
import type { VrcUser } from "./types";

const f = (displayName: string, state: VrcUser["state"], extra: Partial<VrcUser> = {}) =>
  ({ id: displayName, displayName, state, ...extra }) as VrcUser;

describe("byRecent", () => {
  it("orders offline friends by last seen, not by name", () => {
    const list = [
      f("Aaron", "offline", { last_login: "2026-10-01T00:00:00Z" }),
      f("Zoe", "offline", { last_login: "2026-10-07T00:00:00Z" }),
      f("Mia", "offline", { last_login: "2026-10-04T00:00:00Z" }),
    ];
    expect(list.sort(byRecent).map((x) => x.displayName)).toEqual(["Zoe", "Mia", "Aaron"]);
  });

  it("breaks the startup tie for online friends with VRChat's last activity", () => {
    const startup = 1_000;
    const list = [
      f("Aaron", "online", { $locationAt: startup, last_activity: "2026-10-01T00:00:00Z" }),
      f("Zoe", "online", { $locationAt: startup, last_activity: "2026-10-07T00:00:00Z" }),
      f("Mia", "online", { $locationAt: startup + 5 }),
    ];
    expect(list.sort(byRecent).map((x) => x.displayName)).toEqual(["Mia", "Zoe", "Aaron"]);
  });
});

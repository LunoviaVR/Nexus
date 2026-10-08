import { parseLocation } from "./location";
import { sortByName } from "./format";
import type { VrcUser } from "./types";

export type Bucket = "favorites" | "ingame" | "web" | "offline";

export function bucketOf(f: VrcUser): Exclude<Bucket, "favorites"> {
  if (f.state === "online") return "ingame";
  if (f.state === "active") return "web";
  return "offline";
}

export interface InstanceGroup {
  /** Location key without nonce-ish tags so friends in the same instance group together. */
  key: string;
  location: string;
  worldName?: string;
  friends: VrcUser[];
}

/** Online friends grouped by the instance they're in, busiest instances first. */
export function groupByInstance(friends: VrcUser[]): { groups: InstanceGroup[]; elsewhere: VrcUser[] } {
  const map = new Map<string, InstanceGroup>();
  const elsewhere: VrcUser[] = [];
  for (const f of friends) {
    if (f.state !== "online") continue;
    const p = parseLocation(f.location);
    if (p.kind !== "instance") {
      elsewhere.push(f);
      continue;
    }
    const key = `${p.worldId}:${p.name}`;
    const g = map.get(key) ?? { key, location: f.location!, worldName: f.$worldName, friends: [] };
    g.friends.push(f);
    g.worldName ??= f.$worldName;
    map.set(key, g);
  }
  const groups = [...map.values()];
  for (const g of groups) g.friends.sort(sortByName);
  groups.sort((a, b) => b.friends.length - a.friends.length || (a.worldName ?? "").localeCompare(b.worldName ?? ""));
  elsewhere.sort(sortByName);
  return { groups, elsewhere };
}

export function matches(f: VrcUser, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    f.displayName.toLowerCase().includes(s) ||
    (f.statusDescription ?? "").toLowerCase().includes(s) ||
    (f.$worldName ?? "").toLowerCase().includes(s)
  );
}

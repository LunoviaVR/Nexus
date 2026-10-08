export type AccessType =
  | "public"
  | "friends+"
  | "friends"
  | "invite+"
  | "invite"
  | "group"
  | "group+"
  | "group public";

export interface ParsedLocation {
  raw: string;
  kind: "instance" | "offline" | "private" | "traveling";
  worldId?: string;
  instanceId?: string;
  /** The instance number/name before the first `~`. */
  name?: string;
  access?: AccessType;
  region?: string;
  ownerId?: string;
  groupId?: string;
}

const TAG = /^([a-zA-Z]+)(?:\(([^)]*)\))?$/;

export function parseLocation(raw?: string | null): ParsedLocation {
  const loc = (raw ?? "").trim();
  if (!loc || loc === "offline") return { raw: loc, kind: "offline" };
  if (loc === "private") return { raw: loc, kind: "private" };
  if (loc === "traveling" || loc.startsWith("traveling:")) return { raw: loc, kind: "traveling" };
  if (!loc.startsWith("wrld_")) return { raw: loc, kind: "offline" };

  const colon = loc.indexOf(":");
  if (colon < 0) return { raw: loc, kind: "instance", worldId: loc };
  const worldId = loc.slice(0, colon);
  const instanceId = loc.slice(colon + 1);
  const [name, ...tags] = instanceId.split("~");
  const out: ParsedLocation = { raw: loc, kind: "instance", worldId, instanceId, name, access: "public" };

  let canRequestInvite = false;
  let groupAccess: string | undefined;
  for (const tag of tags) {
    const m = TAG.exec(tag);
    if (!m) continue;
    const [, key, value] = m;
    switch (key) {
      case "hidden":
        out.access = "friends+";
        out.ownerId = value;
        break;
      case "friends":
        out.access = "friends";
        out.ownerId = value;
        break;
      case "private":
        out.access = "invite";
        out.ownerId = value;
        break;
      case "canRequestInvite":
        canRequestInvite = true;
        break;
      case "group":
        out.groupId = value;
        out.access = "group";
        break;
      case "groupAccessType":
        groupAccess = value;
        break;
      case "region":
        out.region = value;
        break;
    }
  }
  if (out.access === "invite" && canRequestInvite) out.access = "invite+";
  if (out.groupId) {
    out.access = groupAccess === "public" ? "group public" : groupAccess === "plus" ? "group+" : "group";
  }
  if (!out.region) out.region = "us";
  return out;
}

export const ACCESS_LABEL: Record<AccessType, string> = {
  public: "Public",
  "friends+": "Friends+",
  friends: "Friends",
  "invite+": "Invite+",
  invite: "Invite",
  group: "Group",
  "group+": "Group+",
  "group public": "Group Public",
};

export const REGION_LABEL: Record<string, string> = {
  us: "US West",
  use: "US East",
  eu: "Europe",
  jp: "Japan",
};

/** Instances you can just walk into (no invite needed). */
export function isJoinable(p: ParsedLocation): boolean {
  return p.kind === "instance" && !!p.access && !["invite", "invite+", "group"].includes(p.access);
}

export function sameInstance(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.split("~")[0] === b.split("~")[0];
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict } from "date-fns";
import type { FriendState, Status, VrcUser } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function duration(ms: number, opts: { seconds?: boolean } = {}): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0 || !opts.seconds) return `${m}m`;
  return `${s % 60}s`;
}

export function hours(ms: number): string {
  const h = ms / 3_600_000;
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

export function ago(ts?: number | string | null): string {
  if (!ts) return "";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function userImage(u?: Partial<VrcUser> | null, big = false): string | undefined {
  if (!u) return undefined;
  if (big) return u.profilePicOverride || u.currentAvatarImageUrl || u.iconUrl || u.userIcon || u.imageUrl || undefined;
  return (
    u.iconUrl ||
    u.userIcon ||
    u.profilePicOverrideThumbnail ||
    u.profilePicOverride ||
    u.currentAvatarThumbnailImageUrl ||
    u.imageUrl ||
    undefined
  );
}

const AUTH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(vrchat\.cloud|vrchat\.com)\//i;
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** VRChat file URLs need the session cookie, so route them through the backend's `nximg` protocol. */
export function imgSrc(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (IN_TAURI && AUTH_HOSTS.test(url)) return `http://nximg.localhost/?u=${encodeURIComponent(url)}`;
  return url;
}

export const STATUS_LABEL: Record<Status, string> = {
  "join me": "Join Me",
  active: "Online",
  "ask me": "Ask Me",
  busy: "Do Not Disturb",
  offline: "Offline",
};

export const STATUS_COLOR: Record<Status, string> = {
  "join me": "bg-st-join",
  active: "bg-st-active",
  "ask me": "bg-st-ask",
  busy: "bg-st-busy",
  offline: "bg-st-offline",
};

/** Effective presence color: in-game uses the status, web-only gets its own tint. */
export function presenceColor(state?: FriendState, status?: Status): string {
  if (state === "offline" || !state) return STATUS_COLOR.offline;
  if (state === "active") return "bg-st-web";
  return STATUS_COLOR[status ?? "active"] ?? STATUS_COLOR.active;
}

export interface Trust {
  label: string;
  color: string;
}

export function trustRank(tags: string[] = []): Trust {
  if (tags.includes("admin_moderator")) return { label: "VRChat Team", color: "text-red-400" };
  if (tags.includes("system_troll") || tags.includes("system_probable_troll"))
    return { label: "Nuisance", color: "text-zinc-400" };
  if (tags.includes("system_trust_veteran")) return { label: "Trusted User", color: "text-violet-400" };
  if (tags.includes("system_trust_trusted")) return { label: "Known User", color: "text-orange-400" };
  if (tags.includes("system_trust_known")) return { label: "User", color: "text-emerald-400" };
  if (tags.includes("system_trust_basic")) return { label: "New User", color: "text-sky-400" };
  return { label: "Visitor", color: "text-zinc-400" };
}

export function platformLabel(p?: string): string | undefined {
  switch (p) {
    case "standalonewindows":
      return "PC";
    case "android":
      return "Android";
    case "ios":
      return "iOS";
    case "web":
      return "Web";
    default:
      return undefined;
  }
}

export function sortByName<T extends { displayName: string }>(a: T, b: T) {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

import { parseMarkdown, type Block } from "./markdown";

export interface Release {
  version: string;
  blocks: Block[];
}

/** Compare dotted version numbers ("1.0.10" > "1.0.9"). Anything after a dash is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/i, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * One release's notes as shown inside Nexus. The "# Nexus x.y.z" title is shown separately, and
 * the "Updating" section (how to install it) doesn't apply to a version you're already running.
 */
export function releaseFromMarkdown(version: string, md: string): Release {
  const out: Block[] = [];
  let skipping = false;
  for (const b of parseMarkdown(md)) {
    if (b.t === "h" && b.level === 1) continue;
    if (b.t === "h" && b.level <= 2) skipping = /\bupdating\b/i.test(b.text);
    if (!skipping) out.push(b);
  }
  while (out.length && out[out.length - 1].t === "hr") out.pop();
  return { version, blocks: out };
}

// docs/releases/vX.Y.Z.md, the same notes published on GitHub, bundled so they read offline.
const FILES = import.meta.glob<string>("/docs/releases/v*.md", { query: "?raw", import: "default", eager: true });

/** Every release, newest first. */
export const RELEASES: Release[] = Object.entries(FILES)
  .map(([path, md]) => releaseFromMarkdown(path.replace(/^.*\/v(.+)\.md$/, "$1"), md))
  .sort((a, b) => compareVersions(b.version, a.version));

/** Releases up to the running version; notes drafted for the next one stay hidden until it ships. */
export function releasesUpTo(current: string | undefined, all: Release[] = RELEASES): Release[] {
  return current ? all.filter((r) => compareVersions(r.version, current) <= 0) : all;
}

/**
 * The releases to greet someone with after an update: everything newer than the version they last
 * ran, up to the one running now. Nothing on a fresh install or a downgrade.
 * `ranBefore` covers updating from a version older than this feature, which never saved `seen`.
 */
export function whatsNew(seen: string | null, current: string, ranBefore: boolean, all: Release[] = RELEASES): Release[] {
  if (!current || seen === current) return [];
  if (!seen) return ranBefore ? all.filter((r) => r.version === current) : [];
  if (compareVersions(current, seen) <= 0) return [];
  return all.filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0);
}

const SEEN_KEY = "nexus-seen-version";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Read when this module loads, before anything this run saves its state: if Nexus's UI settings are
// already there, it has run on this PC before.
const RAN_BEFORE = stored("nexus-ui") !== null;

/** What's new since the last run, once: the running version is remembered as seen. */
export function takeWhatsNew(current: string): Release[] {
  const releases = whatsNew(stored(SEEN_KEY), current, RAN_BEFORE);
  try {
    localStorage.setItem(SEEN_KEY, current);
  } catch {
    // Without storage the splash can't be one-time, so don't show it at all.
    return [];
  }
  return releases;
}

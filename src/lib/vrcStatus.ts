import { useQuery } from "@tanstack/react-query";

/** VRChat's status page (Atlassian Statuspage). Its JSON API is public and allows any origin. */
export const STATUS_PAGE_URL = "https://status.vrchat.com";
const SUMMARY_URL = `${STATUS_PAGE_URL}/api/v2/summary.json`;

/** From fine to worst. */
export type StatusLevel = "ok" | "maintenance" | "minor" | "major" | "critical";
const RANK: StatusLevel[] = ["ok", "maintenance", "minor", "major", "critical"];

export const LEVEL_LABEL: Record<StatusLevel, string> = {
  ok: "Stable",
  maintenance: "Maintenance",
  minor: "Degraded",
  major: "Partial outage",
  critical: "Major outage",
};

const COMPONENT_LEVEL: Record<string, StatusLevel> = {
  operational: "ok",
  under_maintenance: "maintenance",
  degraded_performance: "minor",
  partial_outage: "major",
  major_outage: "critical",
};

const COMPONENT_LABEL: Record<string, string> = {
  under_maintenance: "Maintenance",
  degraded_performance: "Degraded",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
};

const INDICATOR_LEVEL: Record<string, StatusLevel> = {
  none: "ok",
  maintenance: "maintenance",
  minor: "minor",
  major: "major",
  critical: "critical",
};

/** The parts of Statuspage's summary.json we read. */
export interface StatusSummary {
  status: { indicator: string; description: string };
  components?: { name: string; status: string; group?: boolean }[];
  incidents?: { name: string; status: string; impact?: string }[];
  scheduled_maintenances?: { name: string; status: string; scheduled_for?: string }[];
}

export interface VrcStatus {
  level: StatusLevel;
  /** One word or two for the top bar: "Stable", "Degraded", … */
  label: string;
  /** Statuspage's own summary, e.g. "All Systems Operational". */
  description: string;
  /** Unresolved incidents, e.g. "Login issues · Investigating". */
  incidents: string[];
  /** Services not working normally, e.g. "Authentication / Login · Partial outage". */
  affected: string[];
  /** Maintenance going on now. */
  maintenance: string[];
}

const worst = (a: StatusLevel, b: StatusLevel) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);
const sentence = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Boil the summary down to one level: the page's own indicator, or a worse service if there is one. */
export function readSummary(s: StatusSummary): VrcStatus {
  let level = INDICATOR_LEVEL[s.status?.indicator] ?? "minor";
  const affected: string[] = [];
  for (const c of s.components ?? []) {
    const l = COMPONENT_LEVEL[c.status] ?? "ok";
    if (l === "ok") continue;
    level = worst(level, l);
    // A group's status just repeats its worst member; list the members.
    if (!c.group) affected.push(`${c.name} · ${COMPONENT_LABEL[c.status] ?? sentence(c.status)}`);
  }
  const incidents = (s.incidents ?? []).filter((i) => i.status !== "resolved" && i.status !== "postmortem").map((i) => `${i.name} · ${sentence(i.status)}`);
  const maintenance = (s.scheduled_maintenances ?? []).filter((m) => m.status === "in_progress" || m.status === "verifying").map((m) => m.name);
  if (incidents.length && level === "ok") level = "minor";
  if (maintenance.length && level === "ok") level = "maintenance";
  // The page's own summary, unless its indicator still says all is well while something isn't.
  const description =
    level === "ok" || s.status?.indicator !== "none"
      ? s.status?.description || LEVEL_LABEL[level]
      : level === "maintenance"
        ? "Maintenance in progress"
        : "Some services aren't working normally";
  return { level, label: LEVEL_LABEL[level], description, incidents, affected, maintenance };
}

/** VRChat's service status, checked every minute while Nexus is on screen. */
export function useVrcStatus() {
  return useQuery({
    queryKey: ["vrchat-status"],
    queryFn: async ({ signal }) => {
      const res = await fetch(SUMMARY_URL, { signal, cache: "no-store" });
      if (!res.ok) throw new Error(`status.vrchat.com answered ${res.status}`);
      return readSummary(await res.json());
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: 10_000,
  });
}

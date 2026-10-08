import { ArrowRight, ChevronDown, GitCommitHorizontal, LogIn, LogOut, MapPin, MessageSquare, Shirt, UserMinus, UserPlus, FileText } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { diffStats, lineDiff, type DiffLine } from "@/lib/diff";
import { clock, cn, STATUS_COLOR, STATUS_LABEL } from "@/lib/format";
import type { FeedEntry, Status } from "@/lib/types";
import { useUi } from "@/stores/ui";
import { LocationLabel } from "./people";
import { Img } from "./ui";

export const FEED_META: Record<FeedEntry["kind"], { label: string; icon: ReactNode; tone: string }> = {
  online: { label: "Online", icon: <LogIn className="size-3.5" />, tone: "text-st-active bg-st-active/12" },
  offline: { label: "Offline", icon: <LogOut className="size-3.5" />, tone: "text-subtle bg-hover" },
  gps: { label: "Location", icon: <MapPin className="size-3.5" />, tone: "text-sky-400 bg-sky-500/12" },
  status: { label: "Status", icon: <MessageSquare className="size-3.5" />, tone: "text-amber-400 bg-amber-500/12" },
  avatar: { label: "Avatar", icon: <Shirt className="size-3.5" />, tone: "text-fuchsia-400 bg-fuchsia-500/12" },
  bio: { label: "Bio", icon: <FileText className="size-3.5" />, tone: "text-teal-400 bg-teal-500/12" },
  friend: { label: "Friend", icon: <UserPlus className="size-3.5" />, tone: "text-emerald-400 bg-emerald-500/12" },
  unfriend: { label: "Unfriend", icon: <UserMinus className="size-3.5" />, tone: "text-rose-400 bg-rose-500/12" },
};

function parseStatus(s?: string | null): { status?: Status; description?: string } {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function statusText(raw?: string | null): string {
  const s = parseStatus(raw);
  return [s.status ? STATUS_LABEL[s.status] : "", s.description ?? ""].filter((x, i) => i === 0 || x).join("\n");
}

/** GitHub-style "+3 −1" with the little five-square bar. */
function DiffStat({ added, removed }: { added: number; removed: number }) {
  const total = added + removed || 1;
  const greens = Math.round((added / total) * 5);
  const reds = Math.min(5 - greens, Math.round((removed / total) * 5));
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums">
      <span className="text-emerald-400">+{added}</span>
      <span className="text-rose-400">−{removed}</span>
      <span className="flex gap-px">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={cn("size-2 rounded-[1px]", i < greens ? "bg-emerald-500" : i < greens + reds ? "bg-rose-500" : "bg-hover")} />
        ))}
      </span>
    </span>
  );
}

/** Unified diff table, styled after GitHub's commit view. */
export function DiffView({ lines, title }: { lines: DiffLine[]; title: string }) {
  const stats = diffStats(lines);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2/60 px-3 py-1.5 text-xs">
        <GitCommitHorizontal className="size-3.5 text-subtle" />
        <span className="font-mono font-medium">{title}</span>
        <span className="ml-auto">
          <DiffStat {...stats} />
        </span>
      </div>
      <div className="selectable overflow-x-auto font-mono text-[12px] leading-[20px]">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "flex min-w-full",
              l.type === "add" && "bg-emerald-500/10",
              l.type === "del" && "bg-rose-500/10",
            )}
          >
            <span className="w-9 shrink-0 select-none pr-2 text-right text-subtle/70">{l.oldNo ?? ""}</span>
            <span className="w-9 shrink-0 select-none pr-2 text-right text-subtle/70">{l.newNo ?? ""}</span>
            <span
              className={cn(
                "w-5 shrink-0 select-none text-center",
                l.type === "add" ? "text-emerald-400" : l.type === "del" ? "text-rose-400" : "text-subtle",
              )}
            >
              {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
            </span>
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere] pr-3">
              {l.parts.map((p, j) => (
                <span
                  key={j}
                  className={cn(
                    p.changed && l.type === "add" && "rounded-sm bg-emerald-500/35",
                    p.changed && l.type === "del" && "rounded-sm bg-rose-500/35",
                  )}
                >
                  {p.text}
                </span>
              ))}
              {l.parts.every((p) => !p.text) && " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ raw }: { raw?: string | null }) {
  const s = parseStatus(raw);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {s.status && <span className={cn("size-2 shrink-0 rounded-full", STATUS_COLOR[s.status])} />}
      <span className="truncate">{s.description || (s.status ? STATUS_LABEL[s.status] : "")}</span>
    </span>
  );
}

function Detail({ e }: { e: FeedEntry }) {
  switch (e.kind) {
    case "gps":
    case "online":
      return e.location ? <LocationLabel location={e.location} worldName={e.worldName} /> : null;
    case "offline":
      return e.worldName ? <span className="text-subtle">was in {e.worldName}</span> : null;
    case "status":
      return (
        <span className="flex min-w-0 items-center gap-2 text-muted">
          <StatusPill raw={e.prev} />
          <ArrowRight className="size-3 shrink-0 text-subtle" />
          <span className="text-fg">
            <StatusPill raw={e.next} />
          </span>
        </span>
      );
    case "avatar":
      return (
        <span className="flex items-center gap-2">
          <Img src={e.prev} className="size-7 rounded opacity-60" />
          <ArrowRight className="size-3 text-subtle" />
          <Img src={e.next} className="size-7 rounded" />
        </span>
      );
    case "bio":
      return <span className="text-muted">{e.prev ? "updated their bio" : "added a bio"}</span>;
    case "friend":
      return <span className="text-muted">is now your friend</span>;
    case "unfriend":
      return <span className="text-muted">is no longer your friend</span>;
  }
}

export function FeedRow({ e, showName = true }: { e: FeedEntry; showName?: boolean }) {
  const openUser = useUi((s) => s.openUser);
  const meta = FEED_META[e.kind] ?? FEED_META.status;
  const diffable = e.kind === "bio" || e.kind === "status";
  const [open, setOpen] = useState(false);
  const lines = useMemo(
    () =>
      !diffable ? [] : e.kind === "bio" ? lineDiff(e.prev ?? "", e.next ?? "") : lineDiff(statusText(e.prev), statusText(e.next)),
    [diffable, e.kind, e.prev, e.next],
  );
  const stats = diffStats(lines);

  return (
    <div className="border-b border-line/60 last:border-0">
      <div
        role={diffable ? "button" : undefined}
        tabIndex={diffable ? 0 : undefined}
        aria-expanded={diffable ? open : undefined}
        onClick={diffable ? () => setOpen(!open) : undefined}
        onKeyDown={diffable ? (ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setOpen(!open)) : undefined}
        className={cn("flex min-h-11 items-center gap-3 px-3 py-1.5 text-[13px] hover:bg-hover/40", diffable && "cursor-pointer")}
      >
        <span className="w-16 shrink-0 whitespace-nowrap text-xs tabular-nums text-subtle" title={new Date(e.ts).toLocaleString()}>
          {clock(e.ts)}
        </span>
        <span className={cn("inline-flex w-[84px] shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", meta.tone)}>
          {meta.icon}
          {meta.label}
        </span>
        {showName && (
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              openUser(e.userId);
            }}
            className="max-w-[180px] shrink-0 truncate font-medium hover:text-accent cursor-pointer"
          >
            {e.displayName}
          </button>
        )}
        <div className="min-w-0 flex-1 truncate">
          <Detail e={e} />
        </div>
        {diffable && (
          <>
            <DiffStat {...stats} />
            <span className="hidden font-mono text-[11px] text-subtle sm:inline" title="Change id">
              {(e.id * 2654435761 >>> 0).toString(16).padStart(7, "0").slice(0, 7)}
            </span>
            <ChevronDown className={cn("size-4 shrink-0 text-subtle transition-transform", open && "rotate-180")} />
          </>
        )}
      </div>
      {diffable && open && (
        <div className="px-3 pb-3 sm:pl-[180px]">
          <DiffView lines={lines} title={e.kind === "bio" ? "bio" : "status"} />
        </div>
      )}
    </div>
  );
}

/** Insert day separators into a time-descending list. */
export function withDays<T extends { ts: number }>(items: T[]): ({ day: string } | T)[] {
  const out: ({ day: string } | T)[] = [];
  let last = "";
  for (const it of items) {
    const d = new Date(it.ts);
    const key = d.toDateString();
    if (key !== last) {
      last = key;
      const today = new Date().toDateString();
      const yest = new Date(Date.now() - 86_400_000).toDateString();
      out.push({ day: key === today ? "Today" : key === yest ? "Yesterday" : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) });
    }
    out.push(it);
  }
  return out;
}

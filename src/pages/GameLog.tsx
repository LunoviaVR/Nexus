import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, Clock, LogIn, LogOut, ScrollText, Search, Shirt, Users, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { withDays } from "@/components/FeedRow";
import { InstanceBadge, UserAvatar } from "@/components/people";
import { Button, Card, Chip, Empty, Input, PageHeader, SectionTitle, Segmented, Skeleton } from "@/components/ui";
import { clock, cn, dateTime, duration } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { useWorldName } from "@/lib/queries";
import type { GlEvent, GlSession, PresenceRow } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useNow } from "@/lib/useNow";
import { useFriends } from "@/stores/friends";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

type Tab = "sessions" | "events";

export function GameLog() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [q, setQ] = useState("");
  const focus = useUi((s) => s.gamelogFocus);
  // Arriving from a profile's encounter: show that session, unfiltered.
  useEffect(() => {
    if (focus != null) {
      setTab("sessions");
      setQ("");
    }
  }, [focus]);
  return (
    <div>
      <PageHeader title="Game Log" subtitle="Read from VRChat's own log files, so it works even when the API doesn't.">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "sessions", label: "Worlds visited" },
            { value: "events", label: "All events" },
          ]}
        />
      </PageHeader>
      <Input
        icon={<Search className="size-4" />}
        placeholder={tab === "sessions" ? "Search world or player" : "Search player, avatar or video"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-4 w-80"
      />
      {tab === "sessions" ? <Sessions search={q.trim()} focus={focus} /> : <Events search={q.trim()} />}
    </div>
  );
}

const EVENT_META: Record<GlEvent["kind"], { label: string; icon: ReactNode; tone: string }> = {
  join: { label: "Joined", icon: <LogIn className="size-3.5" />, tone: "text-st-active bg-st-active/12" },
  leave: { label: "Left", icon: <LogOut className="size-3.5" />, tone: "text-subtle bg-hover" },
  video: { label: "Video", icon: <Video className="size-3.5" />, tone: "text-rose-400 bg-rose-500/12" },
  avatar: { label: "Avatar", icon: <Shirt className="size-3.5" />, tone: "text-fuchsia-400 bg-fuchsia-500/12" },
};

interface SessionPlayer {
  userId?: string | null;
  displayName: string;
  totalMs: number;
  stints: { joinedTs: number; leftTs?: number | null }[];
}

/** One entry per person: rejoins are merged and their time summed. Still-open stints run to `end`. */
function mergePlayers(rows: PresenceRow[], end: number): SessionPlayer[] {
  const map = new Map<string, SessionPlayer>();
  for (const r of rows) {
    const key = r.userId || r.displayName;
    const p = map.get(key) ?? { userId: r.userId, displayName: r.displayName, totalMs: 0, stints: [] };
    p.userId ||= r.userId;
    p.displayName = r.displayName;
    p.stints.push({ joinedTs: r.joinedTs, leftTs: r.leftTs });
    p.totalMs += Math.max(0, (r.leftTs ?? end) - r.joinedTs);
    map.set(key, p);
  }
  return [...map.values()];
}

function SessionCard({ s, focused }: { s: GlSession; focused?: boolean }) {
  const [open, setOpen] = useState(!!focused);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focused]);
  const name = useWorldName(s.location, s.worldName);
  const byId = useFriends((st) => st.byId);
  const openWorld = useUi((st) => st.openWorld);
  const instance = useLive((st) => st.instance);
  const now = useNow(30_000);
  // The session you're in right now is still running; older ones end where the log says.
  const live = instance.location === s.location && instance.since === s.ts;
  const players = useMemo(() => mergePlayers(s.players, live ? now : s.ts + s.durationMs), [s, live, now]);
  const friends = players.filter((p) => p.userId && byId[p.userId]);

  return (
    <Card className={cn("overflow-hidden scroll-mt-4", focused && "border-accent ring-2 ring-accent-soft")}>
      <div ref={ref} />
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-hover/40 cursor-pointer">
        <div className="w-16 shrink-0 whitespace-nowrap text-xs tabular-nums text-subtle">{clock(s.ts)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              role="link"
              onClick={(e) => {
                e.stopPropagation();
                openWorld(s.worldId, s.location);
              }}
              className="truncate font-semibold hover:text-accent hover:underline"
            >
              {name ?? s.worldId}
            </span>
            <InstanceBadge location={s.location} />
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {duration(s.durationMs)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" /> {players.length} players
            </span>
            {friends.length > 0 && <span className="text-accent">{friends.length} friends</span>}
            {s.videos.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Video className="size-3" /> {s.videos.length}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={cn("size-4 text-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open && <SessionDetail players={players} videos={s.videos} live={live} />}
    </Card>
  );
}

type TimelineItem = { ts: number; kind: "join" | "leave" | "video"; name?: string; userId?: string | null; url?: string };

/** Who was there and what happened, as two tidy lists. */
function SessionDetail({ players, videos, live }: { players: SessionPlayer[]; videos: GlSession["videos"]; live: boolean }) {
  const byId = useFriends((st) => st.byId);
  const meId = useAuth((st) => st.user?.id);
  const openUser = useUi((st) => st.openUser);

  const sorted = [...players].sort((a, b) => a.stints[0].joinedTs - b.stints[0].joinedTs);
  const timeline: TimelineItem[] = [
    ...players.flatMap((p) =>
      p.stints.flatMap((st) => [
        { ts: st.joinedTs, kind: "join" as const, name: p.displayName, userId: p.userId },
        ...(st.leftTs ? [{ ts: st.leftTs, kind: "leave" as const, name: p.displayName, userId: p.userId }] : []),
      ]),
    ),
    ...videos.map((v) => ({ ts: v.ts, kind: "video" as const, url: v.url })),
  ].sort((a, b) => a.ts - b.ts);
  const span = (st: SessionPlayer["stints"][number]) => `${clock(st.joinedTs)} – ${st.leftTs ? clock(st.leftTs) : live ? "now" : "end"}`;

  return (
    <div className="grid gap-4 border-t border-line p-4 lg:grid-cols-2">
      <div className="min-w-0">
        <SectionTitle right={<span className="text-xs tabular-nums text-subtle">{players.length}</span>}>Players</SectionTitle>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-line/70">
          {sorted.map((p) => {
            const f = p.userId ? byId[p.userId] : undefined;
            const me = !!meId && p.userId === meId;
            return (
              <button
                key={p.userId || p.displayName}
                onClick={() => p.userId && openUser(p.userId)}
                disabled={!p.userId}
                title={p.stints.map(span).join("\n")}
                className="flex w-full items-center gap-3 border-b border-line/50 px-3 py-2 text-left last:border-0 enabled:hover:bg-hover/50 enabled:cursor-pointer"
              >
                {f ? (
                  <UserAvatar user={f} size={26} dot={false} />
                ) : (
                  <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-panel-2 text-[11px] font-semibold uppercase text-subtle">
                    {p.displayName.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1 leading-tight">
                  <div className={cn("truncate text-[13px] font-medium", f && "text-accent")}>
                    {p.displayName}
                    {me && <span className="ml-1.5 font-normal text-subtle">(you)</span>}
                  </div>
                  <div className="truncate text-[11px] tabular-nums text-subtle">
                    {p.stints.length > 1 ? `${p.stints.length} visits · first ${clock(p.stints[0].joinedTs)}` : span(p.stints[0])}
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted">{duration(p.totalMs)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0">
        <SectionTitle right={<span className="text-xs tabular-nums text-subtle">{timeline.length}</span>}>Timeline</SectionTitle>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-line/70">
          {timeline.map((e, i) => {
            const m = EVENT_META[e.kind];
            const f = e.userId ? byId[e.userId] : undefined;
            return (
              <div key={`${e.ts}-${e.kind}-${e.name ?? e.url}-${i}`} className="flex h-9 items-center gap-3 border-b border-line/50 px-3 text-[13px] last:border-0">
                <span className="w-16 shrink-0 whitespace-nowrap text-xs tabular-nums text-subtle">{clock(e.ts)}</span>
                <span className={cn("inline-flex w-[70px] shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", m.tone)}>
                  {m.icon}
                  {m.label}
                </span>
                {e.kind === "video" ? (
                  <button onClick={() => ipc.openExternal(e.url!)} title={e.url} className="min-w-0 flex-1 truncate text-left text-muted hover:text-accent cursor-pointer">
                    {e.url}
                  </button>
                ) : (
                  <button
                    onClick={() => e.userId && openUser(e.userId)}
                    disabled={!e.userId}
                    className={cn("min-w-0 truncate text-left font-medium enabled:hover:underline enabled:cursor-pointer", f && "text-accent")}
                  >
                    {e.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Sessions({ search, focus }: { search: string; focus: number | null }) {
  const openSession = useUi((s) => s.openSession);
  const query = useInfiniteQuery({
    queryKey: ["sessions", search, focus],
    queryFn: ({ pageParam }) => ipc.sessions({ search: search || undefined, before: pageParam, limit: 30 }),
    // Jumping to a session starts the list there; older sessions still load below it.
    initialPageParam: (focus != null ? focus + 1 : undefined) as number | undefined,
    getNextPageParam: (last) => (last.length === 30 ? last[last.length - 1].ts : undefined),
  });
  const sessions = query.data?.pages.flat() ?? [];

  if (query.isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (!sessions.length)
    return (
      <Card>
        <Empty
          icon={<ScrollText />}
          title="No worlds logged yet"
          hint="Launch VRChat and your visits will appear here. Logging must be enabled in VRChat's settings (it's on by default)."
        />
      </Card>
    );
  return (
    <div className="space-y-2">
      {focus != null && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2 text-[13px]">
          <span className="text-muted">
            Showing the session from <span className="font-medium text-fg">{dateTime(focus)}</span> and earlier.
          </span>
          <Button size="sm" variant="ghost" icon={<ArrowUp className="size-3.5" />} onClick={() => openSession(null)}>
            Show latest
          </Button>
        </div>
      )}
      {withDays(sessions).map((it) =>
        "day" in it ? (
          <div key={`d-${it.day}`} className="pt-3 text-xs font-semibold uppercase tracking-wider text-subtle first:pt-0">
            {it.day}
          </div>
        ) : (
          <SessionCard key={(it as GlSession).id} s={it as GlSession} focused={focus != null && (it as GlSession).ts === focus} />
        ),
      )}
      {query.hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}


function Events({ search }: { search: string }) {
  const [kinds, setKinds] = useState<Set<GlEvent["kind"]>>(new Set());
  const live = useLive((s) => s.gamelog);
  const byId = useFriends((s) => s.byId);
  const openUser = useUi((s) => s.openUser);
  const filter = { kinds: kinds.size ? [...kinds] : undefined, search: search || undefined };
  const query = useInfiniteQuery({
    queryKey: ["glevents", filter],
    queryFn: ({ pageParam }) => ipc.gamelogEvents({ ...filter, before: pageParam, limit: 150 }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === 150 ? last[last.length - 1].ts : undefined),
  });
  const events = useMemo(() => {
    const loaded = query.data?.pages.flat() ?? [];
    const newest = loaded[0]?.ts ?? 0;
    const fresh = live.filter((e) => e.ts > newest && (!filter.kinds || filter.kinds.includes(e.kind)) && !search);
    return [...fresh, ...loaded];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, live, kinds, search]);

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {(Object.keys(EVENT_META) as GlEvent["kind"][]).map((k) => (
          <Chip
            key={k}
            active={kinds.has(k)}
            onClick={() => {
              const n = new Set(kinds);
              if (n.has(k)) n.delete(k);
              else n.add(k);
              setKinds(n);
            }}
          >
            {EVENT_META[k].icon} {EVENT_META[k].label}
          </Chip>
        ))}
      </div>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <Skeleton className="m-3 h-40" />
        ) : events.length ? (
          withDays(events).map((it) =>
            "day" in it ? (
              <div key={`d-${it.day}`} className="border-b border-line bg-panel-2/40 px-3 py-1.5 text-xs font-semibold text-muted">
                {it.day}
              </div>
            ) : (
              (() => {
                const e = it as GlEvent;
                const m = EVENT_META[e.kind];
                const friend = e.userId ? byId[e.userId] : undefined;
                return (
                  <div key={e.id} className="flex h-10 items-center gap-3 border-b border-line/60 px-3 text-[13px] last:border-0">
                    <span className="w-16 shrink-0 whitespace-nowrap text-xs tabular-nums text-subtle">{clock(e.ts)}</span>
                    <span className={cn("inline-flex w-[76px] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", m.tone)}>
                      {m.icon}
                      {m.label}
                    </span>
                    {e.displayName && (
                      <button
                        onClick={() => e.userId && openUser(e.userId)}
                        className={cn("max-w-[200px] truncate font-medium hover:underline cursor-pointer", friend && "text-accent")}
                      >
                        {e.displayName}
                      </button>
                    )}
                    {e.kind === "video" && e.data ? (
                      <button onClick={() => ipc.openExternal(e.data!)} className="min-w-0 flex-1 truncate text-left text-muted hover:text-accent cursor-pointer">
                        {e.data}
                      </button>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-muted">{e.data}</span>
                    )}
                  </div>
                );
              })()
            ),
          )
        ) : (
          <Empty icon={<ScrollText />} title="No events" />
        )}
      </Card>
      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}

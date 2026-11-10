import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronRight, Gamepad2, Globe, MonitorSmartphone, Star, Users } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { FeedRow } from "@/components/FeedRow";
import { InstanceBadge, LocationLabel, PlayerRow, UserAvatar } from "@/components/people";
import { Card, Empty, SectionTitle, Img } from "@/components/ui";
import { duration, cn } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { parseLocation } from "@/lib/location";
import { useWorld } from "@/lib/queries";
import type { Player } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

function Tile({ icon, label, value, tone, onClick }: { icon: ReactNode; label: string; value: ReactNode; tone: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-accent/40 cursor-pointer">
      <div className={cn("flex size-10 items-center justify-center rounded-xl", tone)}>{icon}</div>
      <div>
        <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
        <div className="mt-1 text-xs text-muted">{label}</div>
      </div>
    </button>
  );
}

/** Rows per column on Home; the Players page has the full list. */
const GLANCE = 5;

function CurrentInstance() {
  const instance = useLive((s) => s.instance);
  const byId = useFriends((s) => s.byId);
  const meId = useAuth((s) => s.user?.id);
  const go = useUi((s) => s.go);
  const openWorld = useUi((s) => s.openWorld);
  const now = useNow(15_000);
  const p = parseLocation(instance.location);
  const world = useWorld(p.worldId);

  if (!instance.location) {
    return (
      <Card className="p-5">
        <SectionTitle>Right now</SectionTitle>
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-panel-2 text-subtle">
            <Gamepad2 className="size-6" />
          </div>
          <div>
            <p className="font-semibold">You're not in VRChat</p>
            <p className="text-[13px] text-muted">When you launch the game, your instance and the people around you will show up here.</p>
          </div>
        </div>
      </Card>
    );
  }

  // Newest arrivals first: at a glance, who just showed up matters most.
  const players = [...instance.players].sort((a, b) => b.joinedTs - a.joinedTs);
  const isFriend = (pl: Player) => !!pl.userId && !!byId[pl.userId];
  const friends = players.filter(isFriend);
  const others = players.filter((pl) => !isFriend(pl));
  const hidden = Math.max(0, friends.length - GLANCE) + Math.max(0, others.length - GLANCE);
  const column = (title: string, list: Player[], empty: string) => (
    <div className="min-w-0">
      <div className="px-3 pt-2">
        <SectionTitle right={<span className="text-xs tabular-nums text-subtle">{list.length}</span>}>{title}</SectionTitle>
      </div>
      {list.length ? (
        list.slice(0, GLANCE).map((pl) => (
          <PlayerRow key={pl.displayName} pl={pl} friend={pl.userId ? byId[pl.userId] : undefined} me={!!meId && pl.userId === meId} now={now} />
        ))
      ) : (
        <p className="px-3 pb-3 text-[13px] text-subtle">{empty}</p>
      )}
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <div className="relative h-32">
        <Img src={world.data?.imageUrl} className="absolute inset-0 size-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/60 to-transparent" />
        <div className="absolute bottom-3 left-5 right-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/80">You're in</div>
            <button onClick={() => p.worldId && openWorld(p.worldId, instance.location)} className="block max-w-full truncate text-xl font-bold text-white drop-shadow hover:underline cursor-pointer">
              {instance.worldName ?? world.data?.name ?? "Unknown world"}
            </button>
            <div className="mt-1 flex items-center gap-2 text-xs text-white/80">
              <InstanceBadge location={instance.location} />#{p.name}
              {instance.since && <span>· {duration(now - instance.since)}</span>}
            </div>
          </div>
          <div className="flex shrink-0 gap-5 text-right text-white">
            <div>
              <div className="text-2xl font-bold tabular-nums">{players.length}</div>
              <div className="text-xs text-white/75">players</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{friends.length}</div>
              <div className="text-xs text-white/75">friends</div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-x-2 p-2 sm:grid-cols-2">
        {column("Friends", friends, "No friends here.")}
        {column("Everyone else", others, "Nobody else.")}
      </div>
      <button
        onClick={() => go("players")}
        className="flex w-full items-center justify-center gap-1 border-t border-line py-2.5 text-xs text-accent hover:bg-hover cursor-pointer"
      >
        {hidden > 0 ? `+${hidden} more · see everyone` : "Open Players"} <ChevronRight className="size-3.5" />
      </button>
    </Card>
  );
}

export function Home() {
  const user = useAuth((s) => s.user);
  const byId = useFriends((s) => s.byId);
  const favorites = useFriends((s) => s.favorites);
  const live = useLive((s) => s.feed);
  const go = useUi((s) => s.go);
  const openUser = useUi((s) => s.openUser);
  const recent = useQuery({ queryKey: ["feed", "home"], queryFn: () => ipc.feed({ limit: 12 }), staleTime: 0 });

  const stats = useMemo(() => {
    const all = Object.values(byId);
    return {
      ingame: all.filter((f) => f.state === "online").length,
      web: all.filter((f) => f.state === "active").length,
      favOnline: all.filter((f) => f.state !== "offline" && favorites.has(f.id)),
      total: all.length,
    };
  }, [byId, favorites]);

  const feed = useMemo(() => {
    const seen = new Set<number>();
    return [...live, ...(recent.data ?? [])].filter((e) => !seen.has(e.id) && seen.add(e.id)).slice(0, 12);
  }, [live, recent.data]);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}, {user?.displayName}
        </h1>
        <p className="text-[13px] text-muted">
          {stats.ingame} of your {stats.total} friends are in VRChat right now.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile icon={<Gamepad2 className="size-5" />} label="In game" value={stats.ingame} tone="bg-st-active/15 text-st-active" onClick={() => go("friends")} />
        <Tile icon={<MonitorSmartphone className="size-5" />} label="Active on web" value={stats.web} tone="bg-st-web/15 text-st-web" onClick={() => go("friends")} />
        <Tile icon={<Star className="size-5" />} label="Favorites online" value={stats.favOnline.length} tone="bg-amber-500/15 text-amber-400" onClick={() => go("friends")} />
        <Tile icon={<Users className="size-5" />} label="Friends" value={stats.total} tone="bg-accent-soft text-accent" onClick={() => go("friends")} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          <CurrentInstance />
          {stats.favOnline.length > 0 && (
            <Card className="p-4">
              <SectionTitle>Favorites online</SectionTitle>
              <div className="grid gap-1 sm:grid-cols-2">
                {stats.favOnline.map((f) => (
                  <button key={f.id} onClick={() => openUser(f.id)} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-hover cursor-pointer">
                    <UserAvatar user={f} size={32} />
                    <div className="min-w-0 text-[13px]">
                      <div className="truncate font-medium">{f.displayName}</div>
                      <div className="truncate text-xs text-muted">
                        {f.state === "online" ? <LocationLabel location={f.location} worldName={f.$worldName} compact /> : "Active on web"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-4">
            <SectionTitle>Recent activity</SectionTitle>
            <button onClick={() => go("feed")} className="mb-2 text-xs text-accent hover:underline cursor-pointer">
              View feed
            </button>
          </div>
          {feed.length ? (
            feed.map((e) => <FeedRow key={e.id} e={e} />)
          ) : (
            <Empty icon={<Activity />} title="Nothing yet" hint="Friend activity is recorded while Nexus is running." />
          )}
        </Card>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <Globe className="size-3" /> Tip: press <kbd className="rounded border border-line px-1">Ctrl K</kbd> to jump to anyone or anything.
      </p>
    </div>
  );
}

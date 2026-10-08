import { Gamepad2, LogOut, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { InstanceBadge, UserAvatar } from "@/components/people";
import { Card, Empty, Img, Input, PageHeader, SectionTitle, Segmented } from "@/components/ui";
import { clock, cn, duration } from "@/lib/format";
import { parseLocation } from "@/lib/location";
import { useWorld } from "@/lib/queries";
import { useNow } from "@/lib/useNow";
import type { Player, VrcUser } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

type Sort = "joined" | "name";

function PlayerRow({ pl, friend, me, now }: { pl: Player; friend?: VrcUser; me: boolean; now: number }) {
  const openUser = useUi((s) => s.openUser);
  return (
    <button
      onClick={() => pl.userId && openUser(pl.userId)}
      disabled={!pl.userId}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left enabled:hover:bg-hover enabled:cursor-pointer"
    >
      {friend ? (
        <UserAvatar user={friend} size={32} />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel-2 text-xs font-semibold uppercase text-subtle">
          {pl.displayName.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <div className={cn("truncate text-[13px] font-medium", friend && "text-accent")}>
          {pl.displayName}
          {me && <span className="ml-1.5 font-normal text-subtle">(you)</span>}
        </div>
        <div className="truncate text-[11.5px] text-muted">
          {friend ? friend.statusDescription || "Friend" : me ? "That's you" : "Not a friend"}
        </div>
      </div>
      <div className="shrink-0 text-right leading-tight">
        <div className="text-[12.5px] tabular-nums">{duration(now - pl.joinedTs)}</div>
        <div className="text-[11px] tabular-nums text-subtle">joined {clock(pl.joinedTs)}</div>
      </div>
    </button>
  );
}

/** Everyone in the instance you're in right now, read live from VRChat's log. */
export function Players() {
  const instance = useLive((s) => s.instance);
  const gamelog = useLive((s) => s.gamelog);
  const byId = useFriends((s) => s.byId);
  const meId = useAuth((s) => s.user?.id);
  const openWorld = useUi((s) => s.openWorld);
  const openUser = useUi((s) => s.openUser);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("joined");
  const now = useNow(15_000);
  const p = parseLocation(instance.location);
  const world = useWorld(p.worldId);

  const view = useMemo(() => {
    const s = q.trim().toLowerCase();
    const cmp =
      sort === "name"
        ? (a: Player, b: Player) => a.displayName.localeCompare(b.displayName)
        : (a: Player, b: Player) => a.joinedTs - b.joinedTs;
    const shown = instance.players.filter((pl) => !s || pl.displayName.toLowerCase().includes(s)).sort(cmp);
    const isFriend = (pl: Player) => !!pl.userId && !!byId[pl.userId];
    const present = new Set(instance.players.map((pl) => pl.displayName));
    // Only leaves seen since Nexus started; the log replay on launch doesn't feed this list.
    const left = new Map<string, (typeof gamelog)[number]>();
    for (const e of gamelog) {
      if (e.kind !== "leave" || e.location !== instance.location || e.ts < (instance.since ?? 0) || !e.displayName) continue;
      if (present.has(e.displayName) || left.has(e.displayName)) continue;
      if (s && !e.displayName.toLowerCase().includes(s)) continue;
      left.set(e.displayName, e);
    }
    return {
      friends: shown.filter(isFriend),
      others: shown.filter((pl) => !isFriend(pl)),
      left: [...left.values()],
      friendCount: instance.players.filter(isFriend).length,
    };
  }, [instance, gamelog, byId, q, sort]);

  if (!instance.location) {
    return (
      <div>
        <PageHeader title="Players" subtitle="Everyone in the instance you're in, read from VRChat's own log." />
        <Card>
          <Empty
            icon={<Gamepad2 />}
            title="You're not in VRChat"
            hint="Join a world and the people around you will show up here as they come and go."
          />
        </Card>
      </div>
    );
  }

  const row = (pl: Player) => (
    <PlayerRow key={pl.displayName} pl={pl} friend={pl.userId ? byId[pl.userId] : undefined} me={!!meId && pl.userId === meId} now={now} />
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Players" subtitle="Everyone in the instance you're in, read from VRChat's own log." />

      <Card className="overflow-hidden">
        <div className="relative h-28">
          <Img src={world.data?.imageUrl} className="absolute inset-0 size-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/60 to-transparent" />
          <div className="absolute bottom-3 left-5 right-5 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <button
                onClick={() => p.worldId && openWorld(p.worldId, instance.location)}
                className="block max-w-full truncate text-lg font-bold text-white drop-shadow hover:underline cursor-pointer"
              >
                {instance.worldName ?? world.data?.name ?? "Unknown world"}
              </button>
              <div className="mt-1 flex items-center gap-2 text-xs text-white/80">
                <InstanceBadge location={instance.location} />#{p.name}
                {instance.since && <span>· {duration(now - instance.since)}</span>}
              </div>
            </div>
            <div className="flex shrink-0 gap-5 text-right text-white">
              <div>
                <div className="text-2xl font-bold tabular-nums">{instance.players.length}</div>
                <div className="text-xs text-white/75">players</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums">{view.friendCount}</div>
                <div className="text-xs text-white/75">friends</div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Input icon={<Search className="size-4" />} placeholder="Filter players" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <Segmented<Sort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "joined", label: "Join order" },
            { value: "name", label: "Name" },
          ]}
          className="ml-auto"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-2">
          <div className="px-2 pt-2">
            <SectionTitle right={<span className="text-xs tabular-nums text-subtle">{view.friends.length}</span>}>Friends</SectionTitle>
          </div>
          {view.friends.length ? view.friends.map(row) : <p className="px-3 pb-3 text-[13px] text-subtle">No friends here{q && " match"}.</p>}
        </Card>
        <Card className="p-2">
          <div className="px-2 pt-2">
            <SectionTitle right={<span className="text-xs tabular-nums text-subtle">{view.others.length}</span>}>Everyone else</SectionTitle>
          </div>
          {view.others.length ? view.others.map(row) : <p className="px-3 pb-3 text-[13px] text-subtle">Nobody else{q && " matches"}.</p>}
        </Card>
      </div>

      {view.left.length > 0 && (
        <Card className="p-2">
          <div className="px-2 pt-2">
            <SectionTitle right={<span className="text-xs tabular-nums text-subtle">{view.left.length}</span>}>Recently left</SectionTitle>
          </div>
          <div className="grid xl:grid-cols-2">
            {view.left.map((e) => {
              const friend = e.userId ? byId[e.userId] : undefined;
              return (
                <button
                  key={e.id}
                  onClick={() => e.userId && openUser(e.userId)}
                  disabled={!e.userId}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left opacity-75 enabled:hover:bg-hover enabled:hover:opacity-100 enabled:cursor-pointer"
                >
                  {friend ? (
                    <UserAvatar user={friend} size={32} dot={false} />
                  ) : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel-2 text-xs font-semibold uppercase text-subtle">
                      {e.displayName!.slice(0, 1)}
                    </span>
                  )}
                  <div className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", friend && "text-accent")}>{e.displayName}</div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] tabular-nums text-subtle">
                    <LogOut className="size-3" /> left {clock(e.ts)}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <Users className="size-3" /> Updates live as people join and leave.
      </p>
    </div>
  );
}

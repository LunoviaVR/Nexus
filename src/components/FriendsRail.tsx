import { ChevronDown, LogIn, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { byRecent, groupByInstance, matches } from "@/lib/friends";
import { ago, cn, duration, sortByName, STATUS_LABEL } from "@/lib/format";
import { useWorldName } from "@/lib/queries";
import { useNow } from "@/lib/useNow";
import type { VrcUser } from "@/lib/types";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";
import { actions, InstanceBadge, LocationLabel, UserAvatar } from "./people";
import { IconButton } from "./ui";
import { RefreshButton } from "./RefreshButton";
import { ipc } from "@/lib/ipc";

function Row({ f, sub }: { f: VrcUser; sub?: ReactNode }) {
  const openUser = useUi((s) => s.openUser);
  return (
    <button
      onClick={() => openUser(f.id)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover cursor-pointer"
    >
      <UserAvatar user={f} size={30} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] font-medium">{f.displayName}</div>
        <div className="truncate text-[11.5px] text-muted">{sub ?? f.statusDescription}</div>
      </div>
    </button>
  );
}

function Group({ title, count, children, defaultOpen = true }: { title: string; count: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-subtle hover:text-muted cursor-pointer"
      >
        <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        {title}
        <span className="ml-auto tabular-nums">{count}</span>
      </button>
      {open && children}
    </div>
  );
}

function InstanceBlock({ location, worldName, friends, now }: { location: string; worldName?: string; friends: VrcUser[]; now: number }) {
  const name = useWorldName(location, worldName);
  const openWorld = useUi((s) => s.openWorld);
  const since = Math.min(...friends.map((f) => f.$locationAt ?? now));
  return (
    <div className="mx-1 mb-1.5 rounded-xl border border-line bg-panel">
      <div className="group flex items-center gap-2 px-2.5 pt-2">
        <button
          onClick={() => openWorld(location.split(":")[0], location)}
          className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold hover:text-accent cursor-pointer"
        >
          {name ?? "…"}
        </button>
        {actions.canJoin(location) && (
          <IconButton label="Join" className="size-6 opacity-0 group-hover:opacity-100" onClick={() => actions.join(location)}>
            <LogIn className="size-3.5" />
          </IconButton>
        )}
      </div>
      <div className="flex items-center gap-2 px-2.5 pb-1 text-[11px] text-subtle">
        <InstanceBadge location={location} />
        <span className="tabular-nums">{duration(now - since)}</span>
      </div>
      <div className="px-0.5 pb-1">
        {friends.map((f) => (
          <Row key={f.id} f={f} />
        ))}
      </div>
    </div>
  );
}

export function FriendsRail() {
  const byId = useFriends((s) => s.byId);
  const favorites = useFriends((s) => s.favorites);
  const [q, setQ] = useState("");
  const now = useNow(30_000);

  const layout = useUi((s) => s.friendsLayout);

  const view = useMemo(() => {
    const visible = Object.values(byId).filter(
      (f) => matches(f, q) && (f.state === "online" || (f.state === "active" && layout.showWeb) || (f.state === "offline" && layout.showOffline)),
    );
    const cmp = layout.sort === "recent" ? byRecent : sortByName;
    const sorted = (list: VrcUser[]) => [...list].sort(cmp);

    const favs = layout.favoritesFirst ? sorted(visible.filter((f) => favorites.has(f.id))) : [];
    // Favorites listed at the top aren't repeated below, except inside instance blocks (where they add context).
    const rest = layout.favoritesFirst ? visible.filter((f) => !favorites.has(f.id)) : visible;
    const online = visible.filter((f) => f.state === "online");
    return {
      favs,
      instance: layout.groupBy === "instance" ? groupByInstance(online) : null,
      byStatus:
        layout.groupBy === "status"
          ? (["join me", "active", "ask me", "busy"] as const).map((st) => ({
              status: st,
              friends: sorted(rest.filter((f) => f.state === "online" && (f.status ?? "active") === st)),
            }))
          : null,
      flat: layout.groupBy === "none" ? sorted(rest) : null,
      web: layout.groupBy === "none" ? [] : sorted(rest.filter((f) => f.state === "active")),
      offline: layout.groupBy === "none" ? [] : sorted(rest.filter((f) => f.state === "offline")),
      total: visible.length,
      onlineCount: online.length,
    };
  }, [byId, favorites, q, layout]);

  const sub = (f: VrcUser) =>
    f.state === "online" ? (
      <LocationLabel location={f.location} worldName={f.$worldName} compact />
    ) : f.state === "active" ? (
      f.statusDescription || "Active on web"
    ) : f.last_login ? (
      `Last seen ${ago(f.last_login)}`
    ) : (
      "Offline"
    );

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-line bg-panel/40">
      <div className="flex items-center gap-2 p-3 pb-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${view.total} friends`}
            className="h-8 w-full rounded-lg border border-line bg-panel-2 pl-8 pr-2 text-[13px] outline-none placeholder:text-subtle focus:border-accent"
          />
        </div>
        <RefreshButton cooldownKey="friends" noun="friends list" run={ipc.refreshFriends} invalidate={[]} />
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-3">
        <Group title="Favorites" count={view.favs.length}>
          {view.favs.map((f) => (
            <Row key={f.id} f={f} sub={sub(f)} />
          ))}
        </Group>
        {view.instance && (
          <>
            <Group title="In instances" count={view.instance.groups.reduce((n, g) => n + g.friends.length, 0)}>
              {view.instance.groups.map((g) => (
                <InstanceBlock key={g.key} location={g.location} worldName={g.worldName} friends={g.friends} now={now} />
              ))}
            </Group>
            <Group title="Private & traveling" count={view.instance.elsewhere.length}>
              {view.instance.elsewhere.map((f) => (
                <Row key={f.id} f={f} sub={<LocationLabel location={f.location} />} />
              ))}
            </Group>
          </>
        )}
        {view.byStatus?.map((g) => (
          <Group key={g.status} title={STATUS_LABEL[g.status]} count={g.friends.length}>
            {g.friends.map((f) => (
              <Row key={f.id} f={f} sub={sub(f)} />
            ))}
          </Group>
        ))}
        {view.flat && (
          <Group title="Friends" count={view.flat.length}>
            {view.flat.map((f) => (
              <Row key={f.id} f={f} sub={sub(f)} />
            ))}
          </Group>
        )}
        <Group title="Active on web" count={view.web.length} defaultOpen={false}>
          {view.web.map((f) => (
            <Row key={f.id} f={f} sub={sub(f)} />
          ))}
        </Group>
        <Group title="Offline" count={view.offline.length} defaultOpen={false}>
          {view.offline.map((f) => (
            <Row key={f.id} f={f} sub={sub(f)} />
          ))}
        </Group>
      </div>
    </aside>
  );
}

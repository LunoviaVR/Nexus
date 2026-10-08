import { useVirtualizer } from "@tanstack/react-virtual";
import { Compass, Search, Users } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { DiscoverPeopleDialog } from "@/components/DiscoverDialog";
import { FriendCard } from "@/components/FriendCard";
import { RefreshButton } from "@/components/RefreshButton";
import { Button, Chip, Empty, Input, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { bucketOf, byRecent, matches, type Bucket } from "@/lib/friends";
import { sortByName } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import type { VrcUser } from "@/lib/types";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";

type Sort = "name" | "recent";
type Item = { type: "header"; label: string; count: number } | { type: "row"; friends: VrcUser[] };

const SECTIONS: { key: Bucket; label: string }[] = [
  { key: "favorites", label: "Favorites" },
  { key: "ingame", label: "In game" },
  { key: "web", label: "Active on web" },
  { key: "offline", label: "Offline" },
];

const CARD_MIN = 300;
const GAP = 10;


function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function Friends() {
  const byId = useFriends((s) => s.byId);
  const favorites = useFriends((s) => s.favorites);
  const loaded = useFriends((s) => s.loaded);
  const [q, setQ] = useState("");
  const [discover, setDiscover] = useState(false);
  // Starts from the "Friends list" preferences in Settings.
  const layout = useUi((s) => s.friendsLayout);
  const [sort, setSort] = useState<Sort>(layout.sort);
  const [shown, setShown] = useState<Record<Bucket, boolean>>({
    favorites: layout.favoritesFirst,
    ingame: true,
    web: layout.showWeb,
    offline: layout.showOffline,
  });

  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const cols = Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP)));

  const sections = useMemo(() => {
    const all = Object.values(byId).filter((f) => matches(f, q));
    const cmp = sort === "name" ? sortByName : byRecent;
    const by: Record<Bucket, VrcUser[]> = { favorites: [], ingame: [], web: [], offline: [] };
    for (const f of all) {
      // With the Favorites section switched off, favorites go back to their usual section.
      if (shown.favorites && favorites.has(f.id) && f.state !== "offline") by.favorites.push(f);
      else by[bucketOf(f)].push(f);
    }
    for (const k of Object.keys(by) as Bucket[]) by[k].sort(cmp);
    return by;
  }, [byId, favorites, q, sort, shown.favorites]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const s of SECTIONS) {
      const list = sections[s.key];
      if (!shown[s.key] || !list.length) continue;
      out.push({ type: "header", label: s.label, count: list.length });
      for (let i = 0; i < list.length; i += cols) out.push({ type: "row", friends: list.slice(i, i + cols) });
    }
    return out;
  }, [sections, shown, cols]);

  const scrollEl = () => box.current?.closest("main") ?? null;
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: scrollEl,
    estimateSize: (i) => (items[i].type === "header" ? 40 : 76 + GAP),
    overscan: 6,
    scrollMargin: box.current?.offsetTop ?? 0,
  });
  useEffect(() => v.measure(), [cols, v]);

  const total = Object.keys(byId).length;
  return (
    <div>
      <PageHeader title="Friends" subtitle={`${sections.ingame.length + sections.favorites.filter((f) => f.state === "online").length} in game · ${total} total`}>
        <Segmented<Sort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "name", label: "A–Z" },
            { value: "recent", label: "Recent" },
          ]}
        />
        <RefreshButton cooldownKey="friends" noun="friends list" run={ipc.refreshFriends} invalidate={[]} />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input icon={<Search className="size-4" />} placeholder="Search name, status or world" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        {SECTIONS.map((s) => (
          <Chip key={s.key} active={shown[s.key]} onClick={() => setShown({ ...shown, [s.key]: !shown[s.key] })}>
            {s.label} <span className="tabular-nums text-subtle">{sections[s.key].length}</span>
          </Chip>
        ))}
        <Button size="sm" icon={<Compass className="size-3.5" />} onClick={() => setDiscover(true)} className="ml-auto h-8">
          Discover
        </Button>
      </div>
      <DiscoverPeopleDialog open={discover} onClose={() => setDiscover(false)} />

      {!loaded ? (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))` }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div ref={box} className="relative" style={{ height: v.getTotalSize() }}>
          {items.length === 0 &&
            (SECTIONS.some((s) => !shown[s.key] && sections[s.key].length) ? (
              // Matches exist, just in sections that are switched off.
              <Empty icon={<Users />} title="Your matches are in hidden sections">
                <Button size="sm" onClick={() => setShown({ favorites: true, ingame: true, web: true, offline: true })}>
                  Show all sections
                </Button>
              </Empty>
            ) : (
              <Empty icon={<Users />} title="No friends match" hint="Try a different search." />
            ))}
          {v.getVirtualItems().map((vi) => {
            const it = items[vi.index];
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                className="absolute left-0 right-0"
                style={{ transform: `translateY(${vi.start - v.options.scrollMargin}px)` }}
              >
                {it.type === "header" ? (
                  <div className="flex h-10 items-end pb-2 text-xs font-semibold uppercase tracking-wider text-subtle">
                    {it.label} <span className="ml-2 tabular-nums">{it.count}</span>
                  </div>
                ) : (
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP, paddingBottom: GAP }}>
                    {it.friends.map((f) => (
                      <FriendCard key={f.id} friend={f} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

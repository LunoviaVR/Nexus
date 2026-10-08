import { useInfiniteQuery } from "@tanstack/react-query";
import { Activity, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { FEED_META, FeedRow, withDays } from "@/components/FeedRow";
import { Button, Card, Chip, Empty, Input, PageHeader, Skeleton } from "@/components/ui";
import { ipc } from "@/lib/ipc";
import type { FeedEntry, FeedKind } from "@/lib/types";
import { useFriends } from "@/stores/friends";
import { useLive } from "@/stores/live";

const KINDS: FeedKind[] = ["gps", "online", "offline", "status", "avatar", "bio", "friend", "unfriend"];
const PAGE = 100;

export function Feed() {
  const [kinds, setKinds] = useState<Set<FeedKind>>(new Set());
  const [favOnly, setFavOnly] = useState(false);
  const [q, setQ] = useState("");
  const favorites = useFriends((s) => s.favorites);
  const live = useLive((s) => s.feed);

  const filter = useMemo(
    () => ({
      kinds: kinds.size ? [...kinds] : undefined,
      userIds: favOnly ? [...favorites] : undefined,
      search: q.trim() || undefined,
    }),
    [kinds, favOnly, favorites, q],
  );

  const query = useInfiniteQuery({
    queryKey: ["feed", filter],
    queryFn: ({ pageParam }) => ipc.feed({ ...filter, before: pageParam, limit: PAGE }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].ts : undefined),
  });

  // Merge live entries that arrived after the first page loaded and match the filters.
  const entries = useMemo(() => {
    const loaded = query.data?.pages.flat() ?? [];
    const newest = loaded[0]?.ts ?? 0;
    const s = q.trim().toLowerCase();
    const fresh = live.filter(
      (e) =>
        e.ts > newest &&
        (!filter.kinds || filter.kinds.includes(e.kind)) &&
        (!favOnly || favorites.has(e.userId)) &&
        (!s || e.displayName.toLowerCase().includes(s) || (e.worldName ?? "").toLowerCase().includes(s)),
    );
    return [...fresh, ...loaded];
  }, [query.data, live, filter, favOnly, favorites, q]);

  const toggle = (k: FeedKind) => {
    const n = new Set(kinds);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setKinds(n);
  };

  return (
    <div>
      <PageHeader title="Feed" subtitle="Everything your friends did while Nexus was watching." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input icon={<Search className="size-4" />} placeholder="Search name or world" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <Chip active={favOnly} onClick={() => setFavOnly(!favOnly)}>
          <Star className="size-3" /> Favorites
        </Chip>
        <span className="mx-1 h-5 w-px bg-line" />
        {KINDS.map((k) => (
          <Chip key={k} active={kinds.has(k)} onClick={() => toggle(k)}>
            {FEED_META[k].icon}
            {FEED_META[k].label}
          </Chip>
        ))}
      </div>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : entries.length ? (
          withDays(entries).map((it) =>
            "day" in it ? (
              <div key={`d-${it.day}`} className="sticky top-0 z-[1] border-b border-line bg-panel/95 px-3 py-1.5 text-xs font-semibold text-muted backdrop-blur">
                {it.day}
              </div>
            ) : (
              <FeedRow key={(it as FeedEntry).id} e={it as FeedEntry} />
            ),
          )
        ) : (
          <Empty icon={<Activity />} title="No activity found" hint="Feed entries are recorded while Nexus is running and connected." />
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

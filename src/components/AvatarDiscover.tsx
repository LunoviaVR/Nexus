import { useInfiniteQuery } from "@tanstack/react-query";
import { Compass, ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import type { DiscoverAvatar } from "@/lib/types";
import { useUi } from "@/stores/ui";
import { Button, Chip, Empty, Img, Input, Segmented, Skeleton } from "./ui";

type Mode = "any" | "name" | "author" | "tags";
type Platform = "pc" | "android" | "ios";
type MinPerf = "any" | "Medium" | "Good" | "Excellent";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "pc", label: "PC" },
  { id: "android", label: "Quest" },
  { id: "ios", label: "iOS" },
];

/** VRChat performance ranks, worst to best. */
const RANK: Record<string, number> = { VeryPoor: 0, Poor: 1, Medium: 2, Good: 3, Excellent: 4 };
const RATING_TONE: Record<string, string> = {
  Excellent: "text-emerald-400",
  Good: "text-lime-400",
  Medium: "text-yellow-400",
  Poor: "text-orange-400",
  VeryPoor: "text-rose-400",
};

const ratingFor = (a: DiscoverAvatar, p: Platform) =>
  p === "pc" ? a.performance?.pc_rating : p === "android" ? a.performance?.android_rating : a.performance?.ios_rating;

const allTags = (a: DiscoverAvatar) => [...(a.tags?.author_tags ?? []), ...(a.tags?.non_content_tags ?? [])];

export function AvatarDiscover() {
  const openAvatar = useUi((s) => s.openAvatar);
  const openUser = useUi((s) => s.openUser);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("any");
  const [platforms, setPlatforms] = useState<Set<Platform>>(new Set());
  const [minPerf, setMinPerf] = useState<MinPerf>("any");
  const [hideMature, setHideMature] = useState(true);
  const [impostorOnly, setImpostorOnly] = useState(false);

  // avtrDB can only target names server-side; author and tag modes narrow a free-text search here.
  const serverMode = mode === "name" ? "name" : "any";
  const results = useInfiniteQuery({
    queryKey: ["avatar-discover", query, serverMode],
    queryFn: ({ pageParam }) => ipc.discoverAvatars(query, serverMode, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.has_more ? all.length : undefined),
    enabled: query.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const loaded = useMemo(() => {
    const seen = new Set<string>();
    return (results.data?.pages.flatMap((p) => p.avatars) ?? []).filter((a) => !seen.has(a.vrc_id) && seen.add(a.vrc_id));
  }, [results.data]);

  const shown = useMemo(() => {
    const q = query.toLowerCase();
    const perfPlatforms: Platform[] = platforms.size ? [...platforms] : ["pc"];
    return loaded.filter((a) => {
      if (mode === "author" && !a.author.name.toLowerCase().includes(q)) return false;
      if (mode === "tags" && !allTags(a).some((t) => t.toLowerCase().includes(q))) return false;
      for (const p of platforms) if (!a.compatibility?.includes(p)) return false;
      if (minPerf !== "any" && perfPlatforms.some((p) => (RANK[ratingFor(a, p) ?? ""] ?? -1) < RANK[minPerf])) return false;
      if (hideMature && (a.explicit || (a.tags?.content_tags?.length ?? 0) > 0)) return false;
      if (impostorOnly && !a.performance?.has_impostor) return false;
      return true;
    });
  }, [loaded, query, mode, platforms, minPerf, hideMature, impostorOnly]);

  const togglePlatform = (p: Platform) => {
    const n = new Set(platforms);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    setPlatforms(n);
  };

  return (
    <div>
      <form
        className="mb-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input.trim());
        }}
      >
        <Input
          icon={<Search className="size-4" />}
          placeholder={mode === "author" ? "Creator name" : mode === "tags" ? "Tag, e.g. protogen" : "Search public avatars"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-72"
          autoFocus
        />
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "any", label: "Anything" },
            { value: "name", label: "Name" },
            { value: "author", label: "Author" },
            { value: "tags", label: "Tags" },
          ]}
        />
        <Button type="submit" variant="primary" disabled={!input.trim()}>
          Search
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {PLATFORMS.map((p) => (
          <Chip key={p.id} active={platforms.has(p.id)} onClick={() => togglePlatform(p.id)}>
            {p.label}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <Segmented<MinPerf>
          value={minPerf}
          onChange={setMinPerf}
          options={[
            { value: "any", label: "Any performance" },
            { value: "Medium", label: "Medium+" },
            { value: "Good", label: "Good+" },
            { value: "Excellent", label: "Excellent" },
          ]}
        />
        <span className="mx-1 h-5 w-px bg-line" />
        <Chip active={hideMature} onClick={() => setHideMature(!hideMature)}>
          Hide mature
        </Chip>
        <Chip active={impostorOnly} onClick={() => setImpostorOnly(!impostorOnly)}>
          Has impostor
        </Chip>
      </div>

      {!query ? (
        <Empty
          icon={<Compass />}
          title="Discover public avatars"
          hint="Search millions of public avatars by name, creator or tag, then filter by platform and performance."
        />
      ) : results.isLoading ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : results.error ? (
        <Empty icon={<Compass />} title="Search didn't work" hint={errorText(results.error)}>
          <Button onClick={() => results.refetch()}>Try again</Button>
        </Empty>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-muted">
            {shown.length} matching
            {shown.length !== loaded.length && <span className="text-subtle"> · {loaded.length} loaded before filters</span>}
          </p>
          {shown.length ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
              {shown.map((a) => (
                <div
                  key={a.vrc_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openAvatar(a.vrc_id)}
                  onKeyDown={(e) => e.key === "Enter" && openAvatar(a.vrc_id)}
                  title="View details"
                  className="group cursor-pointer overflow-hidden rounded-xl border border-line bg-panel transition-all hover:border-accent/40 hover:shadow-pop"
                >
                  <div className="relative aspect-[3/4] overflow-hidden bg-panel-2">
                    <Img src={a.image_url} className="size-full transition-transform duration-300 group-hover:scale-105" />
                    {a.performance?.has_impostor && (
                      <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">Impostor</span>
                    )}
                  </div>
                  <div className="space-y-1.5 p-3">
                    <div>
                      <div className="truncate text-[13px] font-semibold" title={a.name}>
                        {a.name}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openUser(a.author.vrc_id);
                        }}
                        className="block max-w-full truncate text-xs text-muted hover:text-accent cursor-pointer"
                      >
                        {a.author.name}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {PLATFORMS.filter((p) => a.compatibility?.includes(p.id)).map((p) => {
                        const r = ratingFor(a, p.id);
                        return (
                          <span key={p.id} title={r ? `${p.label}: ${r}` : p.label} className="rounded bg-panel-2 px-1.5 py-px text-[10.5px] font-semibold">
                            <span className="text-muted">{p.label}</span>
                            {r && <span className={cn("ml-1", RATING_TONE[r] ?? "text-subtle")}>{r === "VeryPoor" ? "V.Poor" : r}</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<Search />} title="Nothing matches these filters" hint="Load more results or loosen the filters." />
          )}
          {results.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => results.fetchNextPage()} loading={results.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <p className="mt-6 flex items-center gap-1.5 text-xs text-subtle">
        Results from
        <button onClick={() => ipc.openExternal("https://avtrdb.com")} className="inline-flex items-center gap-1 text-muted hover:text-accent cursor-pointer">
          avtrDB <ExternalLink className="size-3" />
        </button>
        , a community index of public avatars. Your VRChat login is never sent there.
      </p>
    </div>
  );
}

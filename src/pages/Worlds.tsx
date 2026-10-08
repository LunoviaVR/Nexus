import { useQuery } from "@tanstack/react-query";
import { Globe, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { GRID, WorldCard } from "@/components/Cards";
import { Empty, Input, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { errorText, ipc } from "@/lib/ipc";
import { parseLocation } from "@/lib/location";
import { useFriends } from "@/stores/friends";

type Kind = "popular" | "favorites" | "recent" | "mine";

export function Worlds() {
  const [kind, setKind] = useState<Kind>("popular");
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const byId = useFriends((s) => s.byId);

  const list = useQuery({
    queryKey: ["worlds", submitted ? `search:${submitted}` : kind],
    queryFn: () => (submitted ? ipc.searchWorlds(submitted) : ipc.worlds(kind)),
    staleTime: 5 * 60_000,
  });

  const friendsIn = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of Object.values(byId)) {
      const w = f.state === "online" ? parseLocation(f.location).worldId : undefined;
      if (w) m[w] = (m[w] ?? 0) + 1;
    }
    return m;
  }, [byId]);

  return (
    <div>
      <PageHeader title="Worlds">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
        >
          <Input
            icon={<Search className="size-4" />}
            placeholder="Search VRChat worlds"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (!e.target.value) setSubmitted("");
            }}
            className="w-72"
          />
        </form>
        <Segmented<Kind>
          value={submitted ? ("" as Kind) : kind}
          onChange={(k) => {
            setKind(k);
            setSubmitted("");
            setQ("");
          }}
          options={[
            { value: "popular", label: "Popular" },
            { value: "recent", label: "Recent" },
            { value: "favorites", label: "Favorites" },
            { value: "mine", label: "Mine" },
          ]}
        />
      </PageHeader>
      {list.isLoading ? (
        <div className={GRID}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/4] rounded-xl" />
          ))}
        </div>
      ) : list.error ? (
        <Empty icon={<Globe />} title="Couldn't load worlds" hint={errorText(list.error)} />
      ) : list.data?.length ? (
        <div className={GRID}>
          {list.data.map((w) => (
            <WorldCard key={w.id} w={w} friendsHere={friendsIn[w.id]} />
          ))}
        </div>
      ) : (
        <Empty icon={<Globe />} title="No worlds here yet" />
      )}
    </div>
  );
}

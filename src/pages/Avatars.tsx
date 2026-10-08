import { useQuery } from "@tanstack/react-query";
import { Search, Shirt } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AvatarCard, GRID } from "@/components/Cards";
import { AvatarDiscover } from "@/components/AvatarDiscover";
import { Chip, Empty, Input, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { errorText, ipc } from "@/lib/ipc";
import type { Avatar } from "@/lib/types";

/** "mine" for your uploads, otherwise a favorite list tag such as "avatars1". */
type ListId = "mine" | string;
type Sort = "alpha" | "updated";

function MyAvatars() {
  const lists = useQuery({ queryKey: ["avatar-lists"], queryFn: ipc.avatarLists, staleTime: 10 * 60_000 });
  const [list, setList] = useState<ListId | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [busy, setBusy] = useState<string | null>(null);

  // Default to your first favorite list once the lists arrive.
  useEffect(() => {
    if (list === null && lists.data) setList(lists.data[0]?.name ?? "mine");
    if (list === null && lists.error) setList("mine");
  }, [list, lists.data, lists.error]);

  const avatars = useQuery({
    queryKey: ["avatars", list],
    queryFn: () => (list === "mine" ? ipc.avatars("mine") : ipc.avatars("favorites", list!)),
    enabled: list !== null,
    staleTime: 5 * 60_000,
  });

  const select = async (a: Avatar) => {
    setBusy(a.id);
    try {
      await ipc.selectAvatar(a.id);
      toast.success(`Switched to ${a.name}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const s = q.trim().toLowerCase();
  const time = (v?: string) => Date.parse(v ?? "") || 0;
  const shown = (avatars.data ?? [])
    .filter((a) => !s || a.name.toLowerCase().includes(s) || a.authorName.toLowerCase().includes(s))
    .sort((a, b) => (sort === "updated" ? time(b.updated_at) - time(a.updated_at) : a.name.localeCompare(b.name)));

  const sorted = [...(lists.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return (
    <div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {lists.isLoading ? (
          <Skeleton className="h-7 w-72 rounded-full" />
        ) : (
          sorted.map((g) => (
            <Chip key={g.name} active={list === g.name} onClick={() => setList(g.name)}>
              {g.displayName || g.name}
              {g.visibility && g.visibility !== "private" && <span className="text-subtle">· {g.visibility}</span>}
            </Chip>
          ))
        )}
        <span className="mx-1 h-5 w-px bg-line" />
        <Chip active={list === "mine"} onClick={() => setList("mine")}>
          Uploaded by me
        </Chip>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          icon={<Search className="size-4" />}
          placeholder={avatars.data ? `Search ${avatars.data.length} avatars` : "Search avatars"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64"
        />
        <Segmented<Sort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "updated", label: "Recently updated" },
            { value: "alpha", label: "A–Z" },
          ]}
        />
      </div>

      {avatars.isLoading || list === null ? (
        <div className={GRID}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : avatars.error ? (
        <Empty icon={<Shirt />} title="Couldn't load avatars" hint={errorText(avatars.error)} />
      ) : shown.length ? (
        <div className={GRID}>
          {shown.map((a) => (
            <AvatarCard key={a.id} a={a} busy={busy === a.id} onSelect={() => select(a)} />
          ))}
        </div>
      ) : (
        <Empty icon={<Shirt />} title={s ? "No avatars match" : "This list is empty"} />
      )}
    </div>
  );
}

type View = "mine" | "discover";

export function Avatars() {
  const [view, setView] = useState<View>("mine");
  return (
    <div>
      <PageHeader
        title="Avatars"
        subtitle={view === "mine" ? "Switching avatars here applies in-game the next time you load into a world." : "Find public avatars from creators across VRChat."}
      >
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "mine", label: "My avatars" },
            { value: "discover", label: "Discover" },
          ]}
        />
      </PageHeader>
      {view === "mine" ? <MyAvatars /> : <AvatarDiscover />}
    </div>
  );
}

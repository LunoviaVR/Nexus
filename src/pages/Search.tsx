import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { GRID, WorldCard } from "@/components/Cards";
import { TrustLabel, UserAvatar } from "@/components/people";
import { Empty, Input, PageHeader, SectionTitle, Skeleton } from "@/components/ui";
import { ipc } from "@/lib/ipc";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";

export function Search() {
  const query = useUi((s) => s.searchQuery);
  const search = useUi((s) => s.search);
  const openUser = useUi((s) => s.openUser);
  const byId = useFriends((s) => s.byId);
  const [q, setQ] = useState(query);
  useEffect(() => setQ(query), [query]);

  const users = useQuery({ queryKey: ["search-users", query], queryFn: () => ipc.searchUsers(query), enabled: !!query });
  const worlds = useQuery({ queryKey: ["search-worlds", query], queryFn: () => ipc.searchWorlds(query), enabled: !!query });

  return (
    <div>
      <PageHeader title="Search VRChat">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) search(q.trim());
          }}
        >
          <Input icon={<SearchIcon className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Users and worlds" className="w-80" autoFocus />
        </form>
      </PageHeader>
      {!query ? (
        <Empty icon={<SearchIcon />} title="Search for people and worlds" hint="Results come straight from VRChat." />
      ) : (
        <div className="space-y-6">
          <section>
            <SectionTitle>Users</SectionTitle>
            {users.isLoading ? (
              <Skeleton className="h-24 rounded-xl" />
            ) : users.data?.length ? (
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                {users.data.map((u) => {
                  const live = byId[u.id];
                  return (
                    <button
                      key={u.id}
                      onClick={() => openUser(u.id)}
                      className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left hover:border-accent/40 cursor-pointer"
                    >
                      <UserAvatar user={live ?? u} size={40} dot={!!live} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold">{u.displayName}</div>
                        <div className="flex items-center gap-2 text-xs">
                          <TrustLabel tags={u.tags} />
                          {live && <span className="text-accent">Friend</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Empty icon={<Users />} title="No users found" />
            )}
          </section>
          <section>
            <SectionTitle>Worlds</SectionTitle>
            {worlds.isLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : worlds.data?.length ? (
              <div className={GRID}>
                {worlds.data.map((w) => (
                  <WorldCard key={w.id} w={w} />
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-subtle">No worlds found.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

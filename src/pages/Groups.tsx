import { useQuery } from "@tanstack/react-query";
import { Compass, Group as GroupIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DiscoverGroupsDialog } from "@/components/DiscoverDialog";
import { Button, Empty, PageHeader, Skeleton } from "@/components/ui";
import { SortableGroups } from "@/components/UserDialog";
import { errorText, ipc } from "@/lib/ipc";
import { useAuth } from "@/stores/auth";

export function Groups() {
  const me = useAuth((s) => s.user);
  const mine = useQuery({ queryKey: ["groups", me?.id], queryFn: () => ipc.userGroups(me!.id), enabled: !!me, staleTime: 10 * 60_000 });
  const [discover, setDiscover] = useState(false);
  const myGroupIds = useMemo(() => new Set((mine.data ?? []).map((g) => g.groupId ?? g.id ?? "")), [mine.data]);
  const discoverButton = (
    <Button size="sm" icon={<Compass className="size-3.5" />} onClick={() => setDiscover(true)} className="h-8">
      Discover
    </Button>
  );

  return (
    <div>
      <PageHeader title="Groups" subtitle={mine.data ? `You're in ${mine.data.length} ${mine.data.length === 1 ? "group" : "groups"}.` : "Your VRChat groups."} />
      {mine.isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : mine.error ? (
        <Empty icon={<GroupIcon />} title="Couldn't load your groups" hint={errorText(mine.error)} />
      ) : mine.data?.length ? (
        <SortableGroups groups={mine.data} actions={discoverButton} />
      ) : (
        <Empty icon={<GroupIcon />} title="You're not in any groups yet" hint="Find some to join.">
          <Button variant="primary" icon={<Compass className="size-4" />} onClick={() => setDiscover(true)}>
            Discover groups
          </Button>
        </Empty>
      )}
      <DiscoverGroupsDialog open={discover} onClose={() => setDiscover(false)} myGroupIds={myGroupIds} />
    </div>
  );
}

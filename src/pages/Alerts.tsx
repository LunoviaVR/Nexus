import { ArrowLeft, BellOff, BellRing, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LocationLabel, UserAvatar } from "@/components/people";
import { Button, Card, Empty, IconButton, Input, PageHeader, SectionTitle } from "@/components/ui";
import { ago, duration } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import type { VrcUser } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";

function AlertRow({ id, friend, now }: { id: string; friend?: VrcUser; now: number }) {
  const openUser = useUi((s) => s.openUser);
  const setWatched = useFriends((s) => s.setWatched);
  const [busy, setBusy] = useState(false);
  const name = friend?.displayName ?? "Not on your friends list";
  const stop = async () => {
    setBusy(true);
    try {
      setWatched(await ipc.setWatch(id, false));
      toast.success(friend ? `Stopped alerts for ${friend.displayName}` : "Alert removed");
    } catch (e) {
      toast.error(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover">
      <button onClick={() => openUser(id)} className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer">
        <UserAvatar user={friend ?? { id }} size={36} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold">{name}</div>
          <div className="mt-0.5 truncate text-xs text-muted">
            {!friend ? (
              <span className="font-mono text-subtle">{id}</span>
            ) : friend.state === "online" ? (
              <LocationLabel location={friend.location} worldName={friend.$worldName} compact />
            ) : friend.state === "active" ? (
              <span className="text-st-web">Active on web</span>
            ) : (
              <span className="text-subtle">{friend.last_login ? `Last seen ${ago(friend.last_login)}` : "Offline"}</span>
            )}
          </div>
        </div>
        {friend?.state === "online" && friend.$onlineAt && (
          <span className="shrink-0 text-xs tabular-nums text-subtle">online {duration(now - friend.$onlineAt)}</span>
        )}
      </button>
      <IconButton label={`Stop alerts${friend ? ` for ${friend.displayName}` : ""}`} onClick={stop} disabled={busy}>
        <BellOff className="size-4" />
      </IconButton>
    </div>
  );
}

/** Everyone you've rung the bell for on their profile. */
export function Alerts() {
  const watched = useFriends((s) => s.watched);
  const byId = useFriends((s) => s.byId);
  const [q, setQ] = useState("");
  const now = useNow(30_000);
  const go = useUi((s) => s.go);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const ids = [...watched].filter((id) => !s || (byId[id]?.displayName ?? id).toLowerCase().includes(s));
    const byName = (a: string, b: string) =>
      (byId[a]?.displayName ?? "~").localeCompare(byId[b]?.displayName ?? "~", undefined, { sensitivity: "base" });
    const of = (pred: (f?: VrcUser) => boolean) => ids.filter((id) => pred(byId[id])).sort(byName);
    return [
      { title: "In game", ids: of((f) => f?.state === "online") },
      { title: "On the website", ids: of((f) => f?.state === "active") },
      { title: "Offline", ids: of((f) => !!f && f.state !== "online" && f.state !== "active") },
      { title: "No longer friends", ids: of((f) => !f) },
    ].filter((g) => g.ids.length);
  }, [watched, byId, q]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Friend Alerts"
        subtitle="Friends you've rung the bell for. You get a notification when they come online or go offline."
      >
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={() => go("settings")}>
          Back to Settings
        </Button>
      </PageHeader>

      {watched.size === 0 ? (
        <Card>
          <Empty
            icon={<BellRing />}
            title="No friend alerts yet"
            hint="Open a friend's profile and click the bell next to their name. They'll show up here."
          />
        </Card>
      ) : (
        <>
          <Input
            icon={<Search className="size-4" />}
            placeholder={`Filter ${watched.size} ${watched.size === 1 ? "friend" : "friends"}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-72"
          />
          {groups.length ? (
            groups.map((g) => (
              <Card key={g.title} className="p-2">
                <div className="px-2 pt-2">
                  <SectionTitle right={<span className="text-xs tabular-nums text-subtle">{g.ids.length}</span>}>{g.title}</SectionTitle>
                </div>
                {g.ids.map((id) => (
                  <AlertRow key={id} id={id} friend={byId[id]} now={now} />
                ))}
              </Card>
            ))
          ) : (
            <Card>
              <Empty icon={<Search />} title="Nobody matches" />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

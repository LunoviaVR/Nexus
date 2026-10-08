import { Copy, ExternalLink, Globe, Heart, LogIn, Send, Users, Eye, CalendarDays } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { errorText, ipc } from "@/lib/ipc";
import { parseLocation, REGION_LABEL } from "@/lib/location";
import { useInstance, useWorld } from "@/lib/queries";
import type { VrcUser } from "@/lib/types";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { FavoriteButton } from "./AvatarFavoriteButton";
import { RefreshButton } from "./RefreshButton";
import { ImageViewer } from "./ImageViewer";
import { fullSizeUrl } from "@/lib/image";
import { actions, InstanceBadge, UserAvatar } from "./people";
import { Badge, Button, Dialog, Empty, IconButton, Img, Segmented, Skeleton, Tip } from "./ui";

export function WorldDialog() {
  const worldId = useUi((s) => s.worldId);
  const location = useUi((s) => s.worldLocation);
  const openWorld = useUi((s) => s.openWorld);
  return (
    <Dialog open={!!worldId} onClose={() => openWorld(null)} title="World">
      {worldId && (
        <ErrorBoundary resetKey={worldId}>
          <WorldBody worldId={worldId} focus={location} />
        </ErrorBoundary>
      )}
    </Dialog>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <span className="text-subtle">{icon}</span>
      {children}
    </span>
  );
}

interface Row {
  location: string;
  count?: number;
  friends: VrcUser[];
}

function InstanceRow({ row, focus }: { row: Row; focus: boolean }) {
  const p = parseLocation(row.location);
  const inst = useInstance(focus ? row.location : null);
  const openUser = useUi((s) => s.openUser);
  const count = inst.data?.n_users ?? inst.data?.userCount ?? row.count;
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${focus ? "border-accent/60 bg-accent-soft" : "border-line bg-panel-2/40"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-semibold">#{inst.data?.displayName ?? p.name}</span>
          <InstanceBadge location={row.location} />
          {p.region && <span className="text-xs text-subtle">{REGION_LABEL[p.region] ?? p.region}</span>}
          {count != null && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Users className="size-3" /> {count}
              {inst.data?.capacity ? `/${inst.data.capacity}` : ""}
            </span>
          )}
        </div>
        {row.friends.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {row.friends.map((f) => (
              <Tip key={f.id} label={f.displayName}>
                <button onClick={() => openUser(f.id)} className="cursor-pointer">
                  <UserAvatar user={f} size={24} dot={false} />
                </button>
              </Tip>
            ))}
            <span className="ml-1 text-xs text-muted">
              {row.friends.length === 1 ? row.friends[0].displayName : `${row.friends.length} friends`}
            </span>
          </div>
        )}
      </div>
      <IconButton label="Invite me" onClick={() => actions.selfInvite(row.location)}>
        <Send className="size-4" />
      </IconButton>
      <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => actions.join(row.location)}>
        Join
      </Button>
    </div>
  );
}

function WorldBody({ worldId, focus }: { worldId: string; focus: string | null }) {
  const openUser = useUi((s) => s.openUser);
  const { data: w, isLoading, error } = useWorld(worldId);
  const byId = useFriends((s) => s.byId);
  const [tab, setTab] = useState<"instances" | "about">("instances");
  const [viewing, setViewing] = useState<number | null>(null);

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    const keyOf = (loc: string) => loc.split("~")[0];
    if (focus) map.set(keyOf(focus), { location: focus, friends: [] });
    for (const f of Object.values(byId)) {
      if (f.state !== "online" || !f.location?.startsWith(worldId + ":")) continue;
      const k = keyOf(f.location);
      const r = map.get(k) ?? { location: f.location, friends: [] };
      r.friends.push(f);
      map.set(k, r);
    }
    for (const [instanceId, count] of w?.instances ?? []) {
      const loc = `${worldId}:${instanceId}`;
      const k = keyOf(loc);
      const r = map.get(k) ?? { location: loc, friends: [] };
      r.count = count;
      map.set(k, r);
    }
    return [...map.values()].sort(
      (a, b) =>
        Number(!!focus && keyOf(b.location) === keyOf(focus)) - Number(!!focus && keyOf(a.location) === keyOf(focus)) ||
        b.friends.length - a.friends.length ||
        (b.count ?? 0) - (a.count ?? 0),
    );
  }, [byId, w, worldId, focus]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  }
  if (!w) return <Empty icon={<Globe />} title="Couldn't load this world" hint={errorText(error)} />;

  return (
    <div className="flex max-h-[88vh] flex-col">
      <div className="relative aspect-[16/6] shrink-0 overflow-hidden">
        <button onClick={() => w.imageUrl && setViewing(0)} className="block size-full cursor-zoom-in" title="View image">
          <Img src={w.imageUrl} className="size-full" />
        </button>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-panel via-panel/30 to-transparent" />
        <div className="pointer-events-none absolute bottom-3 left-6 right-6">
          <h2 className="selectable text-2xl font-bold text-white drop-shadow">{w.name}</h2>
          <p className="text-[13px] text-white/80">
            by{" "}
            {w.authorId ? (
              <button
                onClick={() => openUser(w.authorId!, "worlds")}
                title={`See ${w.authorName}'s worlds`}
                className="pointer-events-auto font-medium text-white underline-offset-2 hover:underline cursor-pointer"
              >
                {w.authorName}
              </button>
            ) : (
              w.authorName
            )}
          </p>
        </div>
      </div>
      <ImageViewer
        images={w.imageUrl ? [{ src: fullSizeUrl(w.imageUrl)!, title: w.name, subtitle: `by ${w.authorName}`, fileName: w.name.replace(/[^\p{L}\p{N}_-]+/gu, "_") }] : []}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-6 pt-3">
        <Fact icon={<Users className="size-3.5" />}>
          {w.occupants ?? 0} online · cap {w.capacity}
        </Fact>
        <Fact icon={<Heart className="size-3.5" />}>{(w.favorites ?? 0).toLocaleString()}</Fact>
        <Fact icon={<Eye className="size-3.5" />}>{(w.visits ?? 0).toLocaleString()} visits</Fact>
        {w.updated_at && <Fact icon={<CalendarDays className="size-3.5" />}>Updated {new Date(w.updated_at).toLocaleDateString()}</Fact>}
        <div className="ml-auto flex items-center gap-1">
          <RefreshButton
            cooldownKey={w.id}
            noun="world"
            run={() => ipc.refreshEntity("world", w.id)}
            invalidate={[["world", w.id], ["instance"]]}
          />
          <div className="w-40">
            <FavoriteButton id={w.id} name={w.name} kinds={["world", "vrcPlusWorld"]} />
          </div>
          <IconButton label="Copy world ID" onClick={() => navigator.clipboard.writeText(w.id).then(() => toast.success("Copied world ID"))}>
            <Copy className="size-4" />
          </IconButton>
          <IconButton label="Open on vrchat.com" onClick={() => ipc.openExternal(`https://vrchat.com/home/world/${w.id}`)}>
            <ExternalLink className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="px-6 pt-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "instances", label: `Instances (${rows.length})` },
            { value: "about", label: "About" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        {tab === "instances" ? (
          rows.length ? (
            <div className="space-y-2">
              {rows.map((r) => (
                <InstanceRow key={r.location} row={r} focus={!!focus && r.location.split("~")[0] === focus.split("~")[0]} />
              ))}
            </div>
          ) : (
            <Empty icon={<Users />} title="No visible instances" hint="Nobody you know is here, and there are no public instances right now.">
              <Button
                variant="primary"
                icon={<LogIn className="size-4" />}
                onClick={() => ipc.launch(`${w.id}:${Math.floor(10000 + Math.random() * 89999)}`).catch((e) => toast.error(errorText(e)))}
              >
                Start a public instance
              </Button>
            </Empty>
          )
        ) : (
          <div className="space-y-3">
            {w.description && <p className="selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-relaxed text-muted">{w.description}</p>}
            <div className="flex flex-wrap gap-1.5">
              {(w.tags ?? [])
                .filter((t) => t.startsWith("author_tag_"))
                .map((t) => (
                  <Badge key={t}>{t.replace("author_tag_", "")}</Badge>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Lock, LogIn, Search, Send, ShieldAlert, Users, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { actions, UserAvatar } from "@/components/people";
import { RefreshButton } from "@/components/RefreshButton";
import { Chip, Empty, Img, Input, PageHeader, Segmented, Skeleton, Tip, Button } from "@/components/ui";
import { cn } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import { REGION_LABEL, sameInstance } from "@/lib/location";
import type { VrcGroup, VrcGroupInstance, VrcUser } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";

type Sort = "players" | "friends" | "world";
type Access = "public" | "plus" | "members";
type Platform = "any" | "pc" | "quest";

const ACCESS: Record<Access, { label: string; tone: string }> = {
  public: { label: "Group Public", tone: "text-emerald-400 bg-emerald-500/10" },
  plus: { label: "Group+", tone: "text-amber-400 bg-amber-500/10" },
  members: { label: "Members", tone: "text-rose-400 bg-rose-500/10" },
};

const REGIONS = ["us", "use", "eu", "jp"] as const;

const players = (i: VrcGroupInstance) => i.n_users ?? i.userCount ?? i.memberCount ?? 0;
const groupIdOf = (i: VrcGroupInstance) => i.ownerId ?? i.location.match(/group\((grp_[^)]+)\)/)?.[1] ?? "";
const accessOf = (i: VrcGroupInstance): string =>
  i.groupAccessType ?? i.location.match(/groupAccessType\(([^)]+)\)/)?.[1] ?? "members";
const regionOf = (i: VrcGroupInstance) => i.region ?? i.location.match(/region\(([^)]+)\)/)?.[1] ?? "us";

export function GroupInstances() {
  const me = useAuth((s) => s.user);
  const byId = useFriends((s) => s.byId);
  const instances = useQuery({ queryKey: ["my-group-instances"], queryFn: ipc.myGroupInstances, staleTime: 60_000 });
  const groups = useQuery({ queryKey: ["groups", me?.id], queryFn: () => ipc.userGroups(me!.id), enabled: !!me, staleTime: 10 * 60_000 });

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("players");
  const [group, setGroup] = useState<string>("all");
  const [access, setAccess] = useState<Set<Access>>(new Set());
  const [regions, setRegions] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState<Platform>("any");
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [hideFull, setHideFull] = useState(false);
  const [hideAgeGated, setHideAgeGated] = useState(false);

  const groupById = useMemo(() => {
    const m = new Map<string, VrcGroup>();
    for (const g of groups.data ?? []) m.set(g.groupId ?? g.id ?? "", g);
    return m;
  }, [groups.data]);

  // Friends per instance, matched on the instance part of the location (ignores nonce tags).
  const friendsIn = useMemo(() => {
    const m = new Map<string, VrcUser[]>();
    const online = Object.values(byId).filter((f) => f.state === "online" && f.location?.startsWith("wrld_"));
    for (const i of instances.data ?? []) m.set(i.location, online.filter((f) => sameInstance(f.location, i.location)));
    return m;
  }, [byId, instances.data]);

  const all = instances.data ?? [];
  const groupsWithInstances = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of all) counts.set(groupIdOf(i), (counts.get(groupIdOf(i)) ?? 0) + 1);
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n, name: groupById.get(id)?.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, groupById]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((i) => {
        const gid = groupIdOf(i);
        if (group !== "all" && gid !== group) return false;
        if (access.size && !access.has(accessOf(i) as Access)) return false;
        if (regions.size && !regions.has(regionOf(i))) return false;
        if (platform === "quest" && !(i.world?.unityPackages ?? []).some((p) => p.platform === "android")) return false;
        if (platform === "pc" && !(i.world?.unityPackages ?? []).some((p) => p.platform === "standalonewindows")) return false;
        if (friendsOnly && !friendsIn.get(i.location)?.length) return false;
        if (hideFull && (i.full || (i.capacity != null && players(i) >= i.capacity))) return false;
        if (hideAgeGated && i.ageGate) return false;
        if (!s) return true;
        return [i.world?.name, i.displayName, groupById.get(gid)?.name, i.world?.authorName]
          .filter(Boolean)
          .some((t) => t!.toLowerCase().includes(s));
      })
      .sort((a, b) => {
        if (sort === "world") return (a.world?.name ?? "").localeCompare(b.world?.name ?? "");
        if (sort === "friends")
          return (friendsIn.get(b.location)?.length ?? 0) - (friendsIn.get(a.location)?.length ?? 0) || players(b) - players(a);
        return players(b) - players(a);
      });
  }, [all, q, group, access, regions, platform, friendsOnly, hideFull, hideAgeGated, sort, friendsIn, groupById]);

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    apply(n);
  };
  const totalPlayers = shown.reduce((n, i) => n + players(i), 0);

  return (
    <div>
      <PageHeader
        title="Group Instances"
        subtitle={instances.data ? `${shown.length} of ${all.length} open instances · ${totalPlayers.toLocaleString()} players` : "Open instances in the groups you're in"}
      >
        <Segmented<Sort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "players", label: "Most players" },
            { value: "friends", label: "Friends first" },
            { value: "world", label: "World A–Z" },
          ]}
        />
        <RefreshButton
          cooldownKey="group-instances"
          noun="group instances"
          run={ipc.refreshMyGroupInstances}
          invalidate={[["my-group-instances"]]}
        />
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input icon={<Search className="size-4" />} placeholder="Search world, group or instance" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          aria-label="Group"
          className="h-9 max-w-60 rounded-lg border border-line bg-panel-2 px-2 text-[13px] outline-none focus:border-accent"
        >
          <option value="all">All groups ({groupsWithInstances.length})</option>
          {groupsWithInstances.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.n})
            </option>
          ))}
        </select>
        <Segmented<Platform>
          value={platform}
          onChange={setPlatform}
          options={[
            { value: "any", label: "Any platform" },
            { value: "pc", label: "PC" },
            { value: "quest", label: "Quest" },
          ]}
        />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {(Object.keys(ACCESS) as Access[]).map((a) => (
          <Chip key={a} active={access.has(a)} onClick={() => toggle(access, a, setAccess)}>
            {ACCESS[a].label}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        {REGIONS.map((r) => (
          <Chip key={r} active={regions.has(r)} onClick={() => toggle(regions, r, setRegions)}>
            {REGION_LABEL[r] ?? r.toUpperCase()}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <Chip active={friendsOnly} onClick={() => setFriendsOnly(!friendsOnly)}>
          <Users className="size-3" /> Friends inside
        </Chip>
        <Chip active={hideFull} onClick={() => setHideFull(!hideFull)}>
          Hide full
        </Chip>
        <Chip active={hideAgeGated} onClick={() => setHideAgeGated(!hideAgeGated)}>
          Hide 18+
        </Chip>
      </div>

      {instances.isLoading ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : instances.error ? (
        <Empty icon={<UsersRound />} title="Couldn't load group instances" hint={errorText(instances.error)} />
      ) : !all.length ? (
        <Empty icon={<UsersRound />} title="No open group instances" hint="None of your groups have an instance you can see right now." />
      ) : !shown.length ? (
        <Empty icon={<Search />} title="No instances match these filters" />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
          {shown.map((i) => (
            <InstanceCard key={i.location} inst={i} group={groupById.get(groupIdOf(i))} friends={friendsIn.get(i.location) ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstanceCard({ inst, group, friends }: { inst: VrcGroupInstance; group?: VrcGroup; friends: VrcUser[] }) {
  const openWorld = useUi((s) => s.openWorld);
  const openGroup = useUi((s) => s.openGroup);
  const openUser = useUi((s) => s.openUser);
  const n = players(inst);
  const cap = inst.capacity ?? inst.world?.capacity;
  const pct = cap ? Math.min(100, (n / cap) * 100) : 0;
  const access = ACCESS[accessOf(inst) as Access] ?? ACCESS.members;
  const region = regionOf(inst);
  const pc = inst.platforms?.standalonewindows ?? 0;
  const quest = (inst.platforms?.android ?? 0) + (inst.platforms?.ios ?? 0);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-accent/40">
      <div className="flex gap-3 p-3">
        <button onClick={() => inst.world && openWorld(inst.world.id, inst.location)} className="shrink-0 cursor-pointer" title="Open world">
          <Img src={inst.world?.thumbnailImageUrl} className="h-[72px] w-24 rounded-lg" />
        </button>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => inst.world && openWorld(inst.world.id, inst.location)}
            className="block max-w-full truncate text-left text-[13px] font-semibold hover:text-accent cursor-pointer"
          >
            {inst.world?.name ?? inst.location.split(":")[0]}
          </button>
          <button
            onClick={() => group && openGroup(group.groupId ?? group.id ?? null)}
            disabled={!group}
            className="mt-0.5 flex max-w-full items-center gap-1.5 text-xs text-muted enabled:hover:text-fg enabled:cursor-pointer"
          >
            <Img src={group?.iconUrl} className="size-4 shrink-0 rounded" />
            <span className="truncate">{group?.name ?? "Group"}</span>
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className={cn("rounded px-1.5 py-px text-[10.5px] font-semibold", access.tone)}>{access.label}</span>
            <span className="rounded bg-panel-2 px-1.5 py-px text-[10.5px] font-medium text-muted">{REGION_LABEL[region] ?? region.toUpperCase()}</span>
            {inst.ageGate && <span className="rounded bg-sky-500/10 px-1.5 py-px text-[10.5px] font-semibold text-sky-400">18+</span>}
            {inst.roleRestricted && (
              <Tip label="Only some roles can join">
                <span className="inline-flex items-center gap-0.5 rounded bg-panel-2 px-1.5 py-px text-[10.5px] text-muted">
                  <Lock className="size-2.5" /> Roles
                </span>
              </Tip>
            )}
            {!!inst.queueSize && (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-px text-[10.5px] text-amber-400">
                <ShieldAlert className="size-2.5" /> {inst.queueSize} in queue
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold tabular-nums">
            {n}
            {cap ? <span className="font-normal text-subtle"> / {cap}</span> : null} players
          </span>
          <span className="text-subtle tabular-nums">
            PC {pc} · Quest {quest}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-st-busy" : pct >= 80 ? "bg-st-ask" : "bg-accent")} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2 p-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {friends.slice(0, 5).map((f) => (
            <Tip key={f.id} label={f.displayName}>
              <button onClick={() => openUser(f.id)} className="cursor-pointer">
                <UserAvatar user={f} size={22} dot={false} />
              </button>
            </Tip>
          ))}
          {friends.length > 0 && (
            <span className="ml-1 truncate text-xs text-accent">
              {friends.length === 1 ? friends[0].displayName : `${friends.length} friends`}
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" icon={<Send className="size-3.5" />} onClick={() => actions.selfInvite(inst.location)}>
          Invite me
        </Button>
        <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => actions.join(inst.location)}>
          Join
        </Button>
      </div>
    </div>
  );
}

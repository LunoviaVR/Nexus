import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BadgeCheck, CalendarDays, Copy, Crown, ExternalLink, Globe, Link as LinkIcon, Lock, LogIn, Megaphone, Search, Send, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ago, cn, list } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import { useUser } from "@/lib/queries";
import type { VrcGroupDetail, VrcGroupMember } from "@/lib/types";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { MembershipButton } from "./GroupMembership";
import { RefreshButton } from "./RefreshButton";
import { ImageViewer, type ViewerImage } from "./ImageViewer";
import { fullSizeUrl } from "@/lib/image";
import { actions, InstanceBadge, UserAvatar } from "./people";
import { Button, Dialog, Empty, Img, Input, Segmented, Skeleton } from "./ui";
import { KV, Panel, Pill } from "./UserDialog";

type Tab = "about" | "posts" | "instances" | "members" | "json";

const JOIN_LABEL: Record<string, string> = {
  open: "Anyone can join",
  request: "Request to join",
  invite: "Invite only",
  closed: "Closed",
};

export function GroupDialog() {
  const groupId = useUi((s) => s.groupId);
  const openGroup = useUi((s) => s.openGroup);
  return (
    <Dialog open={!!groupId} onClose={() => openGroup(null)} title="Group" className="w-[min(1120px,calc(100vw-32px))]">
      {groupId && (
        <ErrorBoundary resetKey={groupId}>
          <GroupBody key={groupId} groupId={groupId} />
        </ErrorBoundary>
      )}
    </Dialog>
  );
}

/** Opening a person or world from here swaps to that dialog instead of stacking under this one. */
function useLeave() {
  const { openGroup, openUser, openWorld } = useUi();
  return {
    toUser: (id: string) => {
      openGroup(null);
      openUser(id);
    },
    toWorld: (id: string, location?: string) => {
      openGroup(null);
      openWorld(id, location);
    },
  };
}

function GroupBody({ groupId }: { groupId: string }) {
  const q = useQuery({ queryKey: ["group", groupId], queryFn: () => ipc.group(groupId), staleTime: 5 * 60_000 });
  const [tab, setTab] = useState<Tab>("about");

  if (q.isLoading) {
    return (
      <div className="flex h-[86vh]">
        <div className="w-[320px] space-y-3 border-r border-line p-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
        <div className="flex-1 p-5">
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }
  const g = q.data;
  if (!g) return <Empty icon={<Users />} title="Couldn't load this group" hint={errorText(q.error)} />;

  const tabs: { id: Tab; label: string }[] = [
    { id: "about", label: "About" },
    { id: "posts", label: "Posts" },
    { id: "instances", label: "Instances" },
    { id: "members", label: "Members" },
    { id: "json", label: "JSON" },
  ];

  return (
    <div className="flex h-[86vh]">
      <Identity g={g} />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-4 pr-14 pt-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative h-10 shrink-0 px-3 text-[13px] font-medium transition-colors cursor-pointer",
                tab === t.id ? "text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t.label}
              {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <ErrorBoundary resetKey={tab}>
            {tab === "about" && <About g={g} />}
            {tab === "posts" && <Posts groupId={g.id} />}
            {tab === "instances" && <Instances groupId={g.id} />}
            {tab === "members" && <Members g={g} />}
            {tab === "json" && (
              <pre className="selectable overflow-auto rounded-xl bg-panel-2 p-4 text-[11.5px] leading-relaxed text-muted">
                {JSON.stringify(g, null, 2)}
              </pre>
            )}
          </ErrorBoundary>
        </div>
      </section>
    </div>
  );
}

function Owner({ userId }: { userId: string }) {
  const { data } = useUser(userId);
  const { toUser } = useLeave();
  return (
    <button onClick={() => toUser(userId)} className="inline-flex max-w-full items-center gap-1.5 hover:text-accent cursor-pointer">
      <UserAvatar user={data} size={18} dot={false} />
      <span className="truncate">{data?.displayName ?? "…"}</span>
    </button>
  );
}

function Identity({ g }: { g: VrcGroupDetail }) {
  const member = g.membershipStatus === "member";
  const [viewing, setViewing] = useState<number | null>(null);
  const safe = g.name.replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const images: ViewerImage[] = [
    g.iconUrl && { src: fullSizeUrl(g.iconUrl)!, title: `${g.name} · icon`, fileName: `${safe}_icon` },
    g.bannerUrl && { src: fullSizeUrl(g.bannerUrl)!, title: `${g.name} · banner`, fileName: `${safe}_banner` },
  ].filter(Boolean) as ViewerImage[];
  const iconIndex = g.iconUrl ? 0 : null;
  const bannerIndex = g.bannerUrl ? (g.iconUrl ? 1 : 0) : null;
  return (
    <aside className="w-[320px] shrink-0 overflow-y-auto border-r border-line bg-panel">
      <div className="relative h-36">
        <button
          onClick={() => bannerIndex !== null && setViewing(bannerIndex)}
          disabled={bannerIndex === null}
          className="absolute inset-0 size-full enabled:cursor-zoom-in"
          title="View banner"
        >
          <Img src={g.bannerUrl} className="size-full" />
        </button>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-panel" />
      </div>
      <ImageViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      <div className="relative -mt-12 px-4">
        <button
          onClick={() => iconIndex !== null && setViewing(iconIndex)}
          disabled={iconIndex === null}
          className="inline-block rounded-2xl bg-panel p-1 transition-transform hover:scale-[1.03] enabled:cursor-zoom-in"
          title="View icon"
        >
          <Img src={g.iconUrl} className="size-20 rounded-xl" />
        </button>
        <div className="mt-1.5 flex items-center gap-1.5">
          <h2 className="selectable text-lg font-bold leading-tight">{g.name}</h2>
          {g.isVerified && <BadgeCheck className="size-4 shrink-0 text-sky-400" />}
          <span className="ml-auto shrink-0">
            <RefreshButton
              cooldownKey={g.id}
              noun="group"
              run={() => ipc.refreshEntity("group", g.id)}
              invalidate={[["group", g.id], ["group-posts", g.id], ["group-instances", g.id], ["group-members", g.id]]}
            />
          </span>
        </div>
        <div className="font-mono text-xs text-muted">
          {g.shortCode}.{g.discriminator}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {member && <Pill className="text-st-active">Member</Pill>}
          {g.membershipStatus === "requested" && <Pill className="text-st-ask">Requested</Pill>}
          {g.membershipStatus === "invited" && <Pill className="text-st-join">Invited</Pill>}
          {g.joinState && <Pill className="text-muted">{JOIN_LABEL[g.joinState] ?? g.joinState}</Pill>}
          {g.privacy && g.privacy !== "default" && <Pill className="text-muted">{g.privacy}</Pill>}
          {g.languages?.map((l) => (
            <Pill key={l} className="text-muted">
              <Globe className="size-3" /> {l.toUpperCase()}
            </Pill>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1.5 [&>*]:w-full">
          <MembershipButton group={g} />
          <Button
            size="sm"
            icon={<Copy className="size-3.5" />}
            onClick={() => navigator.clipboard.writeText(`${g.shortCode}.${g.discriminator}`).then(() => toast.success("Copied group code"))}
          >
            Copy code
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="col-span-2"
            icon={<ExternalLink className="size-3.5" />}
            onClick={() => ipc.openExternal(`https://vrchat.com/home/group/${g.id}`)}
          >
            Open on vrchat.com
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <Panel title="Info">
          <KV k="Members">{g.memberCount?.toLocaleString() ?? "—"}</KV>
          {g.onlineMemberCount != null && (
            <KV k="Online now">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-st-active" />
                {g.onlineMemberCount.toLocaleString()}
              </span>
            </KV>
          )}
          {g.ownerId && (
            <KV k="Owner">
              <Owner userId={g.ownerId} />
            </KV>
          )}
          {g.createdAt && (
            <KV k="Created">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3 text-subtle" /> {new Date(g.createdAt).toLocaleDateString()}
              </span>
            </KV>
          )}
        </Panel>
        {!!g.roles?.length && (
          <Panel title={`Roles · ${g.roles.length}`}>
            <div className="flex flex-wrap gap-1.5">
              {[...g.roles]
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((r) => (
                  <span key={r.id} title={r.description} className="rounded-md bg-panel-2 px-2 py-0.5 text-xs text-muted">
                    {r.name}
                  </span>
                ))}
            </div>
          </Panel>
        )}
      </div>
    </aside>
  );
}

function About({ g }: { g: VrcGroupDetail }) {
  return (
    <div className="space-y-4">
      <Panel title="Description">
        {g.description ? (
          <p className="selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-relaxed">{g.description}</p>
        ) : (
          <p className="text-[13px] text-subtle">No description.</p>
        )}
        {!!g.links?.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {g.links.map((l) => (
              <button
                key={l}
                onClick={() => ipc.openExternal(l)}
                title={l}
                  className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 text-xs text-muted hover:border-accent/50 hover:text-fg cursor-pointer"
              >
                <LinkIcon className="size-3 shrink-0" />
                <span className="min-w-0 truncate">{l.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>
      {g.rules && (
        <Panel title="Rules">
          <p className="selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-relaxed text-muted">{g.rules}</p>
        </Panel>
      )}
      {list(g.tags).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list<string>(g.tags).map((t) => (
            <span key={t} className="rounded-md bg-panel-2 px-2 py-0.5 text-xs text-muted">
              {t.replace(/^(admin_|system_)/, "")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Posts({ groupId }: { groupId: string }) {
  const q = useQuery({ queryKey: ["group-posts", groupId], queryFn: () => ipc.groupPosts(groupId), staleTime: 5 * 60_000 });
  const [viewing, setViewing] = useState<number | null>(null);
  if (q.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (q.error) return <Empty icon={<Megaphone />} title="Posts aren't visible" hint={errorText(q.error)} />;
  const posts = q.data?.posts ?? [];
  if (!posts.length) return <Empty icon={<Megaphone />} title="No posts yet" />;
  const withImages = posts.filter((p) => p.imageUrl);
  const images: ViewerImage[] = withImages.map((p) => ({ src: fullSizeUrl(p.imageUrl)!, title: p.title || "Post image", subtitle: ago(p.createdAt), fileName: `post_${p.id}` }));
  return (
    <div className="space-y-3">
      <ImageViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      {posts.map((p) => (
        <Panel key={p.id}>
          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{p.title}</div>
              <div className="text-xs text-subtle">{ago(p.createdAt)}</div>
              {p.text && <p className="selectable mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-relaxed text-muted">{p.text}</p>}
            </div>
            {p.imageUrl && (
              <button onClick={() => setViewing(withImages.indexOf(p))} className="shrink-0 cursor-zoom-in" title="View image">
                <Img src={p.imageUrl} className="h-24 w-36 rounded-lg" />
              </button>
            )}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Instances({ groupId }: { groupId: string }) {
  const { toWorld } = useLeave();
  const byId = useFriends((s) => s.byId);
  const q = useQuery({ queryKey: ["group-instances", groupId], queryFn: () => ipc.groupInstances(groupId), staleTime: 30_000 });
  if (q.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (q.error) return <Empty icon={<Globe />} title="Instances aren't visible" hint={errorText(q.error)} />;
  if (!q.data?.length) return <Empty icon={<Globe />} title="No open group instances" hint="Only instances you're allowed to see are listed." />;
  return (
    <div className="space-y-2">
      {q.data.map((i) => {
        const friendsHere = Object.values(byId).filter((f) => f.location?.split("~")[0] === i.location.split("~")[0]);
        return (
          <div key={i.location} className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/40 p-2.5">
            <Img src={i.world?.thumbnailImageUrl} className="h-14 w-20 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <button
                onClick={() => i.world && toWorld(i.world.id, i.location)}
                className="block max-w-full truncate text-left text-[13px] font-semibold hover:text-accent cursor-pointer"
              >
                {i.world?.name ?? i.location.split(":")[0]}
              </button>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <InstanceBadge location={i.location} />
                {i.memberCount != null && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3" /> {i.memberCount}
                  </span>
                )}
                {friendsHere.length > 0 && <span className="text-accent">{friendsHere.length} friends here</span>}
              </div>
            </div>
            <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => actions.selfInvite(i.location)}>
              Invite me
            </Button>
            <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => actions.join(i.location)}>
              Join
            </Button>
          </div>
        );
      })}
    </div>
  );
}

type MemberSort = "alpha" | "role" | "online";

const PAGE = 100;
const LOAD_ALL_CAP = 2000;

/** VRChat only lets you list members with the `group-members-viewall` permission (or as owner). */
function canViewMembers(g: VrcGroupDetail): "yes" | "no" | "unknown" {
  const perms = g.myMember?.permissions;
  if (!g.myMember) return "unknown"; // not a member: VRChat decides; we handle a 403
  return perms?.includes("*") || perms?.includes("group-members-viewall") ? "yes" : "no";
}

function Members({ g }: { g: VrcGroupDetail }) {
  const byId = useFriends((s) => s.byId);
  const { toUser } = useLeave();
  const [sort, setSort] = useState<MemberSort>("role");
  const [q, setQ] = useState("");
  const [loadingAll, setLoadingAll] = useState(false);
  const access = canViewMembers(g);
  const roles = new Map((g.roles ?? []).map((r) => [r.id, r]));

  const list = useInfiniteQuery({
    queryKey: ["group-members", g.id],
    queryFn: ({ pageParam }) => ipc.groupMembers(g.id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
    enabled: access !== "no",
    retry: false,
  });
  // Server-side search covers members that aren't loaded yet.
  const term = q.trim();
  const search = useQuery({
    queryKey: ["group-members-search", g.id, term],
    queryFn: () => ipc.searchGroupMembers(g.id, term),
    enabled: access !== "no" && term.length >= 3,
    staleTime: 60_000,
    retry: false,
  });

  if (access === "no") {
    return (
      <Empty
        icon={<Lock />}
        title="Member list is private"
        hint="Your role in this group doesn't have permission to view all members."
      />
    );
  }
  if (list.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (list.error) {
    return <Empty icon={<Lock />} title="Member list is private" hint="This group only shows its members to people with permission." />;
  }

  const loaded = list.data?.pages.flat() ?? [];
  const source = term.length >= 3 && search.data ? search.data : loaded.filter((m) => !term || m.user.displayName.toLowerCase().includes(term.toLowerCase()));

  const rank = (roleIds?: string[]) =>
    Math.min(...(roleIds ?? []).map((id) => roles.get(id)?.order ?? 999), 999);
  const presence = (id: string) => {
    const f = byId[id];
    return !f ? 3 : f.state === "online" ? 0 : f.state === "active" ? 1 : 2;
  };
  const byName = (a: VrcGroupMember, b: VrcGroupMember) =>
    a.user.displayName.localeCompare(b.user.displayName, undefined, { sensitivity: "base" });
  const members = [...source].sort((a, b) => {
    if (sort === "role")
      return (
        Number(b.user.id === g.ownerId) - Number(a.user.id === g.ownerId) || rank(a.roleIds) - rank(b.roleIds) || byName(a, b)
      );
    if (sort === "online") return presence(a.user.id) - presence(b.user.id) || byName(a, b);
    return byName(a, b);
  });

  const friendCount = loaded.filter((m) => byId[m.user.id]).length;
  const total = g.memberCount ?? loaded.length;
  const canLoadAll = list.hasNextPage && total <= LOAD_ALL_CAP;

  const loadAll = async () => {
    setLoadingAll(true);
    try {
      let r = await list.fetchNextPage();
      while (r.hasNextPage && (r.data?.pages.length ?? 0) * PAGE < LOAD_ALL_CAP) r = await r.fetchNextPage();
    } finally {
      setLoadingAll(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input icon={<Search className="size-4" />} placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <Segmented<MemberSort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "alpha", label: "A–Z" },
            { value: "role", label: "Role" },
            { value: "online", label: "Online" },
          ]}
        />
        {search.isFetching && <span className="text-xs text-subtle">Searching…</span>}
      </div>
      <p className="mb-3 text-[13px] text-muted">
        {term.length >= 3 && search.data
          ? `${members.length} matches across the whole group`
          : `Showing ${loaded.length.toLocaleString()} of ${total.toLocaleString()} members`}
        {friendCount > 0 && <span className="text-accent"> · {friendCount} friends</span>}
        {sort === "online" && <span className="text-subtle"> · online status is only visible for your friends</span>}
        {term.length > 0 && term.length < 3 && <span className="text-subtle"> · type 3+ letters to search everyone</span>}
      </p>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {members.map((m) => {
          const friend = byId[m.user.id];
          const roleNames = (m.roleIds ?? []).map((r) => roles.get(r)?.name).filter(Boolean);
          const isOwner = m.user.id === g.ownerId;
          return (
            <button
              key={m.id}
              onClick={() => toUser(m.user.id)}
              className={cn(
                "flex items-center gap-3 rounded-xl border bg-panel p-2.5 text-left hover:border-accent/40 cursor-pointer",
                friend ? "border-accent/30" : "border-line",
              )}
            >
              <UserAvatar user={friend ?? { ...m.user, iconUrl: m.user.iconUrl ?? m.user.thumbnailUrl }} size={34} dot={!!friend} />
              <div className="min-w-0">
                <div className="flex items-center gap-1 truncate text-[13px] font-medium">
                  {isOwner && <Crown className="size-3 shrink-0 text-amber-400" />}
                  <span className="truncate">{m.user.displayName}</span>
                </div>
                {roleNames.length > 0 && <div className="truncate text-[11px] text-subtle">{roleNames.join(", ")}</div>}
              </div>
            </button>
          );
        })}
      </div>
      {!members.length && <Empty icon={<Search />} title="No members match" />}
      {list.hasNextPage && !(term.length >= 3) && (
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage && !loadingAll}>
            Load {PAGE} more
          </Button>
          {canLoadAll && (
            <Button variant="ghost" onClick={loadAll} loading={loadingAll}>
              Load all {total.toLocaleString()}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

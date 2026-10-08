import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, Compass, Search, UserPlus, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { platformLabel } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import type { VrcGroupDetail, VrcUser } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";
import { MembershipButton } from "./GroupMembership";
import { TrustLabel, UserAvatar } from "./people";
import { Button, Dialog, Empty, Img, Input, Skeleton } from "./ui";

/**
 * The shared Discover frame (Friends and Groups): header, search-as-you-type box, prompts.
 * `children` renders the results for the settled query.
 */
function DiscoverDialog({
  open,
  onClose,
  title,
  subtitle,
  placeholder,
  prompt,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  placeholder: string;
  prompt: string;
  children: (query: string) => ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} className="w-[min(640px,calc(100vw-32px))]">
      {open && <DiscoverBody title={title} subtitle={subtitle} placeholder={placeholder} prompt={prompt} render={children} />}
    </Dialog>
  );
}

function DiscoverBody({
  title,
  subtitle,
  placeholder,
  prompt,
  render,
}: {
  title: string;
  subtitle: string;
  placeholder: string;
  prompt: string;
  render: (query: string) => ReactNode;
}) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  // Search as you type, without firing a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="border-b border-line p-5 pr-14">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Compass className="size-[18px]" />
          </span>
          <div>
            <h2 className="text-base font-bold leading-tight">{title}</h2>
            <p className="text-xs text-muted">{subtitle}</p>
          </div>
        </div>
        <Input icon={<Search className="size-4" />} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} autoFocus className="mt-4" />
      </div>
      <div className="min-h-[280px] flex-1 overflow-y-auto p-2">
        {query.length < 2 ? <Empty icon={<Search />} title="What are you looking for?" hint={prompt} /> : render(query)}
      </div>
    </div>
  );
}

function ResultsLoading() {
  return (
    <div className="space-y-1.5 p-2">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

/** "1 match is already your friend." / "3 matches are already your friends." */
function AlreadyNote({ count, one, many }: { count: number; one: string; many: string }) {
  if (!count) return null;
  return <p className="px-3 py-2 text-xs text-subtle">{count === 1 ? `1 match is ${one}.` : `${count} matches are ${many}.`}</p>;
}

/** A result row: clickable media + text on the left, one action on the right. */
function ResultRow({ onOpen, openLabel, media, title, meta, action }: { onOpen: () => void; openLabel: string; media: ReactNode; title: ReactNode; meta: ReactNode; action: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer" title={openLabel}>
        {media}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex min-w-0 items-center gap-1 text-[13px] font-semibold">{title}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">{meta}</div>
        </div>
      </button>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// People

export function DiscoverPeopleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <DiscoverDialog
      open={open}
      onClose={onClose}
      title="Discover people"
      subtitle="Find someone on VRChat who isn't your friend yet."
      placeholder="Search by display name"
      prompt="Type at least two letters of their display name."
    >
      {(query) => <PeopleResults query={query} />}
    </DiscoverDialog>
  );
}

function PeopleResults({ query }: { query: string }) {
  const byId = useFriends((s) => s.byId);
  const meId = useAuth((s) => s.user?.id);
  const results = useQuery({ queryKey: ["discover-users", query], queryFn: () => ipc.searchUsers(query), staleTime: 60_000 });
  if (results.isLoading) return <ResultsLoading />;
  if (results.error) return <Empty icon={<Search />} title="Search failed" hint={errorText(results.error)} />;
  const all = results.data ?? [];
  const people = all.filter((u) => !byId[u.id] && u.id !== meId);
  const hidden = all.length - people.length;
  if (!people.length)
    return (
      <Empty
        icon={<Search />}
        title={hidden ? "Everyone who matches is already your friend" : "Nobody found"}
        hint={hidden ? undefined : "Check the spelling, or try part of their name."}
      />
    );
  return (
    <>
      {people.map((u) => (
        <PersonRow key={u.id} u={u} />
      ))}
      <AlreadyNote count={hidden} one="already your friend" many="already your friends" />
    </>
  );
}

function PersonRow({ u }: { u: VrcUser }) {
  const openUser = useUi((s) => s.openUser);
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const platform = platformLabel(u.last_platform);
  const add = async () => {
    setState("busy");
    try {
      await ipc.friendRequest(u.id);
      setState("sent");
      toast.success(`Friend request sent to ${u.displayName}`);
    } catch (e) {
      setState("idle");
      toast.error(errorText(e));
    }
  };
  return (
    <ResultRow
      onOpen={() => openUser(u.id)}
      openLabel="View profile"
      media={<UserAvatar user={u} size={40} dot={false} />}
      title={<span className="truncate">{u.displayName}</span>}
      meta={
        <>
          <TrustLabel tags={u.tags} />
          {platform && <span className="text-subtle">{platform}</span>}
          {u.statusDescription && <span className="truncate text-muted">{u.statusDescription}</span>}
        </>
      }
      action={
        <Button
          size="sm"
          variant={state === "sent" ? "ghost" : "secondary"}
          icon={state === "sent" ? <Check className="size-3.5" /> : <UserPlus className="size-3.5" />}
          loading={state === "busy"}
          disabled={state === "sent"}
          onClick={add}
        >
          {state === "sent" ? "Requested" : "Add friend"}
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Groups

export function DiscoverGroupsDialog({ open, onClose, myGroupIds }: { open: boolean; onClose: () => void; myGroupIds: Set<string> }) {
  return (
    <DiscoverDialog
      open={open}
      onClose={onClose}
      title="Discover groups"
      subtitle="Find a VRChat group you're not in yet."
      placeholder="Search by group name or short code"
      prompt="Type at least two letters of its name, or a short code like GOTH or GOTH.0001."
    >
      {(query) => <GroupResults query={query} myGroupIds={myGroupIds} />}
    </DiscoverDialog>
  );
}

function GroupResults({ query, myGroupIds }: { query: string; myGroupIds: Set<string> }) {
  const results = useInfiniteQuery({
    queryKey: ["group-search", query],
    queryFn: ({ pageParam }) => ipc.searchGroups(query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === 50 ? all.length * 50 : undefined),
    staleTime: 5 * 60_000,
  });
  if (results.isLoading) return <ResultsLoading />;
  if (results.error) return <Empty icon={<Search />} title="Search failed" hint={errorText(results.error)} />;
  const seen = new Set<string>();
  const all = (results.data?.pages.flat() ?? []).filter((g) => !seen.has(g.id) && seen.add(g.id));
  const isMine = (g: VrcGroupDetail) => myGroupIds.has(g.id) || g.membershipStatus === "member";
  const groups = all.filter((g) => !isMine(g));
  const hidden = all.length - groups.length;
  if (!groups.length)
    return (
      <Empty
        icon={<Search />}
        title={hidden ? "You're already in every group that matches" : "No groups found"}
        hint={hidden ? undefined : "Try another name or short code."}
      />
    );
  return (
    <>
      {groups.map((g) => (
        <GroupRow key={g.id} g={g} />
      ))}
      {results.hasNextPage && (
        <div className="flex justify-center py-2">
          <Button size="sm" variant="ghost" onClick={() => results.fetchNextPage()} loading={results.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
      <AlreadyNote count={hidden} one="a group you're already in" many="groups you're already in" />
    </>
  );
}

function GroupRow({ g }: { g: VrcGroupDetail }) {
  const openGroup = useUi((s) => s.openGroup);
  // Follows the membership button, so a request shows as pending right away.
  const [status, setStatus] = useState(g.membershipStatus ?? "");
  const verified = g.isVerified || g.tags?.includes("admin_verified");
  return (
    <ResultRow
      onOpen={() => openGroup(g.id)}
      openLabel="Open group"
      media={<Img src={g.iconUrl} className="size-10 shrink-0 rounded-lg" />}
      title={
        <>
          <span className="truncate">{g.name}</span>
          {verified && <BadgeCheck className="size-3.5 shrink-0 text-sky-400" />}
        </>
      }
      meta={
        <>
          <span className="font-mono text-subtle">
            {g.shortCode}.{g.discriminator}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-muted">
            <Users className="size-3" /> {(g.memberCount ?? 0).toLocaleString()}
          </span>
          {status === "requested" && <span className="text-amber-400">Requested</span>}
        </>
      }
      action={<MembershipButton group={{ ...g, membershipStatus: status }} onChanged={setStatus} />}
    />
  );
}

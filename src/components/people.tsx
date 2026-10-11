import { useQuery } from "@tanstack/react-query";
import { Crown, Globe, Lock, Plane, Users } from "lucide-react";
import { toast } from "sonner";
import { ACCESS_LABEL, parseLocation, REGION_LABEL, isJoinable } from "@/lib/location";
import { cn, presenceColor, STATUS_LABEL, trustRank, userImage } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import { useWorldName } from "@/lib/queries";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";
import type { VrcUser } from "@/lib/types";
import { Img, Tip } from "./ui";

export function StatusDot({ user, className }: { user?: Partial<VrcUser>; className?: string }) {
  const color = presenceColor(user?.state, user?.status);
  const label = user?.state === "active" ? "Active on web" : user?.state === "offline" ? "Offline" : STATUS_LABEL[user?.status ?? "active"];
  return <span title={label} className={cn("inline-block size-2.5 shrink-0 rounded-full ring-2 ring-panel", color, className)} />;
}

export function UserAvatar({
  user,
  size = 40,
  dot = true,
  className,
}: {
  user?: Partial<VrcUser> | null;
  size?: number;
  dot?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <Img src={userImage(user)} className="size-full rounded-full bg-panel-2" />
      {dot && user && (
        <StatusDot user={user} className={cn("absolute -bottom-0.5 -right-0.5", size >= 56 ? "size-3.5 ring-[3px]" : "")} />
      )}
    </div>
  );
}

export function TrustLabel({ tags, className }: { tags?: string[]; className?: string }) {
  const t = trustRank(tags);
  return <span className={cn("text-[11px] font-medium", t.color, className)}>{t.label}</span>;
}

export function InstanceBadge({ location }: { location?: string | null }) {
  const p = parseLocation(location);
  if (p.kind !== "instance" || !p.access) return null;
  const tone =
    p.access === "public" || p.access === "group public"
      ? "text-emerald-400 bg-emerald-500/10"
      : p.access.startsWith("friends")
        ? "text-sky-400 bg-sky-500/10"
        : p.access.startsWith("group")
          ? "text-amber-400 bg-amber-500/10"
          : "text-rose-400 bg-rose-500/10";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-px text-[10.5px] font-semibold", tone)}>
      {ACCESS_LABEL[p.access]}
      {p.region && p.region !== "us" && <span className="opacity-70">· {p.region.toUpperCase()}</span>}
    </span>
  );
}

/** "World name · #1234 · Friends+" with a click-through to the world. */
export function LocationLabel({
  location,
  worldName,
  className,
  compact,
}: {
  location?: string | null;
  worldName?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const p = parseLocation(location);
  const name = useWorldName(location, worldName);
  const openWorld = useUi((s) => s.openWorld);

  if (p.kind === "offline") return <span className={cn("text-subtle", className)}>Offline</span>;
  if (p.kind === "private")
    return (
      <span className={cn("inline-flex items-center gap-1 text-muted", className)}>
        <Lock className="size-3" /> Private world
      </span>
    );
  if (p.kind === "traveling")
    return (
      <span className={cn("inline-flex items-center gap-1 text-muted", className)}>
        <Plane className="size-3" /> Traveling…
      </span>
    );

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {/* A span, not a button: this label often sits inside clickable rows. */}
      <span
        role="link"
        className="min-w-0 truncate text-left hover:text-accent hover:underline cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          openWorld(p.worldId!, p.raw);
        }}
      >
        {name ?? <span className="text-subtle">Loading world…</span>}
      </span>
      {!compact && <span className="shrink-0 text-subtle">#{p.name}</span>}
      <InstanceBadge location={location} />
    </span>
  );
}

export function RegionLabel({ location }: { location?: string | null }) {
  const p = parseLocation(location);
  if (!p.region) return null;
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <Globe className="size-3" /> {REGION_LABEL[p.region] ?? p.region.toUpperCase()}
    </span>
  );
}

/**
 * Who opened an instance: the user in its friends/invite tag, or its group. Public instances have no owner.
 * `ownerId` (from a fetched instance) is the fallback when the location carries no tag.
 */
export function InstanceOwner({ location, ownerId }: { location?: string | null; ownerId?: string | null }) {
  const p = parseLocation(location);
  const id = p.groupId ?? p.ownerId ?? ownerId ?? undefined;
  const groupId = id?.startsWith("grp_") ? id : undefined;
  const userId = id?.startsWith("usr_") ? id : undefined;
  const me = useAuth((s) => s.user);
  const friend = useFriends((s) => (userId ? s.byId[userId] : undefined));
  const known = me && me.id === userId ? me : friend;
  // Same cache keys as the profile and group dialogs, so opening either is instant.
  const user = useQuery({ queryKey: ["user", userId], queryFn: () => ipc.user(userId!), enabled: !!userId && !known, staleTime: 5 * 60_000 });
  const group = useQuery({ queryKey: ["group", groupId], queryFn: () => ipc.group(groupId!), enabled: !!groupId, staleTime: 5 * 60_000 });
  const openUser = useUi((s) => s.openUser);
  const openGroup = useUi((s) => s.openGroup);
  if (!groupId && !userId) return null;

  const name = groupId ? group.data?.name : me && me.id === userId ? "You" : (known ?? user.data)?.displayName;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted" title={groupId ? "Group instance" : "Instance owner"}>
      <Crown className="size-3 shrink-0 text-amber-400/80" />
      {/* A span, not a button: this label often sits inside clickable rows. */}
      <span
        role="link"
        className="truncate hover:text-accent hover:underline cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          if (groupId) openGroup(groupId);
          else openUser(userId!);
        }}
      >
        {name ?? "…"}
      </span>
    </span>
  );
}

export function PlayerCount({ n, cap }: { n?: number; cap?: number }) {
  if (n == null) return null;
  return (
    <Tip label="Players in instance">
      <span className="inline-flex items-center gap-1 text-muted">
        <Users className="size-3" /> {n}
        {cap ? `/${cap}` : ""}
      </span>
    </Tip>
  );
}

const inFlight = new Set<string>();

/**
 * Run a social action once at a time per target, with a "sending" toast that turns into the result.
 * If VRChat is rate limiting, the request waits it out first, so the toast keeps you informed.
 */
export async function socialAction(key: string, pending: string, done: string, run: () => Promise<unknown>): Promise<boolean> {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  const id = toast.loading(pending);
  try {
    await run();
    toast.success(done, { id });
    return true;
  } catch (e) {
    toast.error(errorText(e), { id });
    return false;
  } finally {
    inFlight.delete(key);
  }
}

/** Shared social actions with consistent toasts. */
export const actions = {
  async join(location: string) {
    try {
      await ipc.launch(location);
      toast.success("Launching VRChat…");
    } catch (e) {
      toast.error(errorText(e));
    }
  },
  selfInvite(location: string) {
    return socialAction(`self:${location}`, "Sending you an invite…", "Invite sent to yourself", () => ipc.inviteSelf(location));
  },
  invite(user: Pick<VrcUser, "id" | "displayName">) {
    return socialAction(`invite:${user.id}`, `Inviting ${user.displayName}…`, `Invited ${user.displayName}`, () => ipc.invite(user.id));
  },
  requestInvite(user: Pick<VrcUser, "id" | "displayName">) {
    return socialAction(`reqinv:${user.id}`, `Asking ${user.displayName} for an invite…`, `Asked ${user.displayName} for an invite`, () =>
      ipc.requestInvite(user.id),
    );
  },
  friendRequest(user: Pick<VrcUser, "id" | "displayName">) {
    return socialAction(`friend:${user.id}`, `Sending a friend request to ${user.displayName}…`, `Friend request sent to ${user.displayName}`, () =>
      ipc.friendRequest(user.id),
    );
  },
  canJoin(location?: string | null) {
    return isJoinable(parseLocation(location));
  },
};

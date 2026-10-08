import { useQuery } from "@tanstack/react-query";
import { ipc } from "./ipc";
import { parseLocation } from "./location";
import { useFriends } from "@/stores/friends";
import { useAuth } from "@/stores/auth";
import type { VrcUser } from "./types";

export function useWorld(worldId?: string | null) {
  return useQuery({
    queryKey: ["world", worldId],
    queryFn: () => ipc.world(worldId!),
    enabled: !!worldId && worldId.startsWith("wrld_"),
    staleTime: 30 * 60_000,
  });
}

/** World name for a location, preferring a name the backend already resolved. */
export function useWorldName(location?: string | null, known?: string | null) {
  const p = parseLocation(location);
  const q = useWorld(known ? null : p.worldId);
  return known ?? q.data?.name;
}

export function useInstance(location?: string | null) {
  return useQuery({
    queryKey: ["instance", location],
    queryFn: () => ipc.instance(location!),
    enabled: parseLocation(location).kind === "instance",
    staleTime: 30_000,
  });
}

/** A user profile, overlaid with live friend state when we have it. */
export function useUser(userId?: string | null) {
  const friend = useFriends((s) => (userId ? s.byId[userId] : undefined));
  const me = useAuth((s) => s.user);
  const q = useQuery({
    queryKey: ["user", userId],
    queryFn: () => ipc.user(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
  let data: VrcUser | undefined = q.data;
  if (friend) data = { ...q.data, ...friend };
  if (me && me.id === userId) data = { ...q.data, ...me, location: me.$location ?? me.location };
  return { ...q, data };
}

export function useAvatar(avatarId?: string | null) {
  return useQuery({
    queryKey: ["avatar", avatarId],
    queryFn: () => ipc.avatar(avatarId!),
    enabled: !!avatarId,
    staleTime: 60 * 60_000,
  });
}

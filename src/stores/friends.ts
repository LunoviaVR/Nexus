import { create } from "zustand";
import type { VrcUser } from "@/lib/types";

interface FriendsState {
  byId: Record<string, VrcUser>;
  favorites: Set<string>;
  /** Friends with the bell on (online/offline notifications). */
  watched: Set<string>;
  loaded: boolean;
  setSnapshot: (list: VrcUser[]) => void;
  upsert: (u: VrcUser) => void;
  remove: (id: string) => void;
  setFavorites: (ids: string[]) => void;
  setWatched: (ids: string[]) => void;
  reset: () => void;
}

export const useFriends = create<FriendsState>((set) => ({
  byId: {},
  favorites: new Set(),
  watched: new Set(),
  loaded: false,
  setSnapshot: (list) => set({ byId: Object.fromEntries(list.map((f) => [f.id, f])), loaded: true }),
  upsert: (u) => set((s) => ({ byId: { ...s.byId, [u.id]: u } })),
  remove: (id) =>
    set((s) => {
      const byId = { ...s.byId };
      delete byId[id];
      return { byId };
    }),
  setFavorites: (ids) => set({ favorites: new Set(ids) }),
  setWatched: (ids) => set({ watched: new Set(ids) }),
  reset: () => set({ byId: {}, favorites: new Set(), watched: new Set(), loaded: false }),
}));

export const selectFriendList = (s: FriendsState) => s.byId;

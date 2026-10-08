import { create } from "zustand";
import type { FeedEntry, GlEvent, InstanceState, VrcNotification } from "@/lib/types";

const CAP = 200;

interface LiveState {
  pipeline: boolean;
  instance: InstanceState;
  feed: FeedEntry[];
  gamelog: GlEvent[];
  notifications: VrcNotification[];
  unread: number;
  setPipeline: (v: boolean) => void;
  setInstance: (i: InstanceState) => void;
  pushFeed: (e: FeedEntry) => void;
  pushGamelog: (e: GlEvent) => void;
  setNotifications: (n: VrcNotification[]) => void;
  pushNotification: (n: VrcNotification) => void;
  dropNotification: (id: string) => void;
  markRead: () => void;
  reset: () => void;
}

export const useLive = create<LiveState>((set) => ({
  pipeline: false,
  instance: { players: [] },
  feed: [],
  gamelog: [],
  notifications: [],
  unread: 0,
  setPipeline: (pipeline) => set({ pipeline }),
  setInstance: (instance) => set({ instance }),
  pushFeed: (e) => set((s) => ({ feed: [e, ...s.feed].slice(0, CAP) })),
  pushGamelog: (e) => set((s) => ({ gamelog: [e, ...s.gamelog].slice(0, CAP) })),
  setNotifications: (notifications) => set({ notifications, unread: notifications.filter((n) => !n.seen).length }),
  pushNotification: (n) =>
    set((s) => ({
      notifications: [n, ...s.notifications.filter((x) => x.id !== n.id)],
      unread: s.unread + 1,
    })),
  dropNotification: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
  markRead: () => set({ unread: 0 }),
  reset: () => set({ pipeline: false, feed: [], gamelog: [], notifications: [], unread: 0 }),
}));

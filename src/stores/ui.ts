import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Page =
  | "home"
  | "friends"
  | "feed"
  | "gamelog"
  | "players"
  | "worlds"
  | "groups"
  | "groupInstances"
  | "avatars"
  | "inventory"
  | "search"
  | "notifications"
  | "alerts"
  | "insights"
  | "settings";

export type Theme = "dark" | "light" | "system";

/** How the friends panel (and the Friends page defaults) are organized. Set in Settings. */
export interface FriendsLayout {
  groupBy: "instance" | "status" | "none";
  sort: "name" | "recent";
  favoritesFirst: boolean;
  showWeb: boolean;
  showOffline: boolean;
}

export const DEFAULT_FRIENDS_LAYOUT: FriendsLayout = {
  groupBy: "instance",
  sort: "name",
  favoritesFirst: true,
  showWeb: true,
  showOffline: true,
};

interface UiState {
  page: Page;
  searchQuery: string;
  collapsed: boolean;
  rail: boolean;
  theme: Theme;
  accentHue: number;
  paletteOpen: boolean;
  friendsLayout: FriendsLayout;
  setFriendsLayout: (patch: Partial<FriendsLayout>) => void;
  userId: string | null;
  /** Profile tab to open on (e.g. "worlds"); null for the default. */
  userTab: string | null;
  worldId: string | null;
  worldLocation: string | null;
  groupId: string | null;
  avatarId: string | null;
  editingProfile: boolean;
  /** Game Log session (its start time) to jump to and expand. */
  gamelogFocus: number | null;
  openSession: (ts: number | null) => void;
  go: (page: Page) => void;
  search: (q: string) => void;
  toggleCollapsed: () => void;
  toggleRail: () => void;
  setTheme: (t: Theme) => void;
  setAccent: (h: number) => void;
  setPalette: (open: boolean) => void;
  openUser: (id: string | null, tab?: string) => void;
  openWorld: (id: string | null, location?: string | null) => void;
  openGroup: (id: string | null) => void;
  openAvatar: (id: string | null) => void;
  setEditingProfile: (open: boolean) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      page: "home",
      searchQuery: "",
      collapsed: false,
      rail: true,
      theme: "dark",
      accentHue: 290,
      paletteOpen: false,
      friendsLayout: DEFAULT_FRIENDS_LAYOUT,
      setFriendsLayout: (patch) => set((s) => ({ friendsLayout: { ...s.friendsLayout, ...patch } })),
      userId: null,
      userTab: null,
      worldId: null,
      worldLocation: null,
      groupId: null,
      avatarId: null,
      editingProfile: false,
      gamelogFocus: null,
      openSession: (gamelogFocus) => set(gamelogFocus == null ? { gamelogFocus } : { gamelogFocus, page: "gamelog", userId: null }),
      go: (page) => set({ page, gamelogFocus: null }),
      search: (searchQuery) => set({ searchQuery, page: "search" }),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      toggleRail: () => set((s) => ({ rail: !s.rail })),
      setTheme: (theme) => set({ theme }),
      setAccent: (accentHue) => set({ accentHue }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      openUser: (userId, tab) => set({ userId, userTab: tab ?? null }),
      openWorld: (worldId, worldLocation = null) => set({ worldId, worldLocation }),
      openGroup: (groupId) => set({ groupId }),
      openAvatar: (avatarId) => set({ avatarId }),
      setEditingProfile: (editingProfile) => set({ editingProfile }),
    }),
    {
      name: "nexus-ui",
      partialize: (s) => ({
        collapsed: s.collapsed,
        rail: s.rail,
        theme: s.theme,
        accentHue: s.accentHue,
        page: s.page,
        friendsLayout: s.friendsLayout,
      }),
      // Older saved state has no friendsLayout; fill in any missing fields.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return { ...current, ...p, friendsLayout: { ...DEFAULT_FRIENDS_LAYOUT, ...(p.friendsLayout ?? {}) } };
      },
    },
  ),
);

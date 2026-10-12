import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InstanceAccess } from "@/lib/types";

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

export type Theme = "dark" | "oled" | "light" | "system";

const THEMES: readonly string[] = ["dark", "oled", "light", "system"] satisfies Theme[];
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && THEMES.includes(v);

/** Accent colors in Settings, in rainbow order. Hues are OKLCH. */
const DEFAULT_ACCENT = 290;
export const ACCENTS = [
  { name: "Red", hue: 25 },
  { name: "Orange", hue: 55 },
  { name: "Yellow", hue: 95 },
  { name: "Green", hue: 145 },
  { name: "Blue", hue: 245 },
  { name: "Indigo", hue: 268 },
  { name: "Violet", hue: 290 },
] as const;

/** The offered accent closest to `hue`, so a color from an older version still shows as picked. */
export function nearestAccent(hue: number): number {
  if (!Number.isFinite(hue)) return DEFAULT_ACCENT;
  const dist = (h: number) => {
    const d = Math.abs(h - hue) % 360;
    return Math.min(d, 360 - d);
  };
  return ACCENTS.reduce<number>((best, a) => (dist(a.hue) < dist(best) ? a.hue : best), ACCENTS[0].hue);
}

/** How the friends panel (and the Friends page defaults) are organized. Set in Settings. */
export interface FriendsLayout {
  groupBy: "instance" | "status" | "none";
  sort: "name" | "recent";
  favoritesFirst: boolean;
  showWeb: boolean;
  showOffline: boolean;
}

/** What you last picked when opening an instance from a world, to start from next time. */
export interface InstancePrefs {
  type: InstanceAccess | "group";
  groupId: string | null;
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
  /** The release notes reader, from the megaphone in the top bar. */
  changelogOpen: boolean;
  friendsLayout: FriendsLayout;
  setFriendsLayout: (patch: Partial<FriendsLayout>) => void;
  instancePrefs: InstancePrefs;
  setInstancePrefs: (prefs: InstancePrefs) => void;
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
  setChangelog: (open: boolean) => void;
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
      accentHue: DEFAULT_ACCENT,
      paletteOpen: false,
      changelogOpen: false,
      friendsLayout: DEFAULT_FRIENDS_LAYOUT,
      setFriendsLayout: (patch) => set((s) => ({ friendsLayout: { ...s.friendsLayout, ...patch } })),
      instancePrefs: { type: "public", groupId: null },
      setInstancePrefs: (instancePrefs) => set({ instancePrefs }),
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
      setChangelog: (changelogOpen) => set({ changelogOpen }),
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
        instancePrefs: s.instancePrefs,
      }),
      // Older saved state has no friendsLayout, and may have an accent color that's no longer offered.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...p,
          theme: isTheme(p.theme) ? p.theme : current.theme,
          accentHue: nearestAccent(p.accentHue ?? current.accentHue),
          friendsLayout: { ...DEFAULT_FRIENDS_LAYOUT, ...(p.friendsLayout ?? {}) },
        };
      },
    },
  ),
);

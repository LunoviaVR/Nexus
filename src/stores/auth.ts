import { create } from "zustand";
import type { CurrentUser } from "@/lib/types";

type Phase = "booting" | "loggedOut" | "twoFactor" | "ready";

interface AuthState {
  phase: Phase;
  user: CurrentUser | null;
  methods: string[];
  lastUsername?: string | null;
  setPhase: (phase: Phase) => void;
  loggedIn: (user: CurrentUser) => void;
  loggedOut: (username?: string | null) => void;
  needTwoFactor: (methods: string[]) => void;
  updateUser: (user: CurrentUser) => void;
}

export const useAuth = create<AuthState>((set) => ({
  phase: "booting",
  user: null,
  methods: [],
  setPhase: (phase) => set({ phase }),
  loggedIn: (user) => set({ phase: "ready", user, methods: [] }),
  loggedOut: (username) => set({ phase: "loggedOut", user: null, lastUsername: username }),
  needTwoFactor: (methods) => set({ phase: "twoFactor", methods }),
  updateUser: (user) => set((s) => ({ user: { ...s.user, ...user } })),
}));

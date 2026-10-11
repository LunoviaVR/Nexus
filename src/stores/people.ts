import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import type { UserBrief } from "@/lib/types";

/**
 * Names and pictures of people who may not be friends (instance players, game log sessions).
 * The backend answers with what it already knows and looks the rest up in the background,
 * sending each one as a `user:brief` event, so asking is cheap and never floods VRChat.
 */
interface PeopleState {
  byId: Record<string, UserBrief>;
  merge: (briefs: Record<string, UserBrief> | UserBrief[]) => void;
  reset: () => void;
}

export const usePeople = create<PeopleState>((set) => ({
  byId: {},
  merge: (briefs) =>
    set((s) => {
      const list = Array.isArray(briefs) ? briefs : Object.values(briefs);
      if (!list.length) return s;
      const byId = { ...s.byId };
      for (const b of list) byId[b.id] = { ...byId[b.id], ...b };
      return { byId };
    }),
  reset: () => set({ byId: {} }),
}));

/** People in your current instance are worth a fresh look after this long; anyone else, never. */
const FRESH_FOR_MS = 3 * 60 * 60_000;
/** Don't ask about the same person again within this window (the backend is already on it). */
const ASK_AGAIN_MS = 10 * 60_000;

const askedAt = new Map<string, number>();
const pending = { any: new Set<string>(), fresh: new Set<string>() };
let flushing = false;

function flush() {
  flushing = false;
  for (const fresh of [false, true]) {
    const set = fresh ? pending.fresh : pending.any;
    if (!set.size) continue;
    const ids = [...set];
    set.clear();
    ipc.usersBrief(ids, fresh ? FRESH_FOR_MS : undefined).then(usePeople.getState().merge, () => {
      // Let a later render ask again.
      ids.forEach((id) => askedAt.delete(`${fresh ? "fresh" : "any"}:${id}`));
    });
  }
}

/** Ask for someone's brief; requests made in the same moment go to the backend together. */
export function requestPerson(id: string, fresh = false) {
  const key = `${fresh ? "fresh" : "any"}:${id}`;
  const now = Date.now();
  if (now - (askedAt.get(key) ?? 0) < ASK_AGAIN_MS) return;
  askedAt.set(key, now);
  (fresh ? pending.fresh : pending.any).add(id);
  if (!flushing) {
    flushing = true;
    setTimeout(flush, 30);
  }
}

export function forgetAsked() {
  askedAt.clear();
}

import { Heart, Users } from "lucide-react";
import { list } from "@/lib/format";
import type { Avatar, World } from "@/lib/types";
import { useUi } from "@/stores/ui";
import { Img } from "./ui";

export function WorldCard({ w, friendsHere = 0 }: { w: World; friendsHere?: number }) {
  const openWorld = useUi((s) => s.openWorld);
  return (
    <button
      onClick={() => openWorld(w.id)}
      className="group overflow-hidden rounded-xl border border-line bg-panel text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-pop cursor-pointer"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <Img src={w.thumbnailImageUrl || w.imageUrl} className="size-full transition-transform duration-300 group-hover:scale-105" />
        {friendsHere > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg shadow">
            {friendsHere} friend{friendsHere > 1 ? "s" : ""} here
          </span>
        )}
      </div>
      <div className="p-3">
        <div className="truncate text-[13px] font-semibold">{w.name}</div>
        <div className="truncate text-xs text-muted">{w.authorName}</div>
        <div className="mt-1.5 flex gap-3 text-[11px] text-subtle">
          {w.occupants != null && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" /> {w.occupants}
            </span>
          )}
          {w.favorites != null && (
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3" /> {w.favorites.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function AvatarCard({ a, onSelect, busy }: { a: Avatar; onSelect: () => void; busy?: boolean }) {
  const quest = list(a.unityPackages).some((p) => p.platform === "android");
  const openAvatar = useUi((s) => s.openAvatar);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openAvatar(a.id)}
      onKeyDown={(e) => e.key === "Enter" && openAvatar(a.id)}
      title="View details"
      className="group cursor-pointer overflow-hidden rounded-xl border border-line bg-panel transition-all hover:border-accent/40 hover:shadow-pop"
    >
      <div className="relative aspect-[3/4] overflow-hidden">
        <Img src={a.thumbnailImageUrl || a.imageUrl} className="size-full transition-transform duration-300 group-hover:scale-105" />
        <div className="absolute inset-x-0 bottom-0 flex translate-y-full justify-center bg-gradient-to-t from-black/70 to-transparent p-3 transition-transform group-hover:translate-y-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg shadow hover:bg-accent-strong disabled:opacity-60 cursor-pointer"
          >
            {busy ? "Switching…" : "Use avatar"}
          </button>
        </div>
        {quest && <span className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">Quest</span>}
      </div>
      <div className="p-3">
        <div className="truncate text-[13px] font-semibold">{a.name}</div>
        <div className="truncate text-xs text-muted">{a.authorName}</div>
      </div>
    </div>
  );
}

export const GRID = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]";

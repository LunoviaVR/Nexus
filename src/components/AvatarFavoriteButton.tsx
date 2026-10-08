import * as Popover from "@radix-ui/react-popover";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Check, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/format";
import { errorText, ipc, type FavoriteKind } from "@/lib/ipc";
import { Button, Spinner } from "./ui";

/** VRChat's per-list caps (VRC+): avatars 6 × 50, worlds 4 × 100, VRC+ worlds 4 × 100. */
const PER_LIST: Record<FavoriteKind, number> = { avatar: 50, world: 100, vrcPlusWorld: 100, friend: 150 };
const DEFAULT_LIST: Record<FavoriteKind, { tag: string; label: string }> = {
  avatar: { tag: "avatars1", label: "Favorites" },
  world: { tag: "worlds1", label: "Favorites" },
  vrcPlusWorld: { tag: "vrcPlusWorlds1", label: "VRC+ Favorites" },
  friend: { tag: "group_0", label: "Favorites" },
};

interface Option {
  kind: FavoriteKind;
  tag: string;
  label: string;
}

/**
 * Favorite something into one of your lists, move it between lists, or remove it.
 * `kinds` lists which favorite types to offer (worlds have regular and VRC+ lists).
 */
export function FavoriteButton({
  id,
  name,
  kinds,
  size = "sm",
  className = "w-full",
}: {
  id: string;
  name: string;
  kinds: FavoriteKind[];
  size?: "sm" | "md";
  className?: string;
}) {
  const qc = useQueryClient();
  const groups = useQueries({
    queries: kinds.map((k) => ({ queryKey: ["favorite-groups", k], queryFn: () => ipc.favoriteGroups(k), staleTime: 10 * 60_000 })),
  });
  const favs = useQueries({
    queries: kinds.map((k) => ({ queryKey: ["favorites-of", k], queryFn: () => ipc.favoritesOf(k), staleTime: 60_000 })),
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const options: Option[] = kinds.flatMap((k, i) => {
    const list = [...(groups[i].data ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (groups[i].isLoading) return [];
    return list.length ? list.map((g) => ({ kind: k, tag: g.name, label: g.displayName || g.name })) : [{ kind: k, ...DEFAULT_LIST[k] }];
  });
  const all = kinds.flatMap((k, i) => (favs[i].data ?? []).map((f) => ({ ...f, kind: k })));
  const mine = all.find((f) => f.favoriteId === id);
  const current = mine ? { kind: mine.kind, tag: mine.tags[0] } : undefined;
  const counts = new Map<string, number>();
  for (const f of all) for (const t of f.tags) counts.set(`${f.kind}:${t}`, (counts.get(`${f.kind}:${t}`) ?? 0) + 1);
  const labelOf = (o?: { kind: FavoriteKind; tag: string }) => options.find((x) => x.kind === o?.kind && x.tag === o?.tag)?.label ?? o?.tag;

  const refresh = () =>
    Promise.all(
      [["favorites-of"], ["avatar-favorites"], ["avatars"], ["worlds"]].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );

  const choose = async (o: Option) => {
    const key = `${o.kind}:${o.tag}`;
    setBusy(key);
    try {
      if (mine && current?.kind === o.kind && current.tag === o.tag) {
        await ipc.removeFavorite(mine.kind, mine.id);
        toast.success(`Removed ${name} from ${o.label}`);
      } else {
        // A favorite lives in one list; moving means remove, then add.
        if (mine) await ipc.removeFavorite(mine.kind, mine.id);
        await ipc.addFavorite(o.kind, id, o.tag);
        toast.success(mine ? `Moved ${name} to ${o.label}` : `Added ${name} to ${o.label}`);
      }
      await refresh();
      setOpen(false);
    } catch (e) {
      toast.error(errorText(e));
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const loading = favs.some((f) => f.isLoading);
  const sections = kinds.filter((k) => options.some((o) => o.kind === k));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          size={size}
          className={className}
          disabled={loading}
          icon={<Star className={cn(size === "sm" ? "size-3.5" : "size-4", mine && "fill-amber-400 text-amber-400")} />}
        >
          {mine ? `In ${labelOf(current)}` : "Favorite"}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[80] w-64 rounded-xl border border-line bg-panel p-1.5 shadow-pop outline-none">
          {sections.map((k) => (
            <div key={k}>
              <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                {k === "vrcPlusWorld" ? "VRC+ world lists" : mine ? "Move to list" : "Add to list"}
              </div>
              {options
                .filter((o) => o.kind === k)
                .map((o) => {
                  const key = `${o.kind}:${o.tag}`;
                  const n = counts.get(key) ?? 0;
                  const here = current?.kind === o.kind && current.tag === o.tag;
                  const full = !here && n >= PER_LIST[o.kind];
                  return (
                    <button
                      key={key}
                      disabled={full || !!busy}
                      onClick={() => choose(o)}
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      <span className="flex size-4 items-center justify-center">
                        {busy === key ? <Spinner className="size-3" /> : here ? <Check className="size-4 text-accent" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      <span className={cn("text-xs tabular-nums", full ? "text-st-busy" : "text-subtle")}>
                        {full ? "Full" : `${n}/${PER_LIST[o.kind]}`}
                      </span>
                    </button>
                  );
                })}
            </div>
          ))}
          {mine && (
            <button
              disabled={!!busy}
              onClick={() => choose({ kind: current!.kind, tag: current!.tag, label: labelOf(current) ?? "" })}
              className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg border-t border-line px-2 pt-1 text-left text-[13px] text-red-400 hover:bg-red-500/10 cursor-pointer"
            >
              <Trash2 className="size-4" /> Remove from favorites
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AvatarFavoriteButton({ avatarId, avatarName }: { avatarId: string; avatarName: string }) {
  return <FavoriteButton id={avatarId} name={avatarName} kinds={["avatar"]} />;
}

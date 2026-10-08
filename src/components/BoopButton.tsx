import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { Hand, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/format";
import { fileUrls } from "@/lib/image";
import { errorText, ipc } from "@/lib/ipc";
import type { VrcUser } from "@/lib/types";
import { Button, Img } from "./ui";

/**
 * VRChat's built-in emojis, in the order the game lists them, with the exact IDs the boop API takes.
 * The IDs can't be derived from the names ("Can't see" is `default_cantsee`, "Bats" is `default_bat`),
 * so they're listed explicitly; checked against boops the game itself sends.
 */
export const DEFAULT_EMOJIS: [name: string, id: string][] = [
  ["Angry", "default_angry"],
  ["Blushing", "default_blushing"],
  ["Crying", "default_crying"],
  ["Frown", "default_frown"],
  ["Hand Wave", "default_hand_wave"],
  ["Hang Ten", "default_hang_ten"],
  ["In Love", "default_in_love"],
  ["Jack O Lantern", "default_jack_o_lantern"],
  ["Kiss", "default_kiss"],
  ["Laugh", "default_laugh"],
  ["Skull", "default_skull"],
  ["Smile", "default_smile"],
  ["Spooky Ghost", "default_spooky_ghost"],
  ["Stoic", "default_stoic"],
  ["Sunglasses", "default_sunglasses"],
  ["Thinking", "default_thinking"],
  ["Thumbs Down", "default_thumbs_down"],
  ["Thumbs Up", "default_thumbs_up"],
  ["Tongue Out", "default_tongue_out"],
  ["Wow", "default_wow"],
  ["Arrow Point", "default_arrowpoint"],
  ["Can't see", "default_cantsee"],
  ["Hourglass", "default_hourglass"],
  ["Keyboard", "default_keyboard"],
  ["No Headphones", "default_noheadphones"],
  ["No Mic", "default_nomic"],
  ["Portal", "default_portal"],
  ["Shush", "default_shush"],
  ["Bats", "default_bat"],
  ["Cloud", "default_cloud"],
  ["Fire", "default_fire"],
  ["Snow Fall", "default_snow_fall"],
  ["Snowball", "default_snowball"],
  ["Splash", "default_splash"],
  ["Web", "default_web"],
  ["Beer", "default_beer"],
  ["Candy", "default_candy"],
  ["Candy Cane", "default_candy_cane"],
  ["Candy Corn", "default_candy_corn"],
  ["Champagne", "default_champagne"],
  ["Drink", "default_drink"],
  ["Gingerbread", "default_gingerbread"],
  ["Ice Cream", "default_ice_cream"],
  ["Pineapple", "default_pineapple"],
  ["Pizza", "default_pizza"],
  ["Tomato", "default_tomato"],
  ["Beachball", "default_beachball"],
  ["Coal", "default_coal"],
  ["Confetti", "default_confetti"],
  ["Gift", "default_gift"],
  ["Gifts", "default_gifts"],
  ["Life Ring", "default_life_ring"],
  ["Mistletoe", "default_mistletoe"],
  ["Money", "default_money"],
  ["Neon Shades", "default_neon_shades"],
  ["Sun Lotion", "default_sun_lotion"],
  ["Boo", "default_boo"],
  ["Broken Heart", "default_broken_heart"],
  ["Exclamation", "default_exclamation"],
  ["Go", "default_go"],
  ["Heart", "default_heart"],
  ["Music Note", "default_music_note"],
  ["Question", "default_question"],
  ["Stop", "default_stop"],
  ["Zzz", "default_zzz"],
];

export function BoopButton({ user, size = "sm" }: { user: VrcUser; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Custom emojis need VRC+; anyone without them just gets an empty list.
  const custom = useQuery({
    queryKey: ["files", "emoji,emojianimated"],
    queryFn: () => ipc.files("emoji,emojianimated"),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const defaults = useMemo(() => {
    const s = q.trim().toLowerCase();
    return DEFAULT_EMOJIS.filter(([n]) => !s || n.toLowerCase().includes(s));
  }, [q]);

  const send = async (key: string, emojiId?: string, label?: string) => {
    setBusy(key);
    try {
      await ipc.boop(user.id, emojiId);
      toast.success(label ? `Booped ${user.displayName} with ${label}` : `Booped ${user.displayName}`);
      setOpen(false);
    } catch (e) {
      // VRChat won't take another boop until they've seen the last one.
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setQ("");
      }}
    >
      <Popover.Trigger asChild>
        <Button size={size} icon={<Hand className={size === "sm" ? "size-3.5" : "size-4"} />}>
          Boop
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[60] w-80 rounded-xl border border-line bg-panel p-3 shadow-pop outline-none"
        >
          <Button variant="primary" className="w-full" icon={<Hand className="size-4" />} loading={busy === "plain"} disabled={!!busy} onClick={() => send("plain")}>
            Boop {user.displayName}
          </Button>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="…or pick an emoji"
              className="h-8 w-full rounded-lg border border-line bg-panel-2 pl-8 pr-2 text-[13px] outline-none placeholder:text-subtle focus:border-accent"
            />
          </div>
          <div className="mt-2 max-h-64 space-y-3 overflow-y-auto pr-1">
            {!q && !!custom.data?.length && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Your emojis</div>
                <div className="grid grid-cols-6 gap-1">
                  {custom.data.map((f) => (
                    <button
                      key={f.id}
                      disabled={!!busy}
                      onClick={() => send(f.id, f.id, "a custom emoji")}
                      className={cn("aspect-square rounded-lg p-1 hover:bg-hover cursor-pointer disabled:opacity-50", busy === f.id && "animate-pulse")}
                    >
                      <Img src={fileUrls(f).thumb} className="size-full bg-transparent object-contain" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              {!q && <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Emojis</div>}
              <div className="flex flex-wrap gap-1">
                {defaults.map(([n, id]) => (
                  <button
                    key={id}
                    disabled={!!busy}
                    onClick={() => send(n, id, n)}
                    className={cn(
                      "rounded-full border border-line bg-panel-2 px-2.5 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-fg cursor-pointer disabled:opacity-50",
                      busy === n && "animate-pulse",
                    )}
                  >
                    {n}
                  </button>
                ))}
                {!defaults.length && <p className="px-1 py-2 text-xs text-subtle">No emoji matches "{q}".</p>}
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

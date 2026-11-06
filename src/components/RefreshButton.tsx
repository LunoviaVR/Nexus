import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/format";
import { errorText } from "@/lib/ipc";
import { Tip } from "./ui";

/** Keys with a refresh in flight, shared so two buttons for the same thing can't both fire. */
const inFlight = new Set<string>();
/** Buttons sharing a key (e.g. the Friends page and the friends panel) spin together. */
const listeners = new Map<string, Set<(busy: boolean) => void>>();

function setBusyFor(key: string, busy: boolean) {
  if (busy) inFlight.add(key);
  else inFlight.delete(key);
  listeners.get(key)?.forEach((fn) => fn(busy));
}

/**
 * Refresh-on-demand, one at a time per item: another click while it's running does
 * nothing, and a click after it's done refreshes again.
 */
export function RefreshButton({
  refreshKey,
  noun,
  run,
  invalidate,
}: {
  /** Usually the item's id (usr_/wrld_/grp_…). */
  refreshKey: string;
  /** "profile", "world", "group" — used in labels. */
  noun: string;
  run: () => Promise<unknown>;
  /** Queries to reload after a successful refresh. */
  invalidate: QueryKey[];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(() => inFlight.has(refreshKey));
  useEffect(() => {
    const set = listeners.get(refreshKey) ?? new Set();
    listeners.set(refreshKey, set);
    set.add(setBusy);
    setBusy(inFlight.has(refreshKey));
    return () => {
      set.delete(setBusy);
    };
  }, [refreshKey]);

  const refresh = async () => {
    // Checked synchronously: rapid clicks land before React re-renders the disabled button.
    if (inFlight.has(refreshKey)) return;
    setBusyFor(refreshKey, true);
    try {
      await run();
      await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} refreshed`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusyFor(refreshKey, false);
    }
  };

  const label = busy ? `Refreshing ${noun}…` : `Refresh ${noun}`;
  return (
    <Tip label={label}>
      <span>
        <button
          aria-label={label}
          disabled={busy}
          onClick={refresh}
          className="relative inline-flex size-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-accent/50 hover:text-fg disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-muted cursor-pointer"
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
        </button>
      </span>
    </Tip>
  );
}

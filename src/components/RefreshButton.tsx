import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/format";
import { errorText } from "@/lib/ipc";
import { useNow } from "@/lib/useNow";
import { Tip } from "./ui";

/** When each item may be refreshed again (survives closing the dialog; the backend enforces it too). */
const readyAtByKey = new Map<string, number>();
/** Buttons sharing a key (e.g. the Friends page and the friends panel) show the same cooldown. */
const listeners = new Map<string, Set<(until: number) => void>>();
/** Keys with a refresh in flight, shared so two buttons can't both fire. */
const inFlight = new Set<string>();

function setReadyAtFor(key: string, until: number) {
  readyAtByKey.set(key, until);
  listeners.get(key)?.forEach((fn) => fn(until));
}

/**
 * Refresh-on-demand with spam protection: one request in flight at a time, then a cooldown
 * (set by the backend's reply) shown as a countdown.
 */
export function RefreshButton({
  cooldownKey,
  noun,
  run,
  invalidate,
}: {
  /** Usually the item's id (usr_/wrld_/grp_…). */
  cooldownKey: string;
  /** "profile", "world", "group" — used in labels. */
  noun: string;
  run: () => Promise<{ refreshed: boolean; retryInMs: number }>;
  /** Queries to reload after a successful refresh. */
  invalidate: QueryKey[];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [readyAt, setReadyAt] = useState(() => readyAtByKey.get(cooldownKey) ?? 0);
  useEffect(() => {
    const set = listeners.get(cooldownKey) ?? new Set();
    listeners.set(cooldownKey, set);
    set.add(setReadyAt);
    setReadyAt(readyAtByKey.get(cooldownKey) ?? 0);
    return () => {
      set.delete(setReadyAt);
    };
  }, [cooldownKey]);
  const now = useNow(readyAt > Date.now() ? 1000 : 60_000);
  // `now` ticks on an interval and can be stale right after a refresh; never count from the past.
  const wait = Math.max(0, Math.ceil((readyAt - Math.max(now, Date.now())) / 1000));
  const cooling = wait > 0;

  const refresh = async () => {
    // Checked synchronously: rapid clicks land before React re-renders the disabled button.
    if (inFlight.has(cooldownKey) || (readyAtByKey.get(cooldownKey) ?? 0) > Date.now()) return;
    inFlight.add(cooldownKey);
    setBusy(true);
    try {
      const r = await run();
      setReadyAtFor(cooldownKey, Date.now() + r.retryInMs);
      if (!r.refreshed) {
        toast.info(`Just refreshed — try again in ${Math.ceil(r.retryInMs / 1000)}s`);
        return;
      }
      await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} refreshed`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      inFlight.delete(cooldownKey);
      setBusy(false);
    }
  };

  const label = cooling ? `Refresh again in ${wait}s` : `Refresh ${noun}`;
  return (
    <Tip label={label}>
      <span>
        <button
          aria-label={label}
          disabled={busy || cooling}
          onClick={refresh}
          className="relative inline-flex size-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-accent/50 hover:text-fg disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-muted cursor-pointer"
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin", cooling && "opacity-40")} />
          {cooling && (
            <span className="absolute -bottom-1 -right-1 rounded-full bg-panel-2 px-1 text-[9px] font-semibold tabular-nums text-subtle ring-1 ring-line">
              {wait}
            </span>
          )}
        </button>
      </span>
    </Tip>
  );
}

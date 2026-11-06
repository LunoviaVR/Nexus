import { TriangleAlert } from "lucide-react";
import { toast as sonner } from "sonner";

/** What the backend says when VRChat rate limits something you did (`RATE_LIMITED` in api.rs). */
const RATE_LIMITED = "VRChat is limiting how fast you can do this right now. Try again in a moment.";

const RATE_LIMIT_TOAST = "rate-limited";
const RATE_LIMIT_FOR = 8000;

/** Until when the "wait a moment" version is up, so a background retry doesn't soften it. */
let mustWaitUntil = 0;

/**
 * The yellow "Rate limited" notice. There's only ever one: another rate limit while it's up
 * updates it and keeps it up longer.
 * @param retrying the request will be tried again by itself (background work), so there's
 * nothing for the user to wait out.
 */
export function showRateLimited(retrying: boolean) {
  const now = Date.now();
  if (!retrying) mustWaitUntil = now + RATE_LIMIT_FOR;
  const mustWait = !retrying || now < mustWaitUntil;
  return sonner(
    <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-warn">
      <TriangleAlert className="size-3" /> Rate limited
    </span>,
    {
      id: RATE_LIMIT_TOAST,
      duration: RATE_LIMIT_FOR,
      description: mustWait
        ? "VRChat is limiting how fast you can do things right now. Wait a moment, then try again."
        : "VRChat asked Nexus to slow down. What's loading in the background will carry on by itself.",
    },
  );
}

const error: typeof sonner.error = (message, data) => {
  if (typeof message === "string" && message === RATE_LIMITED) {
    // Whatever this error was going to replace (a "Saving…" toast, say) is over.
    if (data?.id !== undefined) sonner.dismiss(data.id);
    return showRateLimited(false);
  }
  return sonner.error(message, data);
};

/** Sonner's `toast`, except that a rate-limit error shows as the yellow "Rate limited" notice. */
export const toast = Object.assign((...args: Parameters<typeof sonner>) => sonner(...args), sonner, { error }) as typeof sonner;

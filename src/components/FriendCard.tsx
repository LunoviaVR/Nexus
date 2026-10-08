import { BellRing, LogIn, MailPlus, Send, Star } from "lucide-react";
import { useNow } from "@/lib/useNow";
import { cn, duration, platformLabel, ago } from "@/lib/format";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";
import type { VrcUser } from "@/lib/types";
import { actions, LocationLabel, UserAvatar } from "./people";
import { IconButton } from "./ui";

export function FriendCard({ friend }: { friend: VrcUser }) {
  const openUser = useUi((s) => s.openUser);
  const fav = useFriends((s) => s.favorites.has(friend.id));
  const watched = useFriends((s) => s.watched.has(friend.id));
  const now = useNow(30_000);
  const online = friend.state === "online";
  const since = friend.$locationAt;
  const platform = platformLabel(friend.last_platform);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openUser(friend.id)}
      onKeyDown={(e) => e.key === "Enter" && openUser(friend.id)}
      className={cn(
        "group relative flex h-[76px] cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel px-3 transition-all",
        "hover:-translate-y-px hover:border-accent/40 hover:bg-panel-2 hover:shadow-pop",
        friend.state === "offline" && "opacity-70",
      )}
    >
      <UserAvatar user={friend} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{friend.displayName}</span>
          {fav && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
          {watched && <BellRing aria-label="Online alerts on" className="size-3 shrink-0 text-accent" />}
        </div>
        {friend.statusDescription && (
          <div className="truncate text-xs text-muted">{friend.statusDescription}</div>
        )}
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
          {online ? (
            <>
              <LocationLabel location={friend.location} worldName={friend.$worldName} compact className="min-w-0" />
              {since && <span className="shrink-0 text-subtle tabular-nums">{duration(now - since)}</span>}
            </>
          ) : friend.state === "active" ? (
            <span className="text-st-web">Active on web</span>
          ) : (
            <span className="text-subtle">
              {friend.last_login ? `Last seen ${ago(friend.last_login)}` : "Offline"}
              {platform && ` · ${platform}`}
            </span>
          )}
        </div>
      </div>
      {online && (
        <div className="absolute right-2 top-2 hidden items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5 shadow-pop group-hover:flex group-focus-within:flex">
          {actions.canJoin(friend.location) && (
            <IconButton label="Join" onClick={(e) => (e.stopPropagation(), actions.join(friend.location!))}>
              <LogIn className="size-4" />
            </IconButton>
          )}
          <IconButton label="Invite to my instance" onClick={(e) => (e.stopPropagation(), actions.invite(friend))}>
            <Send className="size-4" />
          </IconButton>
          <IconButton label="Request invite" onClick={(e) => (e.stopPropagation(), actions.requestInvite(friend))}>
            <MailPlus className="size-4" />
          </IconButton>
        </div>
      )}
    </div>
  );
}

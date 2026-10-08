import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellRing,
  CalendarDays,
  Clock,
  Coins,
  Copy,
  ExternalLink,
  Gamepad2,
  Gem,
  Globe,
  History,
  Link as LinkIcon,
  Lock,
  LogIn,
  MailPlus,
  MonitorSmartphone,
  Moon,
  Pencil,
  ScrollText,
  Search,
  Send,
  ShieldCheck,
  Shirt,
  Star,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ago, cn, dateTime, duration, platformLabel, STATUS_LABEL, userImage } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import { parseLocation } from "@/lib/location";
import { useAvatar, useUser, useWorld } from "@/lib/queries";
import { useNow } from "@/lib/useNow";
import type { CurrentUser, UserHistory, VrcBadge, VrcGroup, VrcProfile, VrcUser, World } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { byRecent } from "@/lib/friends";
import { useUi } from "@/stores/ui";
import { AvatarCard, GRID, WorldCard } from "./Cards";
import { ErrorBoundary } from "./ErrorBoundary";
import { FavoriteButton } from "./AvatarFavoriteButton";
import { BoopButton } from "./BoopButton";
import { RefreshButton } from "./RefreshButton";
import { ImageViewer, type ViewerImage } from "./ImageViewer";
import { fullSizeUrl } from "@/lib/image";
import { FeedRow } from "./FeedRow";
import { actions, InstanceBadge, LocationLabel, RegionLabel, TrustLabel, UserAvatar } from "./people";
import { Button, Dialog, Empty, Img, Input, SectionTitle, Segmented, Skeleton, Switch, Tip } from "./ui";

type Tab = "info" | "groups" | "mutuals" | "worlds" | "favworlds" | "avatars" | "activity" | "json";

export const LANGUAGES: Record<string, string> = {
  eng: "English", jpn: "Japanese", kor: "Korean", zho: "Chinese", spa: "Spanish", fra: "French", deu: "German",
  por: "Portuguese", rus: "Russian", ita: "Italian", nld: "Dutch", pol: "Polish", tha: "Thai", vie: "Vietnamese",
  tur: "Turkish", ukr: "Ukrainian", swe: "Swedish", fin: "Finnish", nor: "Norwegian", dan: "Danish", ces: "Czech",
  hun: "Hungarian", ara: "Arabic", heb: "Hebrew", ind: "Indonesian", msa: "Malay", fil: "Filipino", hin: "Hindi",
  ase: "ASL", bfi: "BSL", jsl: "JSL", fsl: "LSF", kvk: "KSL", dse: "NGT",
};

const STATUS_DOT: Record<string, string> = {
  "join me": "bg-st-join",
  active: "bg-st-active",
  "ask me": "bg-st-ask",
  busy: "bg-st-busy",
  offline: "bg-st-offline",
};

export function UserDialog() {
  const userId = useUi((s) => s.userId);
  const openUser = useUi((s) => s.openUser);
  return (
    <Dialog open={!!userId} onClose={() => openUser(null)} title="User profile" className="w-[min(1120px,calc(100vw-32px))]">
      {userId && (
        <ErrorBoundary resetKey={userId}>
          <Profile key={userId} userId={userId} />
        </ErrorBoundary>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Small building blocks

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-panel-2/40", className)}>
      {title && (
        <div className="flex h-9 items-center justify-between border-b border-line/70 px-3.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{title}</span>
          {action}
        </div>
      )}
      <div className="p-3.5">{children}</div>
    </div>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span className="shrink-0 text-muted">{k}</span>
      <span className="min-w-0 truncate text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full border border-line bg-panel-2 px-2 text-[11px] font-semibold", className)}>
      {children}
    </span>
  );
}

function Toggle({ label, on }: { label: string; on?: boolean }) {
  if (on == null) return null;
  return (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", on ? "text-st-active" : "text-subtle")}>
        <span className={cn("size-1.5 rounded-full", on ? "bg-st-active" : "bg-st-offline")} />
        {on ? "Enabled" : "Disabled"}
      </span>
    </div>
  );
}

/** Bell: notify me when this friend comes online or goes offline. Independent of favorites. */
function BellButton({ userId, name, isFriend }: { userId: string; name: string; isFriend: boolean }) {
  const on = useFriends((s) => s.watched.has(userId));
  const setWatched = useFriends((s) => s.setWatched);
  const [busy, setBusy] = useState(false);
  const label = !isFriend
    ? "Online alerts only work for friends"
    : on
      ? `Notifying you when ${name} comes online or goes offline. Click to stop.`
      : `Notify me when ${name} comes online or goes offline`;
  return (
    <Tip label={label}>
      <span>
        <button
          aria-label={label}
          aria-pressed={on}
          disabled={!isFriend || busy}
          onClick={async () => {
            setBusy(true);
            try {
              setWatched(await ipc.setWatch(userId, !on));
              toast.success(on ? `Stopped alerts for ${name}` : `You'll be notified when ${name} comes online or goes offline`);
            } catch (e) {
              toast.error(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-full border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
            on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent/50 hover:text-fg",
          )}
        >
          {on ? <BellRing className="size-4" /> : <Bell className="size-4" />}
        </button>
      </span>
    </Tip>
  );
}

type AccountToggle = "allowAvatarCopying" | "isBoopingEnabled" | "receiveMobileInvitations" | "hasSharedConnectionsOptOut" | "hasDiscordFriendsOptOut";

/**
 * Your own account setting as a live switch. Optimistic, and rolled back if VRChat refuses.
 * `inverted` is for opt-out fields: the switch shows "shown", VRChat stores "opted out".
 */
function SettingSwitch({ label, field, value, inverted }: { label: string; field: AccountToggle; value?: boolean; inverted?: boolean }) {
  const updateUser = useAuth((s) => s.updateUser);
  const [pending, setPending] = useState<boolean | null>(null);
  if (value == null) return null;
  const shown = pending ?? (inverted ? !value : value);
  return (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className={cn("inline-flex items-center gap-2", pending !== null && "opacity-60")}>
        <span className={cn("text-xs font-semibold", shown ? "text-st-active" : "text-subtle")}>{shown ? "Enabled" : "Disabled"}</span>
        <Switch
          checked={shown}
          label={label}
          onChange={async (v) => {
            if (pending !== null) return;
            setPending(v);
            try {
              const sent = inverted ? !v : v;
              // VRChat may omit opt-out fields once they're false, so record what it confirmed.
              updateUser({ ...(await ipc.updateMe(undefined, { [field]: sent })), [field]: sent });
              toast.success(`${label} ${v ? "enabled" : "disabled"}`);
            } catch (e) {
              toast.error(errorText(e));
            } finally {
              setPending(null);
            }
          }}
        />
      </span>
    </div>
  );
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A linear fade shows a visible edge where it starts and stops; easing the alpha
 * (smoothstep-ish stops) makes the banner melt into the page instead.
 */
function easedFade(from: number, to = 100) {
  const stops = [1, 0.97, 0.9, 0.79, 0.65, 0.5, 0.35, 0.21, 0.1, 0.03, 0];
  return `linear-gradient(to bottom, ${stops
    .map((a, i) => `rgb(0 0 0 / ${a}) ${(from + ((to - from) * i) / (stops.length - 1)).toFixed(1)}%`)
    .join(", ")})`;
}

function hex(c?: string) {
  return c && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : undefined;
}

/** A Nexus card: soft surface, small caps heading, optional trailing action. */
function Section({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-panel-2/40 p-4", className)}>
      {title && <SectionTitle right={action}>{title}</SectionTitle>}
      {children}
    </div>
  );
}

/** Round, bordered utility button matching the refresh and bell buttons. */
function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tip label={label}>
      <button
        aria-label={label}
        onClick={onClick}
        className="inline-flex size-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-accent/50 hover:text-fg cursor-pointer"
      >
        {children}
      </button>
    </Tip>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/40 p-3.5">
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tone)}>{icon}</div>
      <div className="min-w-0">
        <div className="truncate text-xl font-bold leading-none tabular-nums">{value}</div>
        <div className="mt-1 truncate text-xs text-muted">{label}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Profile({ userId }: { userId: string }) {
  const { data: u, isLoading, error } = useUser(userId);
  const me = useAuth((s) => s.user);
  const isMe = me?.id === userId;
  const profile = useQuery({ queryKey: ["profile", userId], queryFn: () => ipc.profile(userId), staleTime: 5 * 60_000 });
  const history = useQuery({ queryKey: ["history", userId], queryFn: () => ipc.userHistory(userId) });
  const [tab, setTab] = useState<Tab>("info");
  // The tab bar only gets a surface once it's actually stuck to the top.
  const [stuck, setStuck] = useState(false);

  if (isLoading && !u) {
    return (
      <div className="h-[86vh]">
        <Skeleton className="h-44 w-full rounded-none" />
        <div className="-mt-14 flex items-end gap-5 px-6">
          <Skeleton className="size-28 rounded-full ring-4 ring-panel" />
          <div className="flex-1 space-y-2 pb-2">
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3 px-6 pt-6">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[68px] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  if (!u) return <Empty icon={<Users />} title="Couldn't load this user" hint={errorText(error)} />;

  const p = profile.data;
  const meData = isMe ? (me ?? undefined) : undefined;
  const tabs: { value: Tab; label: string; show: boolean }[] = [
    { value: "info", label: "Overview", show: true },
    { value: "groups", label: "Groups", show: true },
    { value: "mutuals", label: "Mutuals", show: !isMe },
    { value: "worlds", label: "Worlds", show: true },
    { value: "favworlds", label: "Favorite worlds", show: isMe },
    { value: "avatars", label: "Avatars", show: true },
    { value: "activity", label: "Activity", show: true },
    { value: "json", label: "JSON", show: true },
  ];

  const banner = p?.bannerUrl || u.bannerUrl;

  return (
    <div className="relative h-[86vh]">
      {banner && (
        // The banner bleeds through the whole page, fading out towards the bottom.
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="size-full" style={{ maskImage: easedFade(10) }}>
            <Img src={banner} className="size-full scale-110 opacity-45 blur-2xl" />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, color-mix(in oklch, var(--panel) 20%, transparent), color-mix(in oklch, var(--panel) 55%, transparent) 35%, color-mix(in oklch, var(--panel) 80%, transparent) 70%, var(--panel))",
            }}
          />
        </div>
      )}
      <div
        className="relative h-full overflow-y-auto"
        onScroll={(e) => {
          const bar = e.currentTarget.querySelector<HTMLElement>("[data-tabbar]");
          if (bar) setStuck(bar.offsetTop - e.currentTarget.scrollTop <= 0);
        }}
      >
        <Hero u={u} p={p} isMe={isMe} me={meData} />
        <Stats u={u} isMe={isMe} history={history.data} />
        <div
          data-tabbar
          className={cn(
            "sticky top-0 z-10 mt-5 border-b px-6 py-2.5 pr-14 transition-colors duration-200",
            stuck ? "border-line bg-panel/85 backdrop-blur" : "border-transparent",
          )}
        >
          <div className="overflow-x-auto">
            <Segmented<Tab> value={tab} onChange={setTab} options={tabs.filter((t) => t.show)} />
          </div>
        </div>
        <div className="px-6 pb-6 pt-5">
          <ErrorBoundary resetKey={tab}>
            {tab === "info" && <InfoTab u={u} p={p} isMe={isMe} me={meData} profileLoading={profile.isLoading} />}
            {tab === "groups" && <GroupsTab userId={userId} />}
            {tab === "mutuals" && <MutualsTab userId={userId} />}
            {tab === "worlds" && <WorldsTab userId={userId} />}
            {tab === "favworlds" && <FavWorldsTab />}
            {tab === "avatars" && (isMe ? <AvatarsTab /> : <SeenAvatarsTab userId={u.id} name={u.displayName} />)}
            {tab === "activity" && <ActivityTab history={history.data} />}
            {tab === "json" && <JsonTab u={u} p={p} />}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Hero: banner, identity and actions

function Hero({ u, p, isMe, me }: { u: VrcUser; p?: VrcProfile; isMe: boolean; me?: CurrentUser }) {
  const isFriend = useFriends((s) => !!s.byId[u.id]);
  const fav = useFriends((s) => s.favorites.has(u.id));
  const setEditingProfile = useUi((s) => s.setEditingProfile);
  const now = useNow(30_000);
  const online = u.state === "online";
  const banner = p?.bannerUrl || u.bannerUrl;
  const icon = p?.iconUrl || userImage(u);
  const [viewing, setViewing] = useState<number | null>(null);
  const safeName = u.displayName.replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const viewerImages: ViewerImage[] = [
    icon && { src: fullSizeUrl(icon)!, title: `${u.displayName} · profile picture`, fileName: `${safeName}_icon` },
    banner && { src: fullSizeUrl(banner)!, title: `${u.displayName} · banner`, fileName: `${safeName}_banner` },
  ].filter(Boolean) as ViewerImage[];
  const iconIndex = icon ? 0 : null;
  const bannerIndex = banner ? (icon ? 1 : 0) : null;
  const gradTop = hex(p?.backgroundGradientTop);
  const gradBottom = hex(p?.backgroundGradientBottom);
  const tags = p?.trustTags?.length ? [...(u.tags ?? []), ...p.trustTags] : u.tags;
  const badges = [...(p?.badges ?? [])].sort((a, b) => Number(!!b.showcased) - Number(!!a.showcased));
  const platform = platformLabel(u.last_platform);
  const ageVerified = (p?.ageVerificationStatus ?? u.ageVerificationStatus) === "18+";
  const statusText =
    u.statusDescription || (u.state === "active" ? "Active on web" : u.state === "offline" ? "Offline" : STATUS_LABEL[u.status ?? "active"]);
  const dot = u.state === "offline" ? "bg-st-offline" : u.state === "active" ? "bg-st-web" : STATUS_DOT[u.status ?? "active"];
  const pronouns = p?.pronouns || u.pronouns;

  return (
    <header>
      <div
        className={cn("relative overflow-hidden", banner ? "h-56" : "h-44")}
        style={{
          background: gradTop && gradBottom ? `linear-gradient(${gradTop}, ${gradBottom})` : undefined,
          // Dissolve the banner into the blurred copy behind the page rather than ending on a hard edge.
          maskImage: banner ? easedFade(30) : undefined,
        }}
      >
        {banner ? (
          <button onClick={() => setViewing(bannerIndex)} className="absolute inset-0 size-full cursor-zoom-in" title="View banner">
            <Img src={banner} className="size-full" />
          </button>
        ) : (
          !gradTop && <Img src={userImage(u, true)} className="absolute inset-0 size-full scale-125 opacity-50 blur-3xl" />
        )}
        {!banner && <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-panel via-panel/30 to-transparent" />}
      </div>

      <div className={cn("relative flex items-end gap-5 px-6", banner ? "-mt-24" : "-mt-14")}>
        <button
          onClick={() => iconIndex !== null && setViewing(iconIndex)}
          disabled={iconIndex === null}
          className="shrink-0 rounded-full bg-panel p-1 shadow-pop transition-transform hover:scale-[1.03] enabled:cursor-zoom-in"
          title="View profile picture"
        >
          <UserAvatar user={u} size={104} />
        </button>
        <div className="min-w-0 flex-1 pb-1">
          <div className="flex items-center gap-2">
            <h2 className="selectable truncate text-2xl font-bold tracking-tight">{u.displayName}</h2>
            {fav && <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" />}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px]">
            <span className={cn("size-2 shrink-0 rounded-full", dot)} />
            <span className="selectable truncate">{statusText}</span>
            {online && u.$onlineAt && <span className="shrink-0 text-xs tabular-nums text-subtle">· online {duration(now - u.$onlineAt)}</span>}
          </div>
          {(pronouns || (isMe && me?.username)) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              {pronouns && <span>{pronouns}</span>}
              {isMe && me?.username && <span className="font-mono text-subtle">@{me.username}</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pb-1.5">
          <RefreshButton
            cooldownKey={u.id}
            noun="profile"
            run={() => ipc.refreshProfile(u.id)}
            invalidate={[["user", u.id], ["profile", u.id], ["history", u.id], ["groups", u.id], ["mutuals", u.id], ["user-worlds", u.id]]}
          />
          {!isMe && <BellButton userId={u.id} name={u.displayName} isFriend={isFriend} />}
          <RoundButton label="Copy user ID" onClick={() => navigator.clipboard.writeText(u.id).then(() => toast.success("Copied user ID"))}>
            <Copy className="size-4" />
          </RoundButton>
          <RoundButton label="Open on vrchat.com" onClick={() => ipc.openExternal(`https://vrchat.com/home/user/${u.id}`)}>
            <ExternalLink className="size-4" />
          </RoundButton>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5 px-6">
        <Pill>
          <ShieldCheck className="size-3 text-subtle" />
          <TrustLabel tags={tags} className="text-[11px]" />
        </Pill>
        {ageVerified && <Pill className="text-sky-400">18+</Pill>}
        {p?.hasVrcPlus && (
          <Pill className="text-amber-400">
            <Gem className="size-3" /> VRC+
          </Pill>
        )}
        {platform && <Pill className="text-muted">{platform}</Pill>}
        {isMe && me?.discordDetails?.global_name && <Pill className="text-indigo-400">Discord</Pill>}
        {isMe && me?.twitchDetails?.login && <Pill className="text-purple-400">Twitch</Pill>}
        {p?.languages?.map((l) => (
          <Pill key={l} className="text-muted">
            <Globe className="size-3" /> {LANGUAGES[l] ?? l.toUpperCase()}
          </Pill>
        ))}
        {badges.length > 0 && <span className="mx-1 h-4 w-px bg-line" />}
        {badges.map((b: VrcBadge) => (
          <Tip key={b.badgeId} label={b.badgeDescription || b.badgeName || "Badge"}>
            <span className={cn("rounded-md p-0.5", b.showcased && "bg-accent-soft ring-1 ring-accent/40")}>
              <Img src={b.badgeImageUrl} className="size-7 rounded bg-transparent object-contain" />
            </span>
          </Tip>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 px-6">
        {online && !isMe && actions.canJoin(u.location) && (
          <Button variant="primary" icon={<LogIn className="size-4" />} onClick={() => actions.join(u.location!)}>
            Join
          </Button>
        )}
        {online && u.location?.startsWith("wrld_") && !isMe && (
          <Button icon={<Send className="size-4" />} onClick={() => actions.selfInvite(u.location!)}>
            Invite me
          </Button>
        )}
        {isFriend && !isMe && (
          <>
            <Button icon={<Send className="size-4" />} onClick={() => actions.invite(u)}>
              Invite
            </Button>
            <Button icon={<MailPlus className="size-4" />} onClick={() => actions.requestInvite(u)}>
              Request invite
            </Button>
            <BoopButton user={u} size="md" />
            <FavoriteButton id={u.id} name={u.displayName} kinds={["friend"]} size="md" className="" />
          </>
        )}
        {!isFriend && !isMe && (
          <Button
            variant="primary"
            icon={<UserPlus className="size-4" />}
            onClick={() => ipc.friendRequest(u.id).then(() => toast.success("Friend request sent"), (e) => toast.error(errorText(e)))}
          >
            Add friend
          </Button>
        )}
        {isMe && (
          <Button variant="primary" icon={<Pencil className="size-4" />} onClick={() => setEditingProfile(true)}>
            Edit profile
          </Button>
        )}
      </div>

      <ImageViewer images={viewerImages} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
    </header>
  );
}

/** At-a-glance numbers: your history with them, or your own totals. */
function Stats({ u, isMe, history }: { u: VrcUser; isMe: boolean; history?: UserHistory }) {
  const balance = useQuery({ queryKey: ["balance"], queryFn: ipc.balance, enabled: isMe, staleTime: 60_000 });
  const wait = <span className="text-subtle">…</span>;
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 px-6 lg:grid-cols-4">
      {isMe ? (
        <>
          <Stat icon={<Clock className="size-5" />} label="Play time" value={history ? duration(history.totalPlayMs) : wait} tone="bg-accent-soft text-accent" />
          <Stat icon={<Gamepad2 className="size-5" />} label="Sessions logged" value={history?.encounters ?? wait} tone="bg-st-active/15 text-st-active" />
          <Stat
            icon={<Coins className="size-5" />}
            label="VRChat Credits"
            value={balance.data ? balance.data.balance.toLocaleString() : "—"}
            tone="bg-amber-500/15 text-amber-400"
          />
          <Stat
            icon={<CalendarDays className="size-5" />}
            label="Joined VRChat"
            value={u.date_joined ? new Date(u.date_joined).toLocaleDateString() : "—"}
            tone="bg-st-join/15 text-st-join"
          />
        </>
      ) : (
        <>
          <Stat icon={<Clock className="size-5" />} label="Time together" value={history ? duration(history.timeTogetherMs) : wait} tone="bg-accent-soft text-accent" />
          <Stat icon={<Users className="size-5" />} label="Encounters" value={history?.encounters ?? wait} tone="bg-st-active/15 text-st-active" />
          <Stat icon={<History className="size-5" />} label="Last together" value={history?.lastSeen ? ago(history.lastSeen) : "—"} tone="bg-st-web/15 text-st-web" />
          <Stat
            icon={<CalendarDays className="size-5" />}
            label="Friends since"
            value={history?.friendAdded ? new Date(history.friendAdded).toLocaleDateString() : "—"}
            tone="bg-amber-500/15 text-amber-400"
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Overview tab

/** Where they are right now, shown as a world card when they're in an instance. */
function Presence({ u, location, isMe }: { u: VrcUser; location?: string | null; isMe: boolean }) {
  const now = useNow(30_000);
  const openWorld = useUi((s) => s.openWorld);
  const loc = parseLocation(location);
  const world = useWorld(loc.kind === "instance" ? (loc.worldId ?? null) : null);
  const inWorld = (location ?? "").startsWith("wrld_") || u.state === "online";

  if (!inWorld) {
    return (
      <Section title={isMe ? "Your location" : "Right now"}>
        <div className="flex items-center gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-panel-2 text-subtle">
            {u.state === "active" ? <MonitorSmartphone className="size-5" /> : <Moon className="size-5" />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold">{u.state === "active" ? "Active on the website" : "Offline"}</p>
            <p className="text-[13px] text-muted">
              {u.state === "active" ? "Not in VRChat at the moment." : `Last seen ${ago(u.last_activity || u.last_login || "") || "a while ago"}.`}
            </p>
          </div>
        </div>
      </Section>
    );
  }

  if (loc.kind !== "instance" || !loc.worldId) {
    return (
      <Section title={isMe ? "Your location" : "Right now"}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <LocationLabel location={location} worldName={u.$worldName} />
          {u.$locationAt && <span className="text-xs text-subtle">for {duration(now - u.$locationAt)}</span>}
        </div>
      </Section>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <button onClick={() => openWorld(loc.worldId!, location)} className="group relative block h-32 w-full text-left cursor-pointer">
        <Img src={world.data?.imageUrl ?? world.data?.thumbnailImageUrl} className="absolute inset-0 size-full transition-transform duration-500 group-hover:scale-[1.03]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/75">{isMe ? "You're in" : "Right now in"}</div>
          <div className="truncate text-lg font-bold text-white drop-shadow group-hover:underline">
            {u.$worldName ?? world.data?.name ?? "Unknown world"}
          </div>
        </div>
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-panel-2/40 px-4 py-2.5 text-[13px]">
        <InstanceBadge location={location} />
        {loc.name && <span className="font-medium">#{loc.name}</span>}
        <RegionLabel location={location} />
        {u.$locationAt && <span className="ml-auto text-xs tabular-nums text-subtle">for {duration(now - u.$locationAt)}</span>}
      </div>
    </div>
  );
}

function NoteEditor({ u }: { u: VrcUser }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(u.note ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(u.note ?? ""), [u.note]);
  const save = async () => {
    setSaving(true);
    try {
      await ipc.setNote(u.id, text);
      qc.setQueryData(["user", u.id], (old: VrcUser | undefined) => (old ? { ...old, note: text } : old));
      setEditing(false);
      toast.success("Note saved to VRChat");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section
      title="Note"
      action={
        !editing && (
          <button aria-label="Edit note" onClick={() => setEditing(true)} className="mb-2 text-subtle hover:text-accent cursor-pointer">
            <Pencil className="size-3.5" />
          </button>
        )
      }
    >
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={text}
            maxLength={256}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-line bg-panel px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setText(u.note ?? "");
              }}
            >
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="block w-full text-left cursor-text">
          <p className="selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] text-muted">
            {u.note || <span className="text-subtle">No note. Notes sync with VRChat.</span>}
          </p>
        </button>
      )}
    </Section>
  );
}

function MemoEditor({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["memo", userId], queryFn: () => ipc.memo(userId) });
  const [text, setText] = useState("");
  useEffect(() => setText(data ?? ""), [data]);
  return (
    <Section
      title="Memo"
      action={
        <span className="mb-2 inline-flex items-center gap-1 text-[11px] text-subtle">
          <Lock className="size-3" /> Only on this PC
        </span>
      }
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          if (text === (data ?? "")) return;
          await ipc.setMemo(userId, text);
          qc.setQueryData(["memo", userId], text);
          toast.success("Memo saved");
        }}
        placeholder="Private notes that never leave Nexus"
        rows={2}
        className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-subtle"
      />
    </Section>
  );
}

function CurrentAvatar({ avatarId, thumb }: { avatarId: string; thumb?: string }) {
  const { data } = useAvatar(avatarId);
  const openAvatar = useUi((s) => s.openAvatar);
  return (
    <LinkCard title="Current avatar" onClick={() => openAvatar(avatarId)} img={thumb || data?.thumbnailImageUrl} name={data?.name} sub={data?.authorName && `by ${data.authorName}`} />
  );
}

function HomeWorld({ location }: { location: string }) {
  const worldId = location.split(":")[0];
  const { data } = useWorld(worldId);
  const openWorld = useUi((s) => s.openWorld);
  return <LinkCard title="Home world" onClick={() => openWorld(worldId)} img={data?.thumbnailImageUrl} name={data?.name} sub={data?.authorName && `by ${data.authorName}`} />;
}

function GroupCard({ g, title }: { g: VrcGroup; title?: string }) {
  const openGroup = useUi((s) => s.openGroup);
  const sub = [g.shortCode && `${g.shortCode}.${g.discriminator}`, g.memberCount != null && `${g.memberCount.toLocaleString()} members`]
    .filter(Boolean)
    .join(" · ");
  return <LinkCard title={title} onClick={() => openGroup(g.groupId ?? g.id ?? null)} img={g.bannerUrl || g.iconUrl} icon={g.iconUrl} name={g.name} sub={sub} />;
}

/** A clickable media card: image strip on top, name and a subtitle below. */
function LinkCard({ title, onClick, img, icon, name, sub }: { title?: string; onClick: () => void; img?: string | null; icon?: string | null; name?: string; sub?: string | false }) {
  return (
    <button onClick={onClick} className="group block w-full overflow-hidden rounded-xl border border-line bg-panel-2/40 text-left transition-colors hover:border-accent/40 cursor-pointer">
      <div className="relative aspect-[3/1]">
        <Img src={img} className="size-full" />
        {title && (
          <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
            {title}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {icon && <Img src={icon} className="size-8 shrink-0 rounded-lg" />}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold group-hover:text-accent">{name ?? "…"}</div>
          {sub && <div className="truncate text-xs text-muted">{sub}</div>}
        </div>
      </div>
    </button>
  );
}

function InfoTab({ u, p, isMe, me, profileLoading }: { u: VrcUser; p?: VrcProfile; isMe: boolean; me?: CurrentUser; profileLoading: boolean }) {
  const now = useNow(30_000);
  const myLocation = isMe ? (me?.$location ?? u.location) : u.location;
  const lastSeen = u.last_activity || u.last_login;
  const hasSettings = [u.allowAvatarCopying, me?.allowAvatarCopying, me?.isBoopingEnabled, me?.receiveMobileInvitations].some((v) => v != null);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Presence u={u} location={myLocation} isMe={isMe} />

        <Section title="Bio">
          {profileLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : p?.bio ? (
            <p className="selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-[13.5px] leading-relaxed">{p.bio}</p>
          ) : (
            <p className="text-[13px] text-subtle">No bio.</p>
          )}
          {!!p?.bioLinks?.length && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.bioLinks.map((l) => (
                <button
                  key={l}
                  onClick={() => ipc.openExternal(l)}
                  title={l}
                  className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 text-xs text-muted hover:border-accent/50 hover:text-fg cursor-pointer"
                >
                  <LinkIcon className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">{hostLabel(l)}</span>
                </button>
              ))}
            </div>
          )}
        </Section>

        {!isMe && (
          <div className="grid gap-4 lg:grid-cols-2">
            <NoteEditor u={u} />
            <MemoEditor userId={u.id} />
          </div>
        )}
      </div>

      <div className="space-y-4">
        <Section title="Details">
          {u.state === "online" && u.$onlineAt && <KV k="Online for">{duration(now - u.$onlineAt)}</KV>}
          {u.state === "offline" && lastSeen && <KV k="Offline for">{ago(lastSeen).replace(/ ago$/, "")}</KV>}
          {lastSeen && <KV k="Last activity">{ago(lastSeen)}</KV>}
          {!isMe && u.date_joined && <KV k="Date joined">{new Date(u.date_joined).toLocaleDateString()}</KV>}
          {platformLabel(u.last_platform) && <KV k="Platform">{platformLabel(u.last_platform)}</KV>}
          <KV k="User ID">
            <button
              onClick={() => navigator.clipboard.writeText(u.id).then(() => toast.success("Copied user ID"))}
              title={u.id}
              className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-accent cursor-pointer"
            >
              {u.id.length > 14 ? `${u.id.slice(0, 13)}…` : u.id} <Copy className="size-3" />
            </button>
          </KV>
        </Section>

        {hasSettings && (
          <Section title={isMe ? "Your settings" : "Settings"}>
            {isMe ? (
              <>
                <SettingSwitch label="Avatar cloning" field="allowAvatarCopying" value={me?.allowAvatarCopying} />
                <SettingSwitch label="Booping" field="isBoopingEnabled" value={me?.isBoopingEnabled} />
                <SettingSwitch label="Mobile invitations" field="receiveMobileInvitations" value={me?.receiveMobileInvitations} />
                {me && <SettingSwitch label="Show mutual friends" field="hasSharedConnectionsOptOut" value={me.hasSharedConnectionsOptOut ?? false} inverted />}
                <SettingSwitch label="Discord connections" field="hasDiscordFriendsOptOut" value={me?.hasDiscordFriendsOptOut} inverted />
              </>
            ) : (
              <Toggle label="Avatar cloning" on={u.allowAvatarCopying} />
            )}
          </Section>
        )}

        {isMe && me?.currentAvatar && <CurrentAvatar avatarId={me.currentAvatar} thumb={me.currentAvatarThumbnailImageUrl} />}
        {isMe && me?.homeLocation && <HomeWorld location={me.homeLocation} />}
        {p?.representedGroup && <GroupCard g={p.representedGroup} title="Representing" />}

        {isMe && !!me?.pastDisplayNames?.length && (
          <Section title="Past names">
            {me.pastDisplayNames
              .slice()
              .reverse()
              .map((n) => (
                <KV key={n.updated_at} k={n.displayName}>
                  <span className="text-xs text-subtle">{new Date(n.updated_at).toLocaleDateString()}</span>
                </KV>
              ))}
          </Section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Other tabs

function Loading() {
  return (
    <div className={GRID}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
      ))}
    </div>
  );
}

type GroupSort = "alpha" | "members" | "online";

function GroupsTab({ userId }: { userId: string }) {
  const list = useQuery({ queryKey: ["groups", userId], queryFn: () => ipc.userGroups(userId), staleTime: 10 * 60_000 });
  if (list.isLoading) return <Loading />;
  if (list.error) return <Empty icon={<Users />} title="Couldn't load groups" hint={errorText(list.error)} />;
  if (!list.data?.length) return <Empty icon={<Users />} title="No visible groups" />;
  return <SortableGroups groups={list.data} />;
}

/** Search + A–Z / most members / most online over a list of groups. `actions` sits at the end of the filter row. */
export function SortableGroups({ groups: all, actions }: { groups: VrcGroup[]; actions?: ReactNode }) {
  const [sort, setSort] = useState<GroupSort>("alpha");
  const [q, setQ] = useState("");
  const ids = all.map((g) => g.groupId ?? g.id ?? "").filter(Boolean);
  // The group list has no online counts; fetch details only once someone asks for that sort.
  const details = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["group", id],
      queryFn: () => ipc.group(id),
      staleTime: 10 * 60_000,
      enabled: sort === "online",
    })),
  });
  const online: Record<string, number | undefined> = {};
  details.forEach((d, i) => (online[ids[i]] = d.data?.onlineMemberCount));
  const loadingOnline = sort === "online" && details.some((d) => d.isLoading);
  const loaded = details.filter((d) => d.data).length;

  const s = q.trim().toLowerCase();
  const groups = all
    .filter((g) => !s || g.name.toLowerCase().includes(s) || (g.shortCode ?? "").toLowerCase().includes(s))
    .sort((a, b) => {
      if (sort === "members") return (b.memberCount ?? 0) - (a.memberCount ?? 0);
      if (sort === "online") return (online[b.groupId ?? b.id ?? ""] ?? -1) - (online[a.groupId ?? a.id ?? ""] ?? -1);
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input icon={<Search className="size-4" />} placeholder={`Search ${all.length} groups`} value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
        <Segmented<GroupSort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "alpha", label: "A–Z" },
            { value: "members", label: "Most members" },
            { value: "online", label: "Most online" },
          ]}
        />
        {loadingOnline && (
          <span className="text-xs text-subtle">
            Loading online counts… {loaded}/{ids.length}
          </span>
        )}
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {groups.length ? (
        <GroupGrid groups={groups} online={sort === "online" ? online : undefined} />
      ) : (
        <Empty icon={<Search />} title="No groups match" />
      )}
    </div>
  );
}

function GroupGrid({ groups, online }: { groups: VrcGroup[]; online?: Record<string, number | undefined> }) {
  const openGroup = useUi((s) => s.openGroup);
  return (
    <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      {groups.map((g) => (
        <button
          key={g.groupId ?? g.id}
          onClick={() => openGroup(g.groupId ?? g.id ?? null)}
          className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition-colors hover:border-accent/40 hover:bg-panel-2 cursor-pointer"
        >
          <Img src={g.iconUrl} className="size-11 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{g.name}</div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{g.memberCount?.toLocaleString()} members</span>
              {online?.[g.groupId ?? g.id ?? ""] != null && (
                <span className="inline-flex items-center gap-1 text-st-active">
                  <span className="size-1.5 rounded-full bg-st-active" />
                  {online[g.groupId ?? g.id ?? ""]!.toLocaleString()} online
                </span>
              )}
            </div>
            <div className="mt-1 flex gap-1">
              {g.isRepresenting && <span className="rounded bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">Representing</span>}
              {g.mutualGroup && <span className="rounded bg-emerald-500/12 px-1.5 text-[10px] font-semibold text-emerald-400">Mutual</span>}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

type MutualSort = "alpha" | "online" | "recent";

function MutualsTab({ userId }: { userId: string }) {
  const openUser = useUi((s) => s.openUser);
  const byId = useFriends((s) => s.byId);
  const [view, setView] = useState<"friends" | "groups">("friends");
  const [sort, setSort] = useState<MutualSort>("online");
  const [q, setQ] = useState("");
  const mutuals = useQuery({ queryKey: ["mutuals", userId], queryFn: () => ipc.userMutuals(userId), staleTime: 10 * 60_000 });
  // Mutual groups come from their group list, which flags the ones you share.
  const groups = useQuery({ queryKey: ["groups", userId], queryFn: () => ipc.userGroups(userId), staleTime: 10 * 60_000 });
  if (mutuals.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (mutuals.error) return <Empty icon={<Users />} title="Mutuals aren't available" hint={errorText(mutuals.error)} />;

  const list = mutuals.data?.friends ?? [];
  const mutualGroups = (groups.data ?? []).filter((g) => g.mutualGroup);
  const friendCount = mutuals.data?.counts.friends ?? list.length;
  const groupCount = groups.data ? mutualGroups.length : (mutuals.data?.counts.groups ?? 0);

  // Mutual friends are your friends too, so their live presence is known.
  const presence = (id: string) => {
    const st = byId[id]?.state;
    return st === "online" ? 0 : st === "active" ? 1 : 2;
  };
  const s = q.trim().toLowerCase();
  const friends = list
    .filter((m) => !s || m.displayName.toLowerCase().includes(s))
    .sort((a, b) => {
      const byName = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
      if (sort === "online") return presence(a.id) - presence(b.id) || byName;
      if (sort === "recent") return byId[a.id] && byId[b.id] ? byRecent(byId[a.id], byId[b.id]) : byName;
      return byName;
    });

  return (
    <div>
      <Segmented
        className="mb-4"
        value={view}
        onChange={setView}
        options={[
          { value: "friends", label: `Friends · ${friendCount}` },
          { value: "groups", label: `Groups · ${groupCount}` },
        ]}
      />
      {view === "groups" ? (
        groups.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : mutualGroups.length ? (
          <SortableGroups groups={mutualGroups} />
        ) : (
          <Empty icon={<Users />} title="No mutual groups visible" />
        )
      ) : list.length ? (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input icon={<Search className="size-4" />} placeholder={`Search ${list.length} friends`} value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
            <Segmented<MutualSort>
              value={sort}
              onChange={setSort}
              options={[
                { value: "alpha", label: "A–Z" },
                { value: "online", label: "Online" },
                { value: "recent", label: "Recently active" },
              ]}
            />
          </div>
          {friends.length ? (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              {friends.map((m) => {
                const live = byId[m.id];
                return (
                  <button
                    key={m.id}
                    onClick={() => openUser(m.id)}
                    className="flex items-center gap-3 rounded-xl border border-line bg-panel p-2.5 text-left hover:border-accent/40 cursor-pointer"
                  >
                    <UserAvatar user={live ?? m} size={34} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{m.displayName}</div>
                      <div className="truncate text-[11px] text-subtle">
                        {live?.state === "online" ? (
                          <LocationLabel location={live.location} worldName={live.$worldName} compact />
                        ) : live?.state === "active" ? (
                          "Active on web"
                        ) : live?.last_login ? (
                          `Last seen ${ago(live.last_login)}`
                        ) : (
                          "Offline"
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty icon={<Search />} title="No mutual friends match" />
          )}
        </div>
      ) : (
        <Empty icon={<Users />} title="No mutual friends visible" hint="They may have mutuals hidden." />
      )}
    </div>
  );
}

type WorldSort = "alpha" | "favorites" | "online" | "updated";

/** Searchable, sortable world grid shared by the Worlds and Favorite Worlds tabs. */
function WorldList({ worlds }: { worlds: World[] }) {
  const [sort, setSort] = useState<WorldSort>("alpha");
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const shown = worlds
    .filter((w) => !s || w.name.toLowerCase().includes(s) || (w.authorName ?? "").toLowerCase().includes(s))
    .sort((a, b) => {
      if (sort === "favorites") return (b.favorites ?? 0) - (a.favorites ?? 0);
      if (sort === "online") return (b.occupants ?? 0) - (a.occupants ?? 0);
      if (sort === "updated") return Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? "") || 0;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input icon={<Search className="size-4" />} placeholder={`Search ${worlds.length} worlds`} value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
        <Segmented<WorldSort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "alpha", label: "A–Z" },
            { value: "favorites", label: "Most favorited" },
            { value: "online", label: "Most online" },
            { value: "updated", label: "Recently updated" },
          ]}
        />
      </div>
      {shown.length ? (
        <div className={GRID}>
          {shown.map((w) => (
            <WorldCard key={w.id} w={w} />
          ))}
        </div>
      ) : (
        <Empty icon={<Search />} title="No worlds match" />
      )}
    </div>
  );
}

function WorldsTab({ userId }: { userId: string }) {
  const q = useQuery({ queryKey: ["user-worlds", userId], queryFn: () => ipc.userWorlds(userId), staleTime: 10 * 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Empty icon={<Globe />} title="Couldn't load worlds" hint={errorText(q.error)} />;
  if (!q.data?.length) return <Empty icon={<Globe />} title="No public worlds" />;
  return <WorldList worlds={q.data} />;
}

function FavWorldsTab() {
  const q = useQuery({ queryKey: ["worlds", "favorites"], queryFn: () => ipc.worlds("favorites"), staleTime: 5 * 60_000 });
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <Empty icon={<Star />} title="No favorite worlds" />;
  return <WorldList worlds={q.data} />;
}

type AvatarSort = "alpha" | "updated" | "created";
type AvatarRelease = "all" | "public" | "private";

function AvatarsTab() {
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<AvatarSort>("updated");
  const [release, setRelease] = useState<AvatarRelease>("all");
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["avatars", "mine"], queryFn: () => ipc.avatars("mine"), staleTime: 5 * 60_000 });
  if (list.isLoading) return <Loading />;
  if (!list.data?.length) return <Empty icon={<Shirt />} title="No uploaded avatars" />;

  const s = q.trim().toLowerCase();
  const time = (v?: string) => Date.parse(v ?? "") || 0;
  const shown = list.data
    .filter((a) => release === "all" || a.releaseStatus === release)
    .filter((a) => !s || a.name.toLowerCase().includes(s) || (a.description ?? "").toLowerCase().includes(s))
    .sort((a, b) => {
      if (sort === "updated") return time(b.updated_at) - time(a.updated_at);
      if (sort === "created") return time(b.created_at) - time(a.created_at);
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input icon={<Search className="size-4" />} placeholder={`Search ${list.data.length} avatars`} value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
        <Segmented<AvatarSort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "alpha", label: "A–Z" },
            { value: "updated", label: "Recently updated" },
            { value: "created", label: "Newest" },
          ]}
        />
        <Segmented<AvatarRelease>
          value={release}
          onChange={setRelease}
          options={[
            { value: "all", label: "All" },
            { value: "public", label: "Public" },
            { value: "private", label: "Private" },
          ]}
        />
      </div>
      {shown.length ? (
        <div className={GRID}>
          {shown.map((a) => (
            <AvatarCard
              key={a.id}
              a={a}
              busy={busy === a.id}
              onSelect={async () => {
                setBusy(a.id);
                try {
                  await ipc.selectAvatar(a.id);
                  toast.success(`Switched to ${a.name}`);
                } catch (e) {
                  toast.error(errorText(e));
                } finally {
                  setBusy(null);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <Empty icon={<Search />} title="No avatars match" />
      )}
    </div>
  );
}

/** VRChat won't list other people's avatars, so show what the game log saw them wearing. */
function SeenAvatarsTab({ userId, name }: { userId: string; name: string }) {
  const q = useQuery({ queryKey: ["seen-avatars", userId], queryFn: () => ipc.seenAvatars(userId, name) });
  const [s, setS] = useState("");
  const list = (q.data ?? []).filter((a) => !s.trim() || a.name.toLowerCase().includes(s.trim().toLowerCase()));
  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">
        Avatars you've seen {name} wearing in your instances. VRChat doesn't let anyone browse another player's uploaded avatars, so
        this comes from your game log.
      </p>
      {q.isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !q.data?.length ? (
        <Empty icon={<Shirt />} title="No avatars seen yet" hint="When you're in an instance with them, avatar switches show up here." />
      ) : (
        <>
          <Input icon={<Search className="size-4" />} placeholder={`Search ${q.data.length} avatars`} value={s} onChange={(e) => setS(e.target.value)} className="mb-3 w-64" />
          <div className="overflow-hidden rounded-xl border border-line">
            {list.map((a) => (
              <div key={a.name} className="flex items-center gap-3 border-b border-line/60 px-3 py-2.5 text-[13px] last:border-0">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-subtle">
                  <Shirt className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{a.name}</div>
                  <div className="truncate text-xs text-subtle">
                    {a.times > 1 ? `Seen ${a.times} times · first ${ago(a.firstSeen)}` : "Seen once"}
                    {a.lastLocation && (
                      <>
                        {" · "}
                        <LocationLabel location={a.lastLocation} compact />
                      </>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted">{ago(a.lastSeen)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ActivityTab({ history }: { history?: UserHistory }) {
  const openSession = useUi((s) => s.openSession);
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Recent encounters</SectionTitle>
        {history?.recent.length ? (
          <div className="overflow-hidden rounded-xl border border-line">
            {history.recent.map((r) => (
              <button
                key={r.ts}
                onClick={() => r.sessionTs != null && openSession(r.sessionTs)}
                disabled={r.sessionTs == null}
                title={r.sessionTs != null ? "Open this session in the Game Log" : undefined}
                className="group flex w-full items-center gap-3 border-b border-line/60 px-3 py-2 text-left text-[13px] last:border-0 enabled:hover:bg-hover/50 enabled:cursor-pointer"
              >
                <span className="w-40 shrink-0 text-xs text-subtle">{dateTime(r.ts)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <LocationLabel location={r.location} worldName={r.worldName} compact />
                </span>
                <span className="text-xs tabular-nums text-muted">{duration(r.durationMs)}</span>
                {r.sessionTs != null && <ScrollText className="size-3.5 shrink-0 text-subtle transition-colors group-hover:text-accent" />}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-subtle">No shared instances in the game log yet.</p>
        )}
      </div>
      <div>
        <SectionTitle>Feed history</SectionTitle>
        {history?.feed.length ? (
          <div className="overflow-hidden rounded-xl border border-line">
            {history.feed.map((e) => (
              <FeedRow key={e.id} e={e} showName={false} />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-subtle">No recorded activity yet.</p>
        )}
      </div>
    </div>
  );
}

function JsonTab({ u, p }: { u: VrcUser; p?: VrcProfile }) {
  const text = JSON.stringify({ user: u, profile: p }, null, 2);
  return (
    <div className="space-y-2">
      <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied JSON"))}>
        Copy JSON
      </Button>
      <pre className="selectable overflow-auto rounded-xl bg-panel-2 p-4 text-[11.5px] leading-relaxed text-muted">{text}</pre>
    </div>
  );
}

import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  ChartColumn,
  ChevronsLeft,
  ChevronsRight,
  Globe,
  House,
  PanelRightClose,
  PanelRightOpen,
  ScrollText,
  Search,
  Settings,
  Shirt,
  Users,
  Check,
  Package,
  UsersRound,
  Group,
  CircleUserRound,
  Contact,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn, STATUS_COLOR, STATUS_LABEL } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import type { Status } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useLive } from "@/stores/live";
import { useUi, type Page } from "@/stores/ui";
import { UserAvatar } from "./people";
import { Button, Tip } from "./ui";

const NAV: { page: Page; label: string; icon: ReactNode }[] = [
  { page: "home", label: "Home", icon: <House className="size-[18px]" /> },
  { page: "friends", label: "Friends", icon: <Users className="size-[18px]" /> },
  { page: "feed", label: "Feed", icon: <Activity className="size-[18px]" /> },
  { page: "players", label: "Players", icon: <Contact className="size-[18px]" /> },
  { page: "gamelog", label: "Game Log", icon: <ScrollText className="size-[18px]" /> },
  { page: "worlds", label: "Worlds", icon: <Globe className="size-[18px]" /> },
  { page: "groups", label: "Groups", icon: <Group className="size-[18px]" /> },
  { page: "groupInstances", label: "Group Instances", icon: <UsersRound className="size-[18px]" /> },
  { page: "avatars", label: "Avatars", icon: <Shirt className="size-[18px]" /> },
  { page: "inventory", label: "Inventory", icon: <Package className="size-[18px]" /> },
  { page: "insights", label: "Insights", icon: <ChartColumn className="size-[18px]" /> },
];

export function Sidebar() {
  const { page, go, collapsed, toggleCollapsed } = useUi();
  const online = useFriends((s) => Object.values(s.byId).filter((f) => f.state === "online").length);
  const here = useLive((s) => (s.instance.location ? s.instance.players.length : 0));
  // Same query as the Groups page, so joining or leaving anywhere updates the badge.
  const meId = useAuth((s) => s.user?.id);
  const groups = useQuery({
    queryKey: ["groups", meId],
    queryFn: () => ipc.userGroups(meId!),
    enabled: !!meId,
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  // Shared with the Group Instances page; instances open and close often, so poll gently.
  const groupInstances = useQuery({
    queryKey: ["my-group-instances"],
    queryFn: ipc.myGroupInstances,
    enabled: !!meId,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  const item = (p: Page, label: string, icon: ReactNode, badge?: number) => {
    // Friend Alerts lives under Settings, so keep Settings lit while it is open.
    const active = page === p || (p === "settings" && page === "alerts");
    const btn = (
      <button
        key={p}
        onClick={() => go(p)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors cursor-pointer",
          active ? "bg-accent-soft text-fg" : "text-muted hover:bg-hover hover:text-fg",
          collapsed && "justify-center px-0",
        )}
      >
        {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-accent" />}
        <span className={active ? "text-accent" : ""}>{icon}</span>
        {!collapsed && <span className="flex-1 text-left">{label}</span>}
        {!!badge && (
          <span
            className={cn(
              "rounded-full bg-accent px-1.5 text-[10px] font-bold leading-4 text-accent-fg tabular-nums",
              collapsed && "absolute right-1 top-1",
            )}
          >
            {badge}
          </span>
        )}
      </button>
    );
    return collapsed ? (
      <Tip key={p} label={label} side="right">
        {btn}
      </Tip>
    ) : (
      btn
    );
  };

  return (
    <nav className={cn("flex shrink-0 flex-col border-r border-line bg-panel/60 p-2 transition-[width]", collapsed ? "w-[60px]" : "w-[212px]")}>
      <div className={cn("mb-4 flex h-10 items-center gap-2.5 px-2", collapsed && "justify-center px-0")}>
        <img src="/logo.svg" alt="" className="size-7" />
        {!collapsed && <span className="text-[15px] font-bold tracking-tight">Nexus</span>}
      </div>
      <div className="flex flex-col gap-0.5">
        {NAV.map((n) =>
          item(n.page, n.label, n.icon, n.page === "friends" && !collapsed
              ? online
              : n.page === "players" && !collapsed
                ? here
                : n.page === "groups" && !collapsed
                  ? groups.data?.length
                  : n.page === "groupInstances" && !collapsed
                    ? groupInstances.data?.length
                    : undefined),
        )}
      </div>
      <div className="mt-auto flex flex-col gap-0.5">
        {item("settings", "Settings", <Settings className="size-[18px]" />)}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] text-subtle hover:bg-hover hover:text-fg cursor-pointer",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? <ChevronsRight className="size-[18px]" /> : <ChevronsLeft className="size-[18px]" />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </nav>
  );
}

const STATUSES: Status[] = ["join me", "active", "ask me", "busy"];

function StatusPicker() {
  const user = useAuth((s) => s.user);
  const updateUser = useAuth((s) => s.updateUser);
  const openUser = useUi((s) => s.openUser);
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = async (status: Status, description?: string) => {
    setBusy(true);
    try {
      const u = await ipc.setStatus(status, description);
      updateUser(u);
      toast.success(`Status set to ${STATUS_LABEL[status]}`);
      setOpen(false);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDesc(user.statusDescription ?? "");
      }}
    >
      <Popover.Trigger asChild>
        <button className="flex h-9 items-center gap-2.5 rounded-lg pl-1 pr-3 hover:bg-hover cursor-pointer">
          <UserAvatar user={{ ...user, state: "online" }} size={28} />
          <div className="text-left leading-tight">
            <div className="max-w-[140px] truncate text-[13px] font-semibold">{user.displayName}</div>
            <div className="max-w-[140px] truncate text-[11px] text-muted">
              {user.statusDescription || STATUS_LABEL[user.status ?? "active"]}
            </div>
          </div>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-xl border border-line bg-panel p-2 shadow-pop outline-none"
        >
          <button
            onClick={() => {
              setOpen(false);
              openUser(user.id);
            }}
            className="mb-1 flex h-9 w-full items-center gap-3 rounded-lg px-2 text-[13px] font-medium hover:bg-hover cursor-pointer"
          >
            <CircleUserRound className="size-4 text-muted" /> View my profile
          </button>
          <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-subtle">Status</div>
          {STATUSES.map((s) => (
            <button
              key={s}
              disabled={busy}
              onClick={() => apply(s)}
              className="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-[13px] hover:bg-hover cursor-pointer"
            >
              <span className={cn("size-2.5 rounded-full", STATUS_COLOR[s])} />
              <span className="flex-1 text-left">{STATUS_LABEL[s]}</span>
              {user.status === s && <Check className="size-4 text-accent" />}
            </button>
          ))}
          <form
            className="mt-2 flex gap-2 border-t border-line px-1 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              apply(user.status ?? "active", desc);
            }}
          >
            <input
              value={desc}
              maxLength={32}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What are you up to?"
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 text-[13px] outline-none focus:border-accent"
            />
            <Button size="sm" variant="primary" type="submit" loading={busy}>
              Save
            </Button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TopBar() {
  const { setPalette, rail, toggleRail, go, page } = useUi();
  const pipeline = useLive((s) => s.pipeline);
  const unread = useLive((s) => s.unread);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
      <button
        onClick={() => setPalette(true)}
        className="flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-line bg-panel px-3 text-[13px] text-subtle hover:border-accent/40 hover:text-muted cursor-pointer"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search friends, worlds, actions…</span>
        <kbd className="rounded border border-line bg-panel-2 px-1.5 text-[11px] font-medium">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Tip label={pipeline ? "Live updates connected" : "Live updates reconnecting…"}>
          <span className="mr-2 flex items-center gap-1.5 text-xs text-muted">
            <span className={cn("size-2 rounded-full", pipeline ? "bg-st-active shadow-[0_0_8px] shadow-st-active" : "bg-st-ask animate-pulse")} />
            {pipeline ? "Live" : "Connecting"}
          </span>
        </Tip>
        <Tip label={unread ? `Notifications · ${unread} new` : "Notifications"}>
          <button
            onClick={() => go("notifications")}
            aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
            aria-current={page === "notifications" ? "page" : undefined}
            className={cn(
              "relative inline-flex size-9 items-center justify-center rounded-lg transition-colors cursor-pointer",
              page === "notifications" ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <Bell className="size-[18px]" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 tabular-nums text-accent-fg ring-2 ring-bg">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </Tip>
        <Tip label={rail ? "Hide friends panel" : "Show friends panel"}>
          <button
            onClick={toggleRail}
            aria-label="Toggle friends panel"
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg cursor-pointer"
          >
            {rail ? <PanelRightClose className="size-[18px]" /> : <PanelRightOpen className="size-[18px]" />}
          </button>
        </Tip>
        <div className="mx-1 h-6 w-px bg-line" />
        <StatusPicker />
      </div>
    </header>
  );
}

import { Command } from "cmdk";
import * as RDialog from "@radix-ui/react-dialog";
import { Globe, LogIn, MailPlus, Search, Send, Settings, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn, sortByName, STATUS_COLOR, STATUS_LABEL } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useUi, type Page } from "@/stores/ui";
import type { Status } from "@/lib/types";
import { actions, LocationLabel, UserAvatar } from "./people";

const PAGES: { page: Page; label: string }[] = [
  { page: "home", label: "Home" },
  { page: "friends", label: "Friends" },
  { page: "feed", label: "Feed" },
  { page: "players", label: "Players" },
  { page: "gamelog", label: "Game Log" },
  { page: "worlds", label: "Worlds" },
  { page: "groups", label: "Groups" },
  { page: "groupInstances", label: "Group Instances" },
  { page: "avatars", label: "Avatars" },
  { page: "inventory", label: "Inventory" },
  { page: "notifications", label: "Notifications" },
  { page: "alerts", label: "Friend Alerts" },
  { page: "insights", label: "Insights" },
  { page: "settings", label: "Settings" },
];

const itemCls =
  "flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-[13px] text-muted data-[selected=true]:bg-accent-soft data-[selected=true]:text-fg";

export function CommandPalette() {
  const { paletteOpen: open, setPalette, go, openUser, search } = useUi();
  const byId = useFriends((s) => s.byId);
  const updateUser = useAuth((s) => s.updateUser);
  const myId = useAuth((s) => s.user?.id);
  const [value, setValue] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!useUi.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette]);

  const friends = useMemo(() => {
    const order = { online: 0, active: 1, offline: 2 } as const;
    return Object.values(byId).sort((a, b) => order[a.state ?? "offline"] - order[b.state ?? "offline"] || sortByName(a, b));
  }, [byId]);

  const close = () => {
    setPalette(false);
    setValue("");
  };
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  // Keep the list snappy: show everyone online, but only matching offline friends.
  const shown = value ? friends.slice(0, 400) : friends.filter((f) => f.state === "online").slice(0, 30);

  return (
    <RDialog.Root open={open} onOpenChange={(o) => (o ? setPalette(true) : close())}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <RDialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[14vh] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
        >
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <Command loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-subtle" />
              <Command.Input
                autoFocus
                value={value}
                onValueChange={setValue}
                placeholder="Type a friend, page or action…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
              />
            </div>
            <Command.List className="max-h-[56vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-subtle">No matches.</Command.Empty>

              {value.trim().length >= 2 && (
                <Command.Group heading="Search VRChat" className="cmdk-group">
                  <Command.Item value={`search vrchat ${value}`} onSelect={run(() => search(value.trim()))} className={itemCls}>
                    <Globe className="size-4" /> Search users &amp; worlds for “{value.trim()}”
                  </Command.Item>
                </Command.Group>
              )}

              <Command.Group heading="Friends" className="cmdk-group">
                {shown.map((f) => (
                  <Command.Item key={f.id} value={`${f.displayName} ${f.id}`} onSelect={run(() => openUser(f.id))} className={itemCls}>
                    <UserAvatar user={f} size={26} />
                    <span className="font-medium text-fg">{f.displayName}</span>
                    {f.state === "online" && (
                      <span className="min-w-0 flex-1 truncate text-xs">
                        <LocationLabel location={f.location} worldName={f.$worldName} compact />
                      </span>
                    )}
                    {f.state === "online" && actions.canJoin(f.location) && (
                      <LogIn className="ml-auto size-3.5 text-subtle" />
                    )}
                  </Command.Item>
                ))}
              </Command.Group>

              {value && (
                <Command.Group heading="Quick actions" className="cmdk-group">
                  {shown
                    .filter((f) => f.state === "online")
                    .slice(0, 6)
                    .flatMap((f) => [
                      <Command.Item key={`inv-${f.id}`} value={`invite ${f.displayName}`} onSelect={run(() => actions.invite(f))} className={itemCls}>
                        <Send className="size-4" /> Invite {f.displayName}
                      </Command.Item>,
                      <Command.Item key={`req-${f.id}`} value={`request invite ${f.displayName}`} onSelect={run(() => actions.requestInvite(f))} className={itemCls}>
                        <MailPlus className="size-4" /> Request invite from {f.displayName}
                      </Command.Item>,
                      ...(actions.canJoin(f.location)
                        ? [
                            <Command.Item key={`join-${f.id}`} value={`join ${f.displayName}`} onSelect={run(() => actions.join(f.location!))} className={itemCls}>
                              <LogIn className="size-4" /> Join {f.displayName}
                            </Command.Item>,
                          ]
                        : []),
                    ])}
                </Command.Group>
              )}

              <Command.Group heading="Set status" className="cmdk-group">
                {(["join me", "active", "ask me", "busy"] as Status[]).map((s) => (
                  <Command.Item
                    key={s}
                    value={`status ${STATUS_LABEL[s]}`}
                    onSelect={run(async () => updateUser(await ipc.setStatus(s)))}
                    className={itemCls}
                  >
                    <span className={cn("size-2.5 rounded-full", STATUS_COLOR[s])} /> Set status: {STATUS_LABEL[s]}
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Go to" className="cmdk-group">
                {myId && (
                  <Command.Item value="my profile me" onSelect={run(() => openUser(myId))} className={itemCls}>
                    <Sparkles className="size-4" /> My profile
                  </Command.Item>
                )}
                {PAGES.map((p) => (
                  <Command.Item key={p.page} value={`go ${p.label}`} onSelect={run(() => go(p.page))} className={itemCls}>
                    {p.page === "settings" ? <Settings className="size-4" /> : <Sparkles className="size-4" />} {p.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

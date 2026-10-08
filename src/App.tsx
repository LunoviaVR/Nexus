import { listen as tauriListen, type EventCallback } from "@tauri-apps/api/event";
import { fixDeep } from "@/lib/text";

/** Live events get the same punctuation fix as command results. */
const listen = <T,>(event: string, cb: EventCallback<T>) => tauriListen<T>(event, (e) => cb({ ...e, payload: fixDeep(e.payload) }));
import * as RTooltip from "@radix-ui/react-tooltip";
import { motion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { FriendsRail } from "@/components/FriendsRail";
import { Sidebar, TopBar } from "@/components/Shell";
import { UserDialog } from "@/components/UserDialog";
import { WorldDialog } from "@/components/WorldDialog";
import { GroupDialog } from "@/components/GroupDialog";
import { AvatarDialog } from "@/components/AvatarDialog";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { errorText, ipc } from "@/lib/ipc";
import { applyLogin } from "@/lib/session";
import { useUpdateChecks } from "@/lib/updates";
import type { CurrentUser, FeedEntry, GlEvent, InstanceState, VrcNotification, VrcUser } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useLive } from "@/stores/live";
import { useUi, type Page } from "@/stores/ui";
import { Login } from "@/pages/Login";
import { Home } from "@/pages/Home";
import { Friends } from "@/pages/Friends";
import { Feed } from "@/pages/Feed";
import { GameLog } from "@/pages/GameLog";
import { Players } from "@/pages/Players";
import { Worlds } from "@/pages/Worlds";
import { GroupInstances } from "@/pages/GroupInstances";
import { Groups } from "@/pages/Groups";
import { Avatars } from "@/pages/Avatars";
import { Inventory } from "@/pages/Inventory";
import { Search } from "@/pages/Search";
import { Notifications } from "@/pages/Notifications";
import { Alerts } from "@/pages/Alerts";
import { Insights } from "@/pages/Insights";
import { SettingsPage } from "@/pages/Settings";

const PAGES: Record<Page, () => ReactNode> = {
  home: Home,
  friends: Friends,
  feed: Feed,
  gamelog: GameLog,
  players: Players,
  worlds: Worlds,
  groups: Groups,
  groupInstances: GroupInstances,
  avatars: Avatars,
  inventory: Inventory,
  search: Search,
  notifications: Notifications,
  alerts: Alerts,
  insights: Insights,
  settings: SettingsPage,
};


function useTheme() {
  const theme = useUi((s) => s.theme);
  const hue = useUi((s) => s.accentHue);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const light = theme === "light" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("light", light);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent-h", String(hue));
  }, [hue]);
}

/** Bridge backend events into the stores. */
function useBackendEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const friends = useFriends.getState();
    const live = useLive.getState();
    const auth = useAuth.getState();
    const subs = [
      listen<VrcUser[]>("friends:snapshot", (e) => friends.setSnapshot(e.payload)),
      listen<VrcUser>("friend:update", (e) => friends.upsert(e.payload)),
      listen<string>("friend:remove", (e) => friends.remove(e.payload)),
      listen<string[]>("favorites:update", (e) => friends.setFavorites(e.payload)),
      listen<string[]>("watched:update", (e) => friends.setWatched(e.payload)),
      listen<CurrentUser>("user:update", (e) => auth.updateUser(e.payload)),
      listen<FeedEntry>("feed:new", (e) => live.pushFeed(e.payload)),
      listen<GlEvent>("gamelog:event", (e) => live.pushGamelog(e.payload)),
      listen<InstanceState>("gamelog:instance", (e) => live.setInstance(e.payload)),
      listen<boolean>("pipeline:status", (e) => live.setPipeline(e.payload)),
      listen("groups:changed", () => qc.invalidateQueries({ queryKey: ["groups", useAuth.getState().user?.id] })),
      listen<VrcNotification>("notification:new", (e) => live.pushNotification(e.payload)),
      listen("session:ready", async () => {
        const { friends: list, favorites } = await ipc.friends();
        friends.setSnapshot(list);
        friends.setFavorites(favorites);
        ipc.watchList().then(friends.setWatched, () => {});
        ipc.notifications().then(live.setNotifications, () => {});
      }),
      listen("session:expired", () => {
        toast.error("Your VRChat session expired. Please sign in again.");
        friends.reset();
        live.reset();
        auth.loggedOut(null);
      }),
    ];
    ipc.currentInstance().then(live.setInstance, () => {});
    return () => subs.forEach((p) => p.then((un) => un()));
  }, [qc]);
}

function Main() {
  const page = useUi((s) => s.page);
  const rail = useUi((s) => s.rail);
  const Page = PAGES[page] ?? Home;
  useUpdateChecks();
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1 overflow-y-auto">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="mx-auto max-w-[1400px] px-6 py-5"
            >
              <ErrorBoundary resetKey={page}>
                <Page />
              </ErrorBoundary>
            </motion.div>
          </main>
          {rail && <FriendsRail />}
        </div>
      </div>
      <UserDialog />
      <WorldDialog />
      <GroupDialog />
      <AvatarDialog />
      <EditProfileDialog />
      <CommandPalette />
    </div>
  );
}

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <img src="/logo.svg" alt="" className="size-14 animate-pulse" />
      <p className="text-[13px] text-muted">Connecting to VRChatâ€¦</p>
    </div>
  );
}

let booted = false;

export default function App() {
  const phase = useAuth((s) => s.phase);
  useTheme();
  useBackendEvents();

  useEffect(() => {
    // StrictMode runs effects twice in dev; only restore the session once.
    if (booted) return;
    booted = true;
    ipc.restore().then(applyLogin, (e) => {
      toast.error(errorText(e));
      useAuth.getState().loggedOut(null);
    });
  }, []);

  return (
    <RTooltip.Provider>
      {phase === "booting" ? <Splash /> : phase === "ready" ? <Main /> : <Login />}
      <Toaster
        position="bottom-right"
        theme={useUi.getState().theme === "light" ? "light" : "dark"}
        toastOptions={{ className: "!bg-panel !border-line !text-fg" }}
      />
    </RTooltip.Provider>
  );
}

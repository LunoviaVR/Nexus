import { useQuery, useQueryClient } from "@tanstack/react-query";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { open as pickFolder, save as saveFile } from "@tauri-apps/plugin-dialog";
import { BellRing, ChevronRight, CircleAlert, CircleCheck, Download, ExternalLink, FolderOpen, LogOut, Monitor, Moon, RefreshCw, RotateCcw, ShieldCheck, Sun, Trash2, Unlock, UserRoundCog } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Card, Confirm, Img, Input, PageHeader, Segmented, Switch } from "@/components/ui";
import { cn } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import { applyLogin, clearSession } from "@/lib/session";
import { checkForUpdate, installUpdate, RELEASES_URL } from "@/lib/updates";
import type { AppSettings, Scope } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useFriends } from "@/stores/friends";
import { useUi, type Theme } from "@/stores/ui";

const HUES = [290, 260, 220, 190, 160, 130, 60, 25, 350];

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 border-b border-line/60 px-4 py-3.5 last:border-0">
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-[13px] font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      <div className="max-w-full shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h2>
      <Card>{children}</Card>
    </section>
  );
}

function FolderRow({
  title,
  hint,
  info,
  onPick,
  onReset,
}: {
  title: string;
  hint: ReactNode;
  info?: { current?: string | null; default?: string | null };
  onPick: (dir: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const shown = info?.current || info?.default || "";
  const browse = async () => {
    const dir = await pickFolder({ directory: true, defaultPath: shown || undefined, title });
    if (typeof dir === "string") {
      try {
        await onPick(dir);
      } catch (e) {
        toast.error(errorText(e));
      }
    }
  };
  return (
    <div className="space-y-2 border-b border-line/60 px-4 py-3.5 last:border-0">
      <div>
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{hint}</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="selectable min-w-0 flex-1 truncate rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs" title={shown}>
          {shown || "—"}
          {!info?.current && shown && <span className="ml-2 font-sans text-subtle">(default)</span>}
        </div>
        <Button size="sm" onClick={browse}>
          Browse…
        </Button>
        <Button size="sm" variant="ghost" icon={<FolderOpen className="size-3.5" />} disabled={!shown} onClick={() => ipc.openFolder(shown).catch((e) => toast.error(errorText(e)))}>
          Open
        </Button>
        {info?.current && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw className="size-3.5" />}
            onClick={() => onReset().catch((e) => toast.error(errorText(e)))}
          >
            Default
          </Button>
        )}
      </div>
    </div>
  );
}

const SCOPES = [
  { value: "off" as Scope, label: "Off" },
  { value: "favorites" as Scope, label: "Favorites" },
  { value: "all" as Scope, label: "All friends" },
];

export function SettingsPage() {
  const { theme, setTheme, accentHue, setAccent, friendsLayout, setFriendsLayout, go } = useUi();
  const watchedCount = useFriends((st) => st.watched.size);
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: ipc.settings });
  const defaultDir = useQuery({ queryKey: ["logdir"], queryFn: ipc.defaultLogDir });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: ipc.accounts });
  const photoDir = useQuery({ queryKey: ["photo-dir"], queryFn: ipc.photoDir, retry: false });
  const ugcDir = useQuery({ queryKey: ["ugc-dir"], queryFn: ipc.ugcDir });
  const vrchat = useQuery({ queryKey: ["vrchat-install"], queryFn: ipc.vrchatInstall });
  const update = useQuery({ queryKey: ["update"], queryFn: () => checkForUpdate({ quiet: true }), retry: false, staleTime: 10 * 60_000 });
  const [exporting, setExporting] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const exportDecrypted = async () => {
    const path = await saveFile({
      title: "Save a decrypted copy of your Nexus data",
      defaultPath: `nexus-decrypted-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: "SQLite database", extensions: ["db"] }],
    });
    if (!path) return;
    setExporting(true);
    try {
      await ipc.exportDecrypted(path);
      toast.success("Decrypted copy saved", { description: "Anyone with this file can read it. Delete it when you're done.", action: { label: "Show", onClick: () => ipc.reveal(path) } });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setExporting(false);
    }
  };
  const [checking, setChecking] = useState(false);
  const vrcx = useQuery({ queryKey: ["vrcx-detect"], queryFn: ipc.vrcxDetect });
  const [importing, setImporting] = useState(false);
  const importVrcx = async (path?: string) => {
    setImporting(true);
    try {
      const r = await ipc.vrcxImport(path);
      const parts = [
        r.feed && `${r.feed.toLocaleString()} feed events`,
        r.worlds && `${r.worlds.toLocaleString()} world visits`,
        r.events && `${r.events.toLocaleString()} game log events`,
        r.friendDates && `${r.friendDates} "friends since" dates`,
        r.memos && `${r.memos} memos`,
      ].filter(Boolean);
      if (parts.length) toast.success("Imported from VRCX", { description: parts.join(" · ") });
      else toast.success("Nothing new to import", { description: "Everything older than Nexus's own history is already here." });
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setImporting(false);
    }
  };
  const chooseVrcx = async () => {
    const file = await pickFolder({ multiple: false, directory: false, title: "Choose VRCX.sqlite3", filters: [{ name: "VRCX database", extensions: ["sqlite3", "db"] }] });
    if (typeof file === "string") await importVrcx(file);
  };
  const [autostart, setAutostart] = useState(false);
  const [logDir, setLogDir] = useState("");

  useEffect(() => {
    autostartEnabled().then(setAutostart, () => {});
  }, []);
  useEffect(() => setLogDir(settings.data?.logDir ?? ""), [settings.data?.logDir]);

  const save = async (patch: Partial<AppSettings>) => {
    if (!settings.data) return;
    const next = { ...settings.data, ...patch };
    qc.setQueryData(["settings"], next);
    try {
      await ipc.saveSettings(next);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const exportCsv = async (kind: "feed" | "gamelog" | "worlds" | "friends") => {
    try {
      const path = await ipc.exportCsv(kind);
      toast.success("Export saved", { action: { label: "Show", onClick: () => ipc.reveal(path) } });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const s = settings.data;
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" />

      <Section title="Appearance">
        <Row title="Theme">
          <Segmented<Theme>
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" /> Dark</span> },
              { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-3.5" /> Light</span> },
              { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" /> System</span> },
            ]}
          />
        </Row>
        <Row title="Accent color">
          <div className="flex gap-1.5">
            {HUES.map((h) => (
              <button
                key={h}
                aria-label={`Accent hue ${h}`}
                onClick={() => setAccent(h)}
                className={cn("size-6 rounded-full ring-offset-2 ring-offset-panel cursor-pointer", accentHue === h && "ring-2 ring-fg")}
                style={{ background: `oklch(0.68 0.17 ${h})` }}
              />
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Friends list">
        <Row title="Group friends by" hint="How the friends panel on the right is organized.">
          <Segmented
            value={friendsLayout.groupBy}
            onChange={(v) => setFriendsLayout({ groupBy: v })}
            options={[
              { value: "instance", label: "Instance" },
              { value: "status", label: "Status" },
              { value: "none", label: "No groups" },
            ]}
          />
        </Row>
        <Row title="Sort friends" hint="Also the default sort on the Friends page.">
          <Segmented
            value={friendsLayout.sort}
            onChange={(v) => setFriendsLayout({ sort: v })}
            options={[
              { value: "name", label: "A–Z" },
              { value: "recent", label: "Recently active" },
            ]}
          />
        </Row>
        <Row title="Favorites at the top">
          <Switch checked={friendsLayout.favoritesFirst} onChange={(v) => setFriendsLayout({ favoritesFirst: v })} label="Favorites at the top" />
        </Row>
        <Row title="Show friends active on the website">
          <Switch checked={friendsLayout.showWeb} onChange={(v) => setFriendsLayout({ showWeb: v })} label="Show friends active on the website" />
        </Row>
        <Row title="Show offline friends">
          <Switch checked={friendsLayout.showOffline} onChange={(v) => setFriendsLayout({ showOffline: v })} label="Show offline friends" />
        </Row>
      </Section>

      {s && (
        <Section title="Notifications">
          <Row title="Friend comes online">
            <Segmented value={s.notifyOnline} onChange={(v) => save({ notifyOnline: v })} options={SCOPES} />
          </Row>
          <Row title="Friend goes offline">
            <Segmented value={s.notifyOffline} onChange={(v) => save({ notifyOffline: v })} options={SCOPES} />
          </Row>
          <Row title="Friend joins your instance" hint="Detected from the game log.">
            <Segmented value={s.notifyInstanceJoin} onChange={(v) => save({ notifyInstanceJoin: v })} options={SCOPES} />
          </Row>
          <Row
            title="Friend alerts"
            hint={
              watchedCount
                ? `Online and offline alerts for ${watchedCount} ${watchedCount === 1 ? "friend" : "friends"}, set with the bell on their profile.`
                : "Ring the bell on a friend's profile to get alerts when they come online or go offline."
            }
          >
            <Button size="sm" icon={<BellRing className="size-3.5" />} onClick={() => go("alerts")}>
              Manage
              <ChevronRight className="-mr-1 size-3.5" />
            </Button>
          </Row>
          <Row title="Invites" hint="Someone invites you to their instance.">
            <Switch checked={s.notifyInvites} onChange={(v) => save({ notifyInvites: v })} label="Invites" />
          </Row>
          <Row title="Invite requests" hint="Someone asks you for an invite.">
            <Switch checked={s.notifyInviteRequests} onChange={(v) => save({ notifyInviteRequests: v })} label="Invite requests" />
          </Row>
          <Row title="Boops">
            <Switch checked={s.notifyBoops} onChange={(v) => save({ notifyBoops: v })} label="Boops" />
          </Row>
          <Row title="Friend requests">
            <Switch checked={s.notifyFriendRequests} onChange={(v) => save({ notifyFriendRequests: v })} label="Friend requests" />
          </Row>
          <Row title="New friends" hint="A friend request was accepted.">
            <Switch checked={s.notifyNewFriends} onChange={(v) => save({ notifyNewFriends: v })} label="New friends" />
          </Row>
          <Row title="Unfriends" hint="Someone is no longer on your friends list.">
            <Switch checked={s.notifyUnfriends} onChange={(v) => save({ notifyUnfriends: v })} label="Unfriends" />
          </Row>
        </Section>
      )}

      {s && (
        <Section title="Behavior">
          <Row title="Start with Windows" hint="Starts minimized to the tray.">
            <Switch
              checked={autostart}
              label="Start with Windows"
              onChange={async (v) => {
                try {
                  if (v) await enableAutostart();
                  else await disableAutostart();
                  setAutostart(v);
                } catch (e) {
                  toast.error(errorText(e));
                }
              }}
            />
          </Row>
          <Row title="Close to tray" hint="Keep tracking friends and the game log when the window is closed.">
            <Switch checked={s.minimizeToTray} onChange={(v) => save({ minimizeToTray: v })} label="Close to tray" />
          </Row>
          <div className="space-y-2 px-4 py-3.5">
            <div className="text-[13px] font-medium">VRChat log folder</div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                save({ logDir: logDir.trim() || null });
                toast.success("Log folder saved");
              }}
            >
              <Input value={logDir} onChange={(e) => setLogDir(e.target.value)} placeholder={defaultDir.data ?? "Default"} className="flex-1" />
              <Button type="submit">Save</Button>
            </form>
            <p className="text-xs text-muted">Leave empty to use the default location.</p>
          </div>
        </Section>
      )}

      {s && (
        <Section title="VRChat">
          <FolderRow
            title="VRChat install folder"
            hint="Found automatically from Steam or the Meta app. Used to start VRChat when you join an instance."
            info={vrchat.data}
            onPick={async (dir) => {
              await ipc.setVrchatDir(dir);
              await Promise.all([vrchat.refetch(), qc.invalidateQueries({ queryKey: ["settings"] })]);
              toast.success("VRChat folder saved");
            }}
            onReset={async () => {
              await ipc.setVrchatDir(null);
              await Promise.all([vrchat.refetch(), qc.invalidateQueries({ queryKey: ["settings"] })]);
            }}
          />
          <Row
            title="vrchat:// links"
            hint={
              vrchat.data?.linksOk
                ? "Windows knows how to open VRChat links from Nexus and the website."
                : "Windows can't open VRChat links, usually because VRChat moved. Join still works from Nexus; repair to fix website links too."
            }
          >
            {vrchat.data?.linksOk ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-st-active">
                <CircleCheck className="size-4" /> Working
              </span>
            ) : (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-[13px] text-st-ask">
                  <CircleAlert className="size-4" /> Broken
                </span>
                <Button
                  size="sm"
                  disabled={!vrchat.data?.current && !vrchat.data?.default}
                  onClick={async () => {
                    try {
                      await ipc.repairVrchatLinks();
                      await vrchat.refetch();
                      toast.success("VRChat links repaired");
                    } catch (e) {
                      toast.error(errorText(e));
                    }
                  }}
                >
                  Repair
                </Button>
              </div>
            )}
          </Row>
        </Section>
      )}

      {s && (
        <Section title="Photos & saved content">
          <FolderRow
            title="VRChat photo folder"
            hint={
              photoDir.error
                ? errorText(photoDir.error)
                : "Where VRChat saves pictures from the in-game camera. Changes VRChat's config.json and applies the next time VRChat starts."
            }
            info={photoDir.data}
            onPick={async (dir) => {
              await ipc.setPhotoDir(dir);
              await photoDir.refetch();
              toast.success("Photo folder changed — restart VRChat to apply");
            }}
            onReset={async () => {
              await ipc.setPhotoDir(null);
              await photoDir.refetch();
              toast.success("VRChat will use its default photo folder");
            }}
          />
          <Row title="Save other players' prints" hint="When someone shows a print in your instance, keep a copy.">
            <Switch checked={s.savePrints} onChange={(v) => save({ savePrints: v })} label="Save other players' prints" />
          </Row>
          <Row title="Save other players' stickers" hint="Keep copies of custom stickers people spawn around you.">
            <Switch checked={s.saveStickers} onChange={(v) => save({ saveStickers: v })} label="Save other players' stickers" />
          </Row>
          <FolderRow
            title="Saved prints & stickers folder"
            hint="Organized into Prints and Stickers, then by month."
            info={ugcDir.data}
            onPick={async (dir) => {
              await save({ ugcDir: dir });
              await ugcDir.refetch();
              toast.success("Saved content folder changed");
            }}
            onReset={async () => {
              await save({ ugcDir: null });
              await ugcDir.refetch();
            }}
          />
        </Section>
      )}

      <Section title="Updates">
        <Row
          title={update.data?.available ? `Nexus ${update.data.available.version} is available` : "Nexus is up to date"}
          hint={
            update.data
              ? `You're on ${update.data.current}. Nexus checks GitHub for new releases at launch and every 30 minutes.`
              : "Checking…"
          }
        >
          {update.data?.available ? (
            <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} onClick={installUpdate}>
              Install & restart
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<RefreshCw className="size-3.5" />}
              loading={checking}
              onClick={async () => {
                setChecking(true);
                const info = await checkForUpdate();
                if (info) qc.setQueryData(["update"], info);
                setChecking(false);
              }}
            >
              Check now
            </Button>
          )}
        </Row>
        <Row title="What's new" hint="Release notes for every version are on GitHub.">
          <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => ipc.openExternal(RELEASES_URL)}>
            Release notes
          </Button>
        </Row>
      </Section>

      <Section title="Privacy">
        <Row
          title="Encrypted on this PC"
          hint="Your history, memos and cached images are encrypted with a key kept in Windows Credential Manager. Other apps, and anyone browsing your files, only see scrambled data."
        >
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-st-active">
            <ShieldCheck className="size-3.5" /> On
          </span>
        </Row>
        <Row title="Export decrypted copy" hint="Saves a readable copy of the database (SQLite) where you choose, for backups or your own tools.">
          <Button size="sm" icon={<Unlock className="size-3.5" />} loading={exporting} onClick={() => setConfirmExport(true)}>
            Export…
          </Button>
        </Row>
      </Section>
      <Confirm
        open={confirmExport}
        title="Export a decrypted copy?"
        body="The copy is not encrypted. Anyone or any app that can open the file can read your friend history, game log and memos. Keep it somewhere safe and delete it when you're done."
        confirmLabel="Choose where to save"
        onClose={() => setConfirmExport(false)}
        onConfirm={async () => {
          setConfirmExport(false);
          await exportDecrypted();
        }}
      />

      <Section title="Data">
        <Row
          title="Import from VRCX"
          hint={
            vrcx.data?.path ? (
              <>
                Found VRCX data ({((vrcx.data.sizeBytes ?? 0) / 1048576).toFixed(0)} MB). Brings over your friend feed, game log, "friends since"
                dates and memos from before Nexus started. Safe to run again.
                {vrcx.data.lastImported && <> Last imported {new Date(vrcx.data.lastImported).toLocaleString()}.</>}
              </>
            ) : (
              "VRCX's data wasn't found automatically. Choose its VRCX.sqlite3 file (usually in %APPDATA%\\VRCX)."
            )
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {vrcx.data?.path && (
              <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} loading={importing} onClick={() => importVrcx()}>
                Import
              </Button>
            )}
            <Button size="sm" variant={vrcx.data?.path ? "ghost" : "secondary"} disabled={importing} onClick={chooseVrcx}>
              Choose file…
            </Button>
          </div>
        </Row>
        <Row title="Export to CSV" hint="Saved to your Downloads folder.">
          <div className="flex flex-wrap gap-1.5">
            {(["feed", "gamelog", "worlds", "friends"] as const).map((k) => (
              <Button key={k} size="sm" icon={<Download className="size-3.5" />} onClick={() => exportCsv(k)}>
                {k === "gamelog" ? "Game log" : k[0].toUpperCase() + k.slice(1)}
              </Button>
            ))}
          </div>
        </Row>
        <Row title="Clear API cache" hint="Forces fresh world, user and avatar info. Your history is kept.">
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={async () => {
              await ipc.clearCache();
              qc.clear();
              toast.success("Cache cleared");
            }}
          >
            Clear
          </Button>
        </Row>
      </Section>

      <Section title="Accounts">
        {accounts.data?.map((a) => (
          <div key={a.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-3 last:border-0">
            <Img src={a.thumbnail} className="size-9 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{a.displayName}</div>
              <div className="truncate text-xs text-subtle">{a.username}</div>
            </div>
            {a.id === user?.id ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<LogOut className="size-3.5" />}
                onClick={async () => {
                  await ipc.logout();
                  clearSession();
                }}
              >
                Sign out
              </Button>
            ) : (
              <Button
                size="sm"
                icon={<UserRoundCog className="size-3.5" />}
                onClick={async () => {
                  try {
                    clearSession();
                    useAuth.getState().setPhase("booting");
                    applyLogin(await ipc.restore(a.id));
                  } catch (e) {
                    toast.error(errorText(e));
                    useAuth.getState().loggedOut(a.username);
                  }
                }}
              >
                Switch
              </Button>
            )}
          </div>
        ))}
      </Section>

      <p className="text-xs text-subtle">
        Nexus {update.data?.current ?? ""} · Your data stays on this PC, encrypted. Not affiliated with VRChat Inc.
      </p>
    </div>
  );
}

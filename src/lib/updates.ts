import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";
import { toast } from "sonner";
import { errorText } from "./ipc";
import type { UpdateInfo } from "./types";

/** Releases page, for "What's new". */
export const RELEASES_URL = "https://github.com/LunoviaVR/Nexus/releases";

const EVERY = 30 * 60_000;
let pending: Update | null = null;
let offered: string | null = null;

/** Download the update found by the last check, install it and restart. */
export async function installUpdate() {
  const update = pending;
  if (!update) return;
  const id = toast.loading(`Downloading Nexus ${update.version}…`);
  try {
    let total = 0;
    let got = 0;
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      if (e.event === "Progress" && total) {
        got += e.data.chunkLength;
        toast.loading(`Downloading Nexus ${update.version}… ${Math.round((got / total) * 100)}%`, { id });
      }
      if (e.event === "Finished") toast.loading("Installing… Nexus will restart.", { id });
    });
    await relaunch();
  } catch (e) {
    toast.error(`Update failed: ${errorText(e)}`, { id });
  }
}

/** Ask GitHub for a newer release. Shows a sticky toast once per new version. */
export async function checkForUpdate(opts: { quiet?: boolean } = {}): Promise<UpdateInfo | null> {
  const current = await getVersion().catch(() => "");
  let update: Update | null;
  try {
    update = await check();
  } catch (e) {
    // Offline, or no release published yet: only worth mentioning when asked directly.
    if (!opts.quiet) toast.error(`Couldn't check for updates: ${errorText(e)}`);
    return { current, available: null };
  }
  pending = update;
  const v = update?.version;
  if (v && (offered !== v || !opts.quiet)) {
    offered = v;
    toast(`Nexus ${v} is ready to install`, {
      id: "update",
      description: `You're on ${current}. Installing restarts Nexus.`,
      duration: Infinity,
      action: { label: "Install & restart", onClick: installUpdate },
    });
  } else if (!v && !opts.quiet) {
    toast.success(`You're up to date (${current})`);
  }
  return { current, available: update ? { version: update.version, notes: update.body ?? null, date: update.date ?? null } : null };
}

/** Quietly look for updates shortly after launch and then every half hour. */
export function useUpdateChecks() {
  useEffect(() => {
    const first = setTimeout(() => checkForUpdate({ quiet: true }), 8_000);
    const timer = setInterval(() => checkForUpdate({ quiet: true }), EVERY);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
}

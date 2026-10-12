import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { ExternalLink, Megaphone } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { releasesUpTo, takeWhatsNew, type Release } from "@/lib/changelog";
import { cn } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import type { Block, Inline, ListItem } from "@/lib/markdown";
import { RELEASES_URL } from "@/lib/updates";
import { useUi } from "@/stores/ui";
import { Button, Dialog } from "./ui";

/** The version of Nexus that's running. */
export function useAppVersion() {
  return useQuery({ queryKey: ["app-version"], queryFn: () => getVersion(), staleTime: Infinity, retry: false });
}

const open = (href: string) => ipc.openExternal(href).catch((e) => toast.error(errorText(e)));

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "b":
            return (
              <strong key={i} className="font-semibold text-fg">
                <Inlines nodes={n.c} />
              </strong>
            );
          case "i":
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            );
          case "code":
            return (
              <code key={i} className="rounded bg-panel-2 px-1 py-px font-mono text-[12px] text-fg">
                {n.v}
              </code>
            );
          case "link":
            return (
              <button key={i} onClick={() => open(n.href)} className="text-accent underline-offset-2 hover:underline cursor-pointer">
                <Inlines nodes={n.c} />
              </button>
            );
        }
      })}
    </>
  );
}

function List({ items, nested }: { items: ListItem[]; nested?: boolean }) {
  return (
    <ul className={cn("space-y-1.5", nested ? "mt-1.5" : "my-2.5")}>
      {items.map((it, i) => (
        <li
          key={i}
          className={cn(
            "relative pl-4 before:absolute before:left-1 before:top-[0.6em] before:size-[5px] before:rounded-full",
            nested ? "before:bg-subtle" : "before:bg-accent",
          )}
        >
          <Inlines nodes={it.c} />
          {it.children.length > 0 && <List items={it.children} nested />}
        </li>
      ))}
    </ul>
  );
}

/** One release's notes. */
export function ReleaseNotes({ blocks }: { blocks: Block[] }) {
  return (
    <div className="selectable text-[13px] leading-relaxed text-muted">
      {blocks.map((b, i): ReactNode => {
        switch (b.t) {
          case "h":
            return b.level <= 2 ? (
              <h3 key={i} className="mb-1.5 mt-5 text-[13px] font-semibold text-fg first:mt-0">
                <Inlines nodes={b.c} />
              </h3>
            ) : (
              <h4 key={i} className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-subtle first:mt-0">
                <Inlines nodes={b.c} />
              </h4>
            );
          case "p":
            return (
              <p key={i} className="my-2.5 first:mt-0">
                <Inlines nodes={b.c} />
              </p>
            );
          case "quote":
            return (
              <p key={i} className="my-3 border-l-2 border-accent/50 pl-3 first:mt-0">
                <Inlines nodes={b.c} />
              </p>
            );
          case "ul":
            return <List key={i} items={b.items} />;
          case "hr":
            return <hr key={i} className="my-5 border-line" />;
        }
      })}
    </div>
  );
}

const tagUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`;

function InstalledBadge() {
  return <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold leading-4 text-accent">Installed</span>;
}

/** Every release's notes, opened from the megaphone in the top bar. */
export function ChangelogDialog() {
  const openNow = useUi((s) => s.changelogOpen);
  const setOpen = useUi((s) => s.setChangelog);
  const current = useAppVersion().data;
  const releases = releasesUpTo(current);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = releases.find((r) => r.version === picked) ?? releases[0];

  return (
    <Dialog
      open={openNow}
      onClose={() => {
        setOpen(false);
        setPicked(null);
      }}
      title="What's new in Nexus"
      className="flex h-[min(640px,88vh)] w-[min(880px,calc(100vw-32px))]"
    >
      <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-panel-2/40">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <Megaphone className="size-4 text-accent" />
          <span className="text-[13px] font-semibold">What's new</span>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" role="tablist" aria-orientation="vertical" aria-label="Versions">
          {releases.map((r) => {
            const active = r.version === shown?.version;
            return (
              <button
                key={r.version}
                role="tab"
                aria-selected={active}
                onClick={() => setPicked(r.version)}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] tabular-nums transition-colors cursor-pointer",
                  active ? "bg-accent-soft font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
                )}
              >
                <span className="flex-1">Nexus {r.version}</span>
                {r.version === current && <InstalledBadge />}
              </button>
            );
          })}
        </div>
      </aside>
      <div key={shown?.version} className="min-w-0 flex-1 overflow-y-auto px-7 pb-7 pt-6">
        {shown ? (
          <>
            <div className="mb-4 flex items-center gap-2.5 pr-10">
              <h2 className="text-lg font-semibold tracking-tight">Nexus {shown.version}</h2>
              {shown.version === current && <InstalledBadge />}
              <Button size="sm" variant="ghost" className="ml-auto" icon={<ExternalLink className="size-3.5" />} onClick={() => open(tagUrl(shown.version))}>
                GitHub
              </Button>
            </div>
            <ReleaseNotes blocks={shown.blocks} />
          </>
        ) : (
          <p className="text-[13px] text-muted">No release notes yet.</p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Shown once after Nexus updates: the notes for the new version, or for every version since the
 * one that ran last. Nothing on a fresh install.
 */
export function WhatsNewSplash() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const showAll = useUi((s) => s.setChangelog);

  useEffect(() => {
    let live = true;
    getVersion().then(
      (v) => {
        // StrictMode runs this twice in dev; only the run that's still mounted takes the notes.
        if (!live) return;
        const list = takeWhatsNew(v);
        if (list.length) {
          setVersion(v);
          setReleases(list);
        }
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const close = () => setReleases([]);
  const many = releases.length > 1;

  return (
    <Dialog open={releases.length > 0} onClose={close} title={`What's new in Nexus ${version ?? ""}`} className="flex w-[min(620px,calc(100vw-32px))] flex-col">
      <div className="relative shrink-0 overflow-hidden border-b border-line px-7 pb-5 pt-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,var(--accent-soft),transparent_60%)]" />
        <div className="relative flex items-center gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Megaphone className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">Updated to {version}</div>
            <h2 className="text-xl font-semibold tracking-tight">What's new in Nexus</h2>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        {releases.map((r, i) => (
          <section key={r.version} className={cn(i > 0 && "mt-6 border-t border-line pt-5")}>
            {many && <h3 className="mb-3 text-[15px] font-semibold tracking-tight">Nexus {r.version}</h3>}
            <ReleaseNotes blocks={r.blocks} />
          </section>
        ))}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-7 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            close();
            showAll(true);
          }}
        >
          All release notes
        </Button>
        <Button variant="primary" onClick={close} data-autofocus>
          Got it
        </Button>
      </div>
    </Dialog>
  );
}

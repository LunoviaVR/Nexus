import { CalendarDays, Copy, ExternalLink, Gauge, Shirt, Sparkles, Tag } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn, list } from "@/lib/format";
import { fullSizeUrl } from "@/lib/image";
import { errorText, ipc } from "@/lib/ipc";
import { useAvatar } from "@/lib/queries";
import type { Avatar } from "@/lib/types";
import { useUi } from "@/stores/ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { ImageViewer } from "./ImageViewer";
import { AvatarFavoriteButton } from "./AvatarFavoriteButton";
import { Button, Dialog, Empty, Img, Segmented, Skeleton } from "./ui";
import { KV, Panel, Pill } from "./UserDialog";

const PLATFORMS: { key: string; label: string }[] = [
  { key: "standalonewindows", label: "PC" },
  { key: "android", label: "Quest / Android" },
  { key: "ios", label: "iOS" },
];

/** VRChat's performance ranks, best to worst. */
const RATING: Record<string, { label: string; tone: string }> = {
  Excellent: { label: "Excellent", tone: "text-emerald-400 bg-emerald-500/12" },
  Good: { label: "Good", tone: "text-lime-400 bg-lime-500/12" },
  Medium: { label: "Medium", tone: "text-yellow-400 bg-yellow-500/12" },
  Poor: { label: "Poor", tone: "text-orange-400 bg-orange-500/12" },
  VeryPoor: { label: "Very Poor", tone: "text-rose-400 bg-rose-500/12" },
};

const CONTENT_TAGS: Record<string, string> = {
  content_sex: "Sexually suggestive",
  content_adult: "Adult language & themes",
  content_violence: "Graphic violence",
  content_gore: "Gore",
  content_horror: "Horror",
  content_other: "Other mature content",
};

function Rating({ value }: { value?: string }) {
  const r = value ? RATING[value] : undefined;
  return (
    <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", r?.tone ?? "bg-panel-2 text-subtle")}>
      {r?.label ?? (value || "Not rated")}
    </span>
  );
}

export function AvatarDialog() {
  const avatarId = useUi((s) => s.avatarId);
  const openAvatar = useUi((s) => s.openAvatar);
  return (
    <Dialog open={!!avatarId} onClose={() => openAvatar(null)} title="Avatar" className="w-[min(920px,calc(100vw-32px))]">
      {avatarId && (
        <ErrorBoundary resetKey={avatarId}>
          <AvatarBody key={avatarId} avatarId={avatarId} />
        </ErrorBoundary>
      )}
    </Dialog>
  );
}

function AvatarBody({ avatarId }: { avatarId: string }) {
  const { data: a, isLoading, error } = useAvatar(avatarId);
  const [tab, setTab] = useState<"details" | "json">("details");
  const [viewing, setViewing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { openUser, openAvatar } = useUi();

  if (isLoading) {
    return (
      <div className="flex gap-5 p-6">
        <Skeleton className="aspect-[3/4] w-72 rounded-xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }
  if (!a) return <Empty icon={<Shirt />} title="Couldn't load this avatar" hint={errorText(error)} />;

  const use = async () => {
    setBusy(true);
    try {
      await ipc.selectAvatar(a.id);
      toast.success(`Switched to ${a.name}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const packagesFor = (platform: string) => list(a.unityPackages).filter((p) => p.platform === platform && p.variant !== "impostor");
  const supported = PLATFORMS.filter((p) => packagesFor(p.key).length || a.performance?.[p.key]);
  const contentTags = list<string>(a.tags).filter((t) => t in CONTENT_TAGS);
  const authorTags = list<string>(a.tags).filter((t) => t.startsWith("author_tag_")).map((t) => t.slice("author_tag_".length));
  const styles = [a.styles?.primary, a.styles?.secondary].filter(Boolean) as string[];

  return (
    <div className="flex max-h-[88vh] min-h-[480px]">
      <aside className="w-[300px] shrink-0 space-y-3 overflow-y-auto border-r border-line bg-panel p-4">
        <button onClick={() => a.imageUrl && setViewing(0)} className="block w-full cursor-zoom-in" title="View image">
          <Img src={a.imageUrl || a.thumbnailImageUrl} className="aspect-[3/4] w-full rounded-xl" />
        </button>
        <div>
          <h2 className="selectable text-lg font-bold leading-tight">{a.name}</h2>
          <button
            onClick={() => {
              openAvatar(null);
              openUser(a.authorId);
            }}
            className="text-[13px] text-muted hover:text-accent cursor-pointer"
          >
            by {a.authorName}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill className={a.releaseStatus === "public" ? "text-emerald-400" : "text-muted"}>{a.releaseStatus === "public" ? "Public" : "Private"}</Pill>
          {a.featured && (
            <Pill className="text-amber-400">
              <Sparkles className="size-3" /> Featured
            </Pill>
          )}
          {a.version != null && <Pill className="text-muted">v{a.version}</Pill>}
        </div>
        <div className="grid gap-1.5">
          <Button variant="primary" loading={busy} icon={<Shirt className="size-4" />} onClick={use}>
            Use avatar
          </Button>
          <AvatarFavoriteButton avatarId={a.id} avatarName={a.name} />
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(a.id).then(() => toast.success("Copied avatar ID"))}>
              Copy ID
            </Button>
            <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => ipc.openExternal(`https://vrchat.com/home/avatar/${a.id}`)}>
              vrchat.com
            </Button>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center border-b border-line px-5 py-3 pr-14">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "details", label: "Details" },
              { value: "json", label: "JSON" },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {tab === "details" ? (
            <Details a={a} supported={supported} packagesFor={packagesFor} contentTags={contentTags} authorTags={authorTags} styles={styles} />
          ) : (
            <pre className="selectable overflow-auto rounded-xl bg-panel-2 p-4 text-[11.5px] leading-relaxed text-muted">{JSON.stringify(a, null, 2)}</pre>
          )}
        </div>
      </section>

      <ImageViewer
        images={a.imageUrl ? [{ src: fullSizeUrl(a.imageUrl)!, title: a.name, subtitle: `by ${a.authorName}`, fileName: `avatar_${a.name}` }] : []}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

function Details({
  a,
  supported,
  packagesFor,
  contentTags,
  authorTags,
  styles,
}: {
  a: Avatar;
  supported: typeof PLATFORMS;
  packagesFor: (p: string) => NonNullable<Avatar["unityPackages"]>;
  contentTags: string[];
  authorTags: string[];
  styles: string[];
}) {
  const chips = (items: ReactNode[]) => <div className="flex flex-wrap gap-1.5">{items}</div>;
  return (
    <>
      <Panel title="Description">
        {a.description && a.description !== a.name ? (
          <p className="selectable whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-relaxed">{a.description}</p>
        ) : (
          <p className="text-[13px] text-subtle">No description.</p>
        )}
      </Panel>

      <Panel
        title="Platforms & performance"
        action={<Gauge className="size-3.5 text-subtle" />}
      >
        {supported.length ? (
          <div className="divide-y divide-line/60">
            {supported.map((p) => {
              const pkg = packagesFor(p.key).sort((x, y) => (y.unityVersion ?? "").localeCompare(x.unityVersion ?? ""))[0];
              const rating = (a.performance?.[p.key] as string | undefined) ?? pkg?.performanceRating;
              return (
                <div key={p.key} className="flex items-center gap-3 py-2 text-[13px] first:pt-0 last:pb-0">
                  <span className="w-32 font-medium">{p.label}</span>
                  <Rating value={rating} />
                  {pkg?.unityVersion && <span className="ml-auto font-mono text-[11px] text-subtle">Unity {pkg.unityVersion}</span>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-subtle">No platform information.</p>
        )}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Info">
          {a.created_at && (
            <KV k="Uploaded">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3 text-subtle" /> {new Date(a.created_at).toLocaleDateString()}
              </span>
            </KV>
          )}
          {a.updated_at && <KV k="Last updated">{new Date(a.updated_at).toLocaleDateString()}</KV>}
          {a.version != null && <KV k="Version">{a.version}</KV>}
          <KV k="Visibility">{a.releaseStatus === "public" ? "Public" : "Private"}</KV>
          {a.searchable != null && <KV k="Searchable">{a.searchable ? "Yes" : "No"}</KV>}
        </Panel>
        <Panel title="Tags" action={<Tag className="size-3.5 text-subtle" />}>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Content warnings</div>
              {contentTags.length ? (
                chips(contentTags.map((t) => <Pill key={t} className="text-rose-400">{CONTENT_TAGS[t]}</Pill>))
              ) : (
                <p className="text-xs text-subtle">None</p>
              )}
            </div>
            {styles.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Style</div>
                {chips(styles.map((s) => <Pill key={s} className="text-muted">{s}</Pill>))}
              </div>
            )}
            {authorTags.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Author tags</div>
                {chips(authorTags.map((s) => <Pill key={s} className="text-muted">{s}</Pill>))}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

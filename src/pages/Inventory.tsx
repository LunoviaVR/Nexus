import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleUserRound,
  ImagePlus,
  Images,
  Printer,
  Smile,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge, Button, Confirm, Dialog, Empty, Img, Input, PageHeader, Skeleton } from "@/components/ui";
import { cn, dateTime } from "@/lib/format";
import { fileFullUrl, fileUrls, toPngBase64 } from "@/lib/image";
import { ImageViewer, type ViewerImage } from "@/components/ImageViewer";
import { errorText, ipc } from "@/lib/ipc";
import type { VrcFile } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useUi } from "@/stores/ui";

type Section = "prints" | "emojis" | "icons" | "banners";

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "prints", label: "Prints", icon: <Printer className="size-4" /> },
  { id: "emojis", label: "Emojis", icon: <Smile className="size-4" /> },
  { id: "icons", label: "Icons", icon: <CircleUserRound className="size-4" /> },
  { id: "banners", label: "Banners", icon: <Images className="size-4" /> },
];

// The emoji animation styles VRChat offers for static emoji uploads.
const ANIMATIONS = [
  "aura", "bats", "bees", "bounce", "cloud", "confetti", "crying", "dislike", "fire", "idea", "lasers", "like",
  "magnet", "mistletoe", "money", "noise", "orbit", "pizza", "rain", "rotate", "shake", "snow", "snowball",
  "spin", "splash", "stop", "zzz",
];

export function Inventory() {
  const [section, setSection] = useState<Section>("prints");

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Your VRChat image library." />
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {SECTIONS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors cursor-pointer",
              section === t.id ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <span className={section === t.id ? "text-accent" : ""}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      {section === "prints" && <Prints />}
      {section === "emojis" && <ImageLibrary kind="emoji" />}
      {section === "icons" && <ImageLibrary kind="icon" />}
      {section === "banners" && <ImageLibrary kind="gallery" />}
    </div>
  );
}

const GRID = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]";

function Loading({ aspect = "aspect-square" }: { aspect?: string }) {
  return (
    <div className={GRID}>
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className={cn(aspect, "rounded-xl")} />
      ))}
    </div>
  );
}

type DeleteKind = "print" | "file";

/** Delete on VRChat, then refresh the list it came from. Throws so callers can keep dialogs open. */
function useInventoryDelete() {
  const qc = useQueryClient();
  return async (kind: DeleteKind, id: string, name: string, queryKey: unknown[]) => {
    try {
      await ipc.deleteFromInventory(kind, id);
      await qc.invalidateQueries({ queryKey });
      toast.success(`Deleted ${name}`);
    } catch (e) {
      toast.error(errorText(e));
      throw e;
    }
  };
}

/** Hover trash button on a card, with confirmation. Place inside a `relative group` element. */
function DeleteButton({ kind, id, name, warning, queryKey }: { kind: DeleteKind; id: string; name: string; warning: ReactNode; queryKey: unknown[] }) {
  const remove = useInventoryDelete();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Delete ${name}`}
        title="Delete"
        className="absolute right-2 top-2 z-[1] flex size-7 items-center justify-center rounded-full bg-black/60 text-white/90 opacity-0 transition-opacity hover:bg-red-500 focus-visible:opacity-100 group-hover:opacity-100 cursor-pointer"
      >
        <Trash2 className="size-3.5" />
      </button>
      <Confirm
        open={open}
        danger
        title={`Delete ${name}?`}
        body={warning}
        confirmLabel="Delete"
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          await remove(kind, id, name, queryKey).then(() => setOpen(false), () => {});
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Uploads

type UploadKind = "icon" | "gallery" | "emoji" | "print";

const UPLOAD_INFO: Record<UploadKind, { title: string; hint: string; square: boolean; max: number }> = {
  icon: { title: "Upload icon", hint: "Cropped to a square. Requires VRC+.", square: true, max: 1024 },
  emoji: { title: "Upload emoji", hint: "Cropped to a square. Requires VRC+.", square: true, max: 1024 },
  gallery: { title: "Upload banner", hint: "Gallery images can be used as your profile banner. Requires VRC+.", square: false, max: 2048 },
  print: { title: "Upload print", hint: "Prints show up in your in-game print collection. Requires VRC+.", square: false, max: 2048 },
};

function UploadDialog({ kind, open, onClose, onDone }: { kind: UploadKind; open: boolean; onClose: () => void; onDone: () => void }) {
  const info = UPLOAD_INFO[kind];
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [animation, setAnimation] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setNote("");
    setAnimation("");
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await toPngBase64(file, { square: info.square, max: info.max });
      await ipc.uploadImage(kind, data, { note: note || undefined, animationStyle: animation || undefined });
      toast.success("Uploaded");
      reset();
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={info.title}
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <div className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-bold">{info.title}</h2>
          <p className="text-[13px] text-muted">{info.hint}</p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (preview) URL.revokeObjectURL(preview);
            setFile(f);
            setPreview(URL.createObjectURL(f));
          }}
        />
        <button
          onClick={() => input.current?.click()}
          className={cn(
            "flex w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-line bg-panel-2/50 text-muted transition-colors hover:border-accent/60 hover:text-fg cursor-pointer",
            info.square ? "aspect-square max-h-72" : "aspect-video",
          )}
        >
          {preview ? (
            <img
              src={preview}
              alt=""
              className={cn("size-full", info.square ? "object-cover" : "object-contain", kind === "icon" && "rounded-full")}
            />
          ) : (
            <span className="flex flex-col items-center gap-2 text-[13px]">
              <ImagePlus className="size-6" /> Choose an image
            </span>
          )}
        </button>
        {kind === "print" && <Input value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder="Caption (optional)" />}
        {kind === "emoji" && (
          <label className="flex items-center justify-between gap-3 text-[13px] text-muted">
            Animation
            <select
              value={animation}
              onChange={(e) => setAnimation(e.target.value)}
              className="h-9 rounded-lg border border-line bg-panel-2 px-2 text-[13px] text-fg outline-none focus:border-accent"
            >
              <option value="">None</option>
              {ANIMATIONS.map((a) => (
                <option key={a} value={a}>
                  {a[0].toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" icon={<Upload className="size-4" />} loading={busy} disabled={!file} onClick={submit}>
            Upload
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function UploadButton({ kind, onDone }: { kind: UploadKind; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setOpen(true)}>
        Upload
      </Button>
      <UploadDialog
        kind={kind}
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          onDone();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Prints

function Prints() {
  const prints = useQuery({ queryKey: ["prints"], queryFn: ipc.prints, staleTime: 5 * 60_000 });
  const openWorld = useUi((s) => s.openWorld);
  const list = [...(prints.data ?? [])].sort((a, b) => Date.parse(b.timestamp ?? b.createdAt ?? "") - Date.parse(a.timestamp ?? a.createdAt ?? ""));
  const [viewing, setViewing] = useState<number | null>(null);
  const remove = useInventoryDelete();
  const viewerImages: ViewerImage[] = list.map((p) => ({
    src: p.files.image ?? "",
    title: p.note || p.worldName || "Print",
    subtitle: [p.worldName, p.timestamp ? dateTime(Date.parse(p.timestamp)) : null].filter(Boolean).join(" · "),
    fileName: `print_${(p.timestamp ?? p.createdAt ?? "").slice(0, 10)}_${p.id}`,
  }));
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] text-muted">{prints.data ? `${list.length} prints` : ""}</span>
        <UploadButton kind="print" onDone={() => prints.refetch()} />
      </div>
      {prints.isLoading ? (
        <Loading aspect="aspect-[4/3]" />
      ) : prints.error ? (
        <Empty icon={<Printer />} title="Couldn't load prints" hint={errorText(prints.error)} />
      ) : list.length ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {list.map((p, i) => (
            <div key={p.id} className="group relative overflow-hidden rounded-xl border border-line bg-panel">
              <DeleteButton
                kind="print"
                id={p.id}
                name={p.note ? `“${p.note}”` : "this print"}
                queryKey={["prints"]}
                warning="This print will be permanently deleted from your VRChat account and your in-game collection."
              />
              <button onClick={() => setViewing(i)} className="block w-full cursor-zoom-in" title="View">
                <Img src={p.files.image} className="aspect-[4/3] w-full bg-panel-2" />
              </button>
              <div className="p-3">
                {p.note && <div className="truncate text-[13px] font-medium">{p.note}</div>}
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted">
                  {p.worldName ? (
                    <button onClick={() => p.worldId && openWorld(p.worldId)} className="truncate hover:text-accent cursor-pointer">
                      {p.worldName}
                    </button>
                  ) : (
                    <span className="text-subtle">Uploaded</span>
                  )}
                  <span className="shrink-0 text-subtle">{dateTime(Date.parse(p.timestamp ?? p.createdAt ?? "") || Date.now())}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={<Printer />} title="No prints yet" hint="Take prints in-game with the camera, or upload one." />
      )}
      <ImageViewer
        images={viewerImages}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
        onDelete={(i) => remove("print", list[i].id, "print", ["prints"])}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Emojis, icons and banners (VRChat image files)

const LIBRARY: Record<"emoji" | "icon" | "gallery", { tag: string; noun: string; empty: string }> = {
  emoji: { tag: "emoji,emojianimated", noun: "emojis", empty: "No emojis yet" },
  icon: { tag: "icon", noun: "icons", empty: "No icons yet" },
  gallery: { tag: "gallery", noun: "banners", empty: "No banner images yet" },
};

function ImageLibrary({ kind }: { kind: "emoji" | "icon" | "gallery" }) {
  const info = LIBRARY[kind];
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const updateUser = useAuth((s) => s.updateUser);
  const files = useQuery({ queryKey: ["files", info.tag], queryFn: () => ipc.files(info.tag), staleTime: 5 * 60_000 });
  const [busy, setBusy] = useState<string | null>(null);

  const setIcon = async (f: VrcFile) => {
    const u = fileUrls(f);
    setBusy(f.id);
    try {
      await ipc.updateProfile({ userIcon: u.file });
      if (me) updateUser({ ...me, iconUrl: `https://api.vrchat.cloud/api/1/image/${f.id}/${u.version}/256` });
      await qc.invalidateQueries({ queryKey: ["profile", me?.id] });
      toast.success("Profile picture updated");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const list = [...(files.data ?? [])].reverse();
  const [viewing, setViewing] = useState<number | null>(null);
  const remove = useInventoryDelete();
  const viewerImages: ViewerImage[] = list.map((f, i) => ({
    src: fileFullUrl(f),
    title: `${info.noun[0].toUpperCase()}${info.noun.slice(1, -1)} ${list.length - i}`,
    subtitle: f.tags?.includes("emojianimated") ? "Animated emoji (sprite sheet)" : undefined,
    fileName: `${kind}_${f.id}`,
  }));
  const currentIcon = me?.iconUrl?.match(/file_[0-9a-f-]+/)?.[0];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] text-muted">{files.data ? `${list.length} ${info.noun}` : ""}</span>
        <UploadButton kind={kind} onDone={() => files.refetch()} />
      </div>
      {files.isLoading ? (
        <Loading aspect={kind === "gallery" ? "aspect-video" : "aspect-square"} />
      ) : files.error ? (
        <Empty icon={<Images />} title={`Couldn't load ${info.noun}`} hint={errorText(files.error)} />
      ) : list.length ? (
        <div
          className={cn(
            "grid gap-3",
            kind === "gallery" ? "[grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]" : "[grid-template-columns:repeat(auto-fill,minmax(130px,1fr))]",
          )}
        >
          {list.map((f, i) => {
            const u = fileUrls(f);
            const animated = f.tags?.includes("emojianimated");
            const isCurrent = kind === "icon" && currentIcon === f.id;
            return (
              <div key={f.id} className={cn("group relative overflow-hidden rounded-xl border bg-panel", isCurrent ? "border-accent" : "border-line")}>
                <DeleteButton
                  kind="file"
                  id={f.id}
                  name={`this ${info.noun.slice(0, -1)}`}
                  queryKey={["files", info.tag]}
                  warning={
                    <>
                      It will be permanently deleted from your VRChat account.
                      {isCurrent && <> This is your current profile picture; VRChat will fall back to your avatar's picture.</>}
                    </>
                  }
                />
                <button
                  onClick={() => setViewing(i)}
                  title="View"
                  className={cn("relative block w-full bg-panel-2 cursor-zoom-in", kind === "gallery" ? "aspect-video" : "aspect-square p-3")}
                >
                  <Img src={u.thumb} className={cn("size-full", kind === "icon" && "rounded-full", kind === "emoji" && "object-contain bg-transparent")} />
                  {animated && <Badge className="absolute left-2 top-2 bg-black/55 text-white">Animated</Badge>}
                  {isCurrent && (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-fg">
                      <Check className="size-3" /> In use
                    </span>
                  )}
                </button>
                {kind === "icon" && !isCurrent && (
                  <div className="p-2">
                    <Button size="sm" className="w-full" loading={busy === f.id} onClick={() => setIcon(f)}>
                      Use as picture
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon={<Images />} title={info.empty} hint="Upload one with the button above." />
      )}
      <ImageViewer
        images={viewerImages}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
        onDelete={(i) => remove("file", list[i].id, info.noun.slice(0, -1), ["files", info.tag])}
      />
    </div>
  );
}

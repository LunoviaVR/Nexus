import * as RDialog from "@radix-ui/react-dialog";
import { save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { ChevronLeft, ChevronRight, Download, Maximize2, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { toast } from "sonner";
import { cn, imgSrc } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import { Confirm, Tip } from "./ui";

export interface ViewerImage {
  /** Full-resolution URL (also what Download saves). */
  src: string;
  title?: string;
  subtitle?: string;
  /** Suggested file name for Download, without extension. */
  fileName?: string;
}

const MIN = 1;
const MAX = 8;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
  onDelete,
}: {
  images: ViewerImage[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** When set, shows a Delete button for the current image. */
  onDelete?: (i: number) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const open = index !== null && !!images[index];
  const img = open ? images[index!] : undefined;
  // Scale and offset change together, so they live in one piece of state.
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const scale = view.s;
  const pos = { x: view.x, y: view.y };
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const reset = useCallback(() => setView({ s: 1, x: 0, y: 0 }), []);

  useEffect(() => {
    reset();
    setLoaded(false);
  }, [index, reset]);

  /** Zoom keeping the point under (cx, cy) — relative to the stage center — fixed. */
  const zoomAt = useCallback((next: (prev: number) => number, cx = 0, cy = 0) => {
    setView((v) => {
      const s = clamp(next(v.s), MIN, MAX);
      if (s === MIN) return { s, x: 0, y: 0 };
      const k = s / v.s;
      return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  const go = useCallback(
    (d: number) => {
      if (index === null || images.length < 2) return;
      onIndex((index + d + images.length) % images.length);
    },
    [index, images.length, onIndex],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+" || e.key === "=") zoomAt((v) => v * 1.5);
      else if (e.key === "-") zoomAt((v) => v / 1.5);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, zoomAt, reset]);

  const center = (clientX: number, clientY: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { cx: clientX - (r.left + r.width / 2), cy: clientY - (r.top + r.height / 2) };
  };

  const onWheel = (e: WheelEvent) => {
    const { cx, cy } = center(e.clientX, e.clientY);
    zoomAt((v) => v * (e.deltaY < 0 ? 1.2 : 1 / 1.2), cx, cy);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (scale === 1) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
  };
  const onPointerUp = () => (drag.current = null);

  const download = async () => {
    if (!img) return;
    const name = (img.fileName || img.title || "vrchat-image").replace(/[<>:"/\\|?*]+/g, "_");
    const path = await pickSavePath({ defaultPath: `${name}.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
    if (!path) return;
    setSaving(true);
    try {
      await ipc.downloadImage(img.src, path);
      toast.success("Image saved", { action: { label: "Show", onClick: () => ipc.reveal(path) } });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const ctrl = "inline-flex size-9 items-center justify-center rounded-lg text-white/85 hover:bg-white/10 hover:text-white cursor-pointer disabled:opacity-40";

  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm" />
        <RDialog.Content aria-describedby={undefined} className="fixed inset-0 z-[60] flex flex-col outline-none">
          <RDialog.Title className="sr-only">{img?.title ?? "Image"}</RDialog.Title>

          {/* Top bar */}
          <div className="flex h-14 shrink-0 items-center gap-3 px-4 text-white">
            <div className="min-w-0 flex-1">
              {img?.title && <div className="truncate text-sm font-semibold">{img.title}</div>}
              {img?.subtitle && <div className="truncate text-xs text-white/60">{img.subtitle}</div>}
            </div>
            {images.length > 1 && index !== null && (
              <span className="text-xs tabular-nums text-white/60">
                {index + 1} / {images.length}
              </span>
            )}
            <div className="flex items-center gap-0.5 rounded-xl bg-white/5 p-1">
              <Tip label="Zoom out (−)">
                <button className={ctrl} disabled={scale <= MIN} onClick={() => zoomAt((v) => v / 1.5)} aria-label="Zoom out">
                  <ZoomOut className="size-4" />
                </button>
              </Tip>
              <button onClick={reset} className="h-9 w-14 rounded-lg text-xs font-semibold tabular-nums text-white/85 hover:bg-white/10 cursor-pointer" title="Reset (0)">
                {Math.round(scale * 100)}%
              </button>
              <Tip label="Zoom in (+)">
                <button className={ctrl} disabled={scale >= MAX} onClick={() => zoomAt((v) => v * 1.5)} aria-label="Zoom in">
                  <ZoomIn className="size-4" />
                </button>
              </Tip>
              <Tip label="Fit to screen (0)">
                <button className={ctrl} onClick={reset} aria-label="Fit to screen">
                  <Maximize2 className="size-4" />
                </button>
              </Tip>
            </div>
            <button
              onClick={download}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:bg-accent-strong disabled:opacity-60 cursor-pointer"
            >
              <Download className="size-4" />
              {saving ? "Saving…" : "Download"}
            </button>
            {onDelete && (
              <Tip label="Delete from VRChat">
                <button className={cn(ctrl, "hover:bg-red-500/20 hover:text-red-300")} onClick={() => setConfirming(true)} aria-label="Delete">
                  <Trash2 className="size-4" />
                </button>
              </Tip>
            )}
            <RDialog.Close asChild>
              <button className={ctrl} aria-label="Close">
                <X className="size-5" />
              </button>
            </RDialog.Close>
          </div>

          {/* Stage */}
          <div
            ref={stage}
            className={cn("relative min-h-0 flex-1 touch-none select-none overflow-hidden", scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              if (scale > 1) reset();
              else {
                const { cx, cy } = center(e.clientX, e.clientY);
                zoomAt(() => 2.5, cx, cy);
              }
            }}
          >
            {img && (
              <img
                key={img.src}
                src={imgSrc(img.src)}
                alt={img.title ?? ""}
                referrerPolicy="no-referrer"
                draggable={false}
                onLoad={() => setLoaded(true)}
                className={cn("absolute inset-0 m-auto max-h-full max-w-full object-contain transition-opacity", loaded ? "opacity-100" : "opacity-0")}
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                  transition: drag.current ? "none" : "transform 120ms ease-out, opacity 150ms",
                  imageRendering: scale >= 3 ? "pixelated" : "auto",
                }}
              />
            )}
            {!loaded && <div className="absolute inset-0 m-auto size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />}

            {images.length > 1 && (
              <>
                <button
                  onClick={(e) => (e.stopPropagation(), go(-1))}
                  onDoubleClick={(e) => e.stopPropagation()}
                  aria-label="Previous image"
                  className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white hover:bg-black/70 cursor-pointer"
                >
                  <ChevronLeft className="size-6" />
                </button>
                <button
                  onClick={(e) => (e.stopPropagation(), go(1))}
                  onDoubleClick={(e) => e.stopPropagation()}
                  aria-label="Next image"
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white hover:bg-black/70 cursor-pointer"
                >
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}
          </div>
          <div className="h-8 shrink-0 text-center text-[11px] leading-8 text-white/40">
            Scroll or double-click to zoom · drag to pan · ← → to browse · Esc to close
          </div>
        </RDialog.Content>
      </RDialog.Portal>
      {onDelete && index !== null && (
        <Confirm
          open={confirming}
          danger
          title="Delete this image?"
          body={<>“{img?.title}” will be permanently deleted from your VRChat account. This can't be undone.</>}
          confirmLabel="Delete"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await onDelete(index);
              setConfirming(false);
              onClose();
            } catch {
              // The caller already reported the error; keep the dialog open to retry.
            }
          }}
        />
      )}
    </RDialog.Root>
  );
}

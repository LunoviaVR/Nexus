/** Re-encode an image as PNG (VRChat's upload endpoints want PNG) and return base64. */
export async function toPngBase64(file: File, opts: { square?: boolean; max: number }): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (opts.square) {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2;
    sy = (sh - side) / 2;
    sw = sh = side;
  }
  const scale = Math.min(1, opts.max / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return blobToBase64(await canvasToPng(canvas));
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode the image"))), "image/png"));
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// VRChat doesn't frame uploaded prints or write anything on them: the file *is* the finished
// print, so this draws it the way the in-game camera does. Measured from a camera print, in its
// own 2048×1440 pixels: the photo sits in a 1920×1080 window 64px in from the sides and 69px from
// the top, the caption is centred under it, and "Captured By" and the date run along the bottom.
const PRINT = { w: 2048, h: 1440, x: 64, y: 69, pw: 1920, ph: 1080 };
const FONT = `"Noto Sans", "Segoe UI", sans-serif`;
// VRChat's caption isn't the italic face: it's the upright font slanted (its text renderer's
// default italic shear of 0.35), so the "a" keeps its upright shape.
const CAPTION = { size: 70, min: 40, baseline: 1287, center: 1025.5, shear: 0.35 };
const META = { size: 35, baseline: 1419, left: 65.2, right: 1977 };
const ICON = "#565656";

export interface PrintSource {
  bitmap: ImageBitmap;
  /** Already a finished print (e.g. one saved from VRChat), so it's uploaded as it is. */
  framed: boolean;
}

export interface PrintText {
  caption: string;
  author: string;
  date: Date;
}

export async function loadPrintSource(file: File): Promise<PrintSource> {
  const bitmap = await createImageBitmap(file);
  if (bitmap.width !== PRINT.w || bitmap.height !== PRINT.h) return { bitmap, framed: false };
  const canvas = document.createElement("canvas");
  canvas.width = PRINT.w;
  canvas.height = PRINT.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const border = [
    [16, 16],
    [PRINT.w - 16, 16],
    [16, PRINT.h - 16],
    [PRINT.w - 16, PRINT.h - 16],
    [PRINT.w / 2, 30],
  ];
  const framed = border.every(([x, y]) => ctx.getImageData(x, y, 1, 1).data.slice(0, 3).every((c) => c > 235));
  return { bitmap, framed };
}

/** Draw the finished print onto `canvas` (resized to 2048×1440). */
export function drawPrint(canvas: HTMLCanvasElement, src: PrintSource, text: PrintText) {
  canvas.width = PRINT.w;
  canvas.height = PRINT.h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  if (src.framed) {
    ctx.drawImage(src.bitmap, 0, 0);
    return;
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PRINT.w, PRINT.h);
  // The whole image, fitted into the photo window; anything that isn't 16:9 gets white margins.
  const scale = Math.min(PRINT.pw / src.bitmap.width, PRINT.ph / src.bitmap.height);
  const w = Math.round(src.bitmap.width * scale);
  const h = Math.round(src.bitmap.height * scale);
  ctx.drawImage(src.bitmap, PRINT.x + Math.round((PRINT.pw - w) / 2), PRINT.y + Math.round((PRINT.ph - h) / 2), w, h);

  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const caption = text.caption.trim();
  if (caption) {
    const room = PRINT.pw - CAPTION.shear * CAPTION.size;
    let size = CAPTION.size;
    ctx.font = `${size}px ${FONT}`;
    while (size > CAPTION.min && ctx.measureText(caption).width > room) {
      size -= 2;
      ctx.font = `${size}px ${FONT}`;
    }
    const fitted = ellipsize(ctx, caption, room);
    const m = ctx.measureText(fitted);
    const B = CAPTION.baseline;
    // Left edge of the upright ink, so that the slanted ink is centred.
    const inkLeft =
      CAPTION.center - (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / 2 - (CAPTION.shear * m.actualBoundingBoxAscent) / 2;
    ctx.save();
    ctx.setTransform(1, 0, -CAPTION.shear, 1, CAPTION.shear * B, 0); // slant about the baseline
    ctx.fillText(fitted, inkLeft + m.actualBoundingBoxLeft, B);
    ctx.restore();
  }

  // Positions go by the ink of each piece, so a fallback font still lines up with VRChat's.
  ctx.font = `${META.size}px ${FONT}`;
  const B = META.baseline;
  const d = text.date;
  const date = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  const dm = ctx.measureText(date);
  const dateX = META.right - dm.actualBoundingBoxRight;
  ctx.fillText(date, dateX, B);
  const calendarX = dateX - dm.actualBoundingBoxLeft - 7.4 - 30;
  drawCalendar(ctx, calendarX, B);

  const label = "Captured By";
  const lm = ctx.measureText(label);
  const labelX = META.left + lm.actualBoundingBoxLeft;
  ctx.fillStyle = "#000";
  ctx.fillText(label, labelX, B);
  const personX = labelX + lm.actualBoundingBoxRight + 16.4;
  drawPerson(ctx, personX, B);
  const nameX = personX + 30.8;
  const name = ellipsize(ctx, text.author, Math.max(0, calendarX - 48 - nameX));
  ctx.fillStyle = "#000";
  ctx.fillText(name, nameX + ctx.measureText(name).actualBoundingBoxLeft, B);
}

export async function printPng(src: PrintSource, text: PrintText): Promise<Blob> {
  const canvas = document.createElement("canvas");
  drawPrint(canvas, src, text);
  return canvasToPng(canvas);
}

const pad = (n: number) => String(n).padStart(2, "0");

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  const chars = [...text];
  while (chars.length && ctx.measureText(chars.join("") + "…").width > max) chars.pop();
  return chars.join("").trimEnd() + "…";
}

/** VRChat's solid person glyph, 16.8 wide, sitting on the text baseline. */
function drawPerson(ctx: CanvasRenderingContext2D, x: number, baseline: number) {
  ctx.fillStyle = ICON;
  ctx.beginPath();
  ctx.arc(x + 8.4, baseline - 22.2, 6.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, baseline - 14, 16.8, 15.6, [7.5, 7.5, 1.5, 1.5]);
  ctx.fill();
}

/** VRChat's solid calendar glyph, 30 wide: two binding tabs, a header and a white rule. */
function drawCalendar(ctx: CanvasRenderingContext2D, x: number, baseline: number) {
  ctx.fillStyle = ICON;
  ctx.beginPath();
  ctx.roundRect(x, baseline - 24.8, 30, 26.6, 2);
  ctx.roundRect(x + 5.4, baseline - 27.4, 7.2, 5, 2.5);
  ctx.roundRect(x + 17.4, baseline - 27.4, 7.2, 5, 2.5);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, baseline - 18.2, 30, 1.8);
}

/**
 * Turn any VRChat image link (thumbnail `/image/file_x/1/256`, `/file/file_x/1`, ...)
 * into the original-resolution `/file/file_x/1/file`. Other URLs pass through.
 */
export function fullSizeUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/(?:image|file)\/(file_[0-9a-f-]+)\/(\d+)/);
  return m ? `https://api.vrchat.cloud/api/1/file/${m[1]}/${m[2]}/file` : url;
}

/** Original-resolution download URL for a VRChat image file. */
export function fileFullUrl(f: { id: string; versions: { version: number; deleted?: boolean }[] }) {
  return `https://api.vrchat.cloud/api/1/file/${f.id}/${fileUrls(f).version}/file`;
}

/** URLs for a VRChat image file's latest version. */
export function fileUrls(f: { id: string; versions: { version: number; deleted?: boolean }[] }) {
  const v = [...f.versions].filter((x) => !x.deleted && x.version > 0).sort((a, b) => b.version - a.version)[0]?.version ?? 1;
  return {
    version: v,
    file: `https://api.vrchat.cloud/api/1/file/${f.id}/${v}`,
    thumb: `https://api.vrchat.cloud/api/1/image/${f.id}/${v}/512`,
  };
}

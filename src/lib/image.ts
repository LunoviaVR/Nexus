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
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode the image"))), "image/png"),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
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

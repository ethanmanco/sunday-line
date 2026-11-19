// Prepares a photo before upload, in the browser.
//
// Photos are redrawn onto a canvas and saved fresh, which drops every bit of
// metadata, including the GPS spot a phone stores in its photos. GIFs are kept
// as they are so they still move (the GIF format has no place for GPS data).

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const ACCEPT_ATTR = ACCEPTED.join(",");

export interface Prepared {
  blob: Blob;
  ext: "webp" | "jpg" | "gif";
  kind: "image" | "gif";
  contentType: string;
}

interface Options {
  /** Box the picture must fit in, in pixels. */
  width: number;
  height: number;
  /** Crop to exactly width x height (avatars, banners) instead of fitting inside. */
  crop?: boolean;
  maxBytes: number;
  allowGif?: boolean;
}

export class ImageError extends Error {}

export async function prepareImage(file: File, o: Options): Promise<Prepared> {
  if (!ACCEPTED.includes(file.type)) throw new ImageError("Use a JPEG, PNG, WebP, or GIF.");
  const mb = Math.round(o.maxBytes / 1048576);
  if (file.type === "image/gif") {
    if (!o.allowGif) throw new ImageError("GIFs work in the gallery. Use a photo here.");
    if (file.size > o.maxBytes) throw new ImageError(`That GIF is over ${mb} MB.`);
    return { blob: file, ext: "gif", kind: "gif", contentType: "image/gif" };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError("Couldn't read that picture. Try another one.");
  }

  const sw = bitmap.width;
  const sh = bitmap.height;
  let sx = 0, sy = 0, cw = sw, ch = sh, dw: number, dh: number;
  if (o.crop) {
    // Cover: crop the middle to the target shape.
    const target = o.width / o.height;
    if (sw / sh > target) {
      cw = Math.round(sh * target);
      sx = Math.round((sw - cw) / 2);
    } else {
      ch = Math.round(sw / target);
      sy = Math.round((sh - ch) / 2);
    }
    const scale = Math.min(1, o.width / cw);
    dw = Math.round(cw * scale);
    dh = Math.round(ch * scale);
  } else {
    const scale = Math.min(1, o.width / sw, o.height / sh);
    dw = Math.round(sw * scale);
    dh = Math.round(sh * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Couldn't process that picture.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, cw, ch, 0, 0, dw, dh);
  bitmap.close();

  for (const quality of [0.86, 0.78, 0.68, 0.58]) {
    const blob = await toBlob(canvas, "image/webp", quality);
    // Older Safari can't write WebP and silently returns PNG; use JPEG there.
    const out = blob && blob.type === "image/webp" ? blob : await toBlob(canvas, "image/jpeg", quality);
    if (!out) break;
    if (out.size <= o.maxBytes) {
      const webp = out.type === "image/webp";
      return { blob: out, ext: webp ? "webp" : "jpg", kind: "image", contentType: out.type };
    }
  }
  throw new ImageError(`That picture is too large even after shrinking. Try one under ${mb} MB.`);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** A random file name inside the person's own folder. */
export function newPath(userId: string, prefix: string, ext: string): string {
  return `${userId}/${prefix}-${crypto.randomUUID()}.${ext}`;
}

export const AVATAR = { width: 512, height: 512, crop: true, maxBytes: 5 * 1048576 };
export const BANNER = { width: 1500, height: 500, crop: true, maxBytes: 5 * 1048576 };
export const VEHICLE_PHOTO = { width: 1600, height: 1200, maxBytes: 8 * 1048576 };
export const GALLERY = { width: 2048, height: 2048, maxBytes: 8 * 1048576, allowGif: true };

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

/** Part of the picture to keep, in the picture's own pixels (after rotation). */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface Options {
  /** Box the picture must fit in, in pixels. */
  width: number;
  height: number;
  /** Crop to exactly width x height (avatars, banners) instead of fitting inside. */
  crop?: boolean;
  /** An exact area chosen in the cropper; overrides the automatic middle crop. */
  rect?: CropRect;
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
  if (o.rect) {
    sx = Math.max(0, Math.round(o.rect.sx));
    sy = Math.max(0, Math.round(o.rect.sy));
    cw = Math.min(sw - sx, Math.round(o.rect.sw));
    ch = Math.min(sh - sy, Math.round(o.rect.sh));
    const scale = Math.min(1, o.width / cw);
    dw = Math.round(cw * scale);
    dh = Math.round(ch * scale);
  } else if (o.crop) {
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

/**
 * Small copy of a gallery photo for the grid (11.94). About 3x a phone grid
 * square, so it stays sharp on high-density screens.
 */
export const THUMB = { width: 480, height: 480, maxBytes: 1048576 };

/** Where a photo's small copy lives: beside it, named thumb-<its name>. Same folder, same privacy. */
export function thumbPath(path: string): string {
  const i = path.lastIndexOf("/");
  return `${path.slice(0, i + 1)}thumb-${path.slice(i + 1)}`;
}

/** Uploaded paths are never reused, so browsers may keep them for a week. */
export const IMMUTABLE_CACHE = "604800";

/** A random file name inside the person's own folder. */
export function newPath(userId: string, prefix: string, ext: string): string {
  return `${userId}/${prefix}-${crypto.randomUUID()}.${ext}`;
}

export const AVATAR = { width: 512, height: 512, crop: true, maxBytes: 5 * 1048576 };
export const BANNER = { width: 1500, height: 600, crop: true, maxBytes: 5 * 1048576 };
export const BANNER_ASPECT = 5 / 2;
export const VEHICLE_PHOTO = { width: 1600, height: 1200, maxBytes: 8 * 1048576 };
export const GALLERY = { width: 2048, height: 2048, maxBytes: 8 * 1048576, allowGif: true };

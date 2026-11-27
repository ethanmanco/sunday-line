// Small copies of gallery photos for the grid (11.94).
//
// Made in the browser at upload, saved beside the photo as thumb-<name>. The
// storage rule goes by the owner's folder, so a small copy has exactly the
// photo's privacy. GIFs keep no small copy (they'd stop moving); the grid
// shows the GIF itself.

import { forgetSigned, getSupabase, type Media } from "./supabase";
import { IMMUTABLE_CACHE, prepareImage, THUMB, thumbPath } from "./images";

const BUCKET = "profile-media";

/** Make and upload the small copy of a photo just uploaded to `path`. Never throws. */
export async function uploadThumb(source: Blob, path: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const type = source.type || "image/webp";
    if (type === "image/gif") return false;
    const img = await prepareImage(new File([source], "photo", { type }), THUMB);
    // Already small: the photo itself is the best copy for the grid.
    if (img.blob.size >= source.size * 0.8) return false;
    const { error } = await sb.storage.from(BUCKET).upload(thumbPath(path), img.blob, {
      contentType: img.contentType, cacheControl: IMMUTABLE_CACHE, upsert: true,
    });
    forgetSigned(BUCKET, [thumbPath(path)]);
    return !error;
  } catch {
    return false;
  }
}

const tried = new Set<string>();

/**
 * Your own photos uploaded before small copies existed get one, quietly, the
 * next time you look at your profile or gallery. Each photo is tried once per
 * visit. Returns how many were made.
 */
export async function fillMissingThumbs(media: Media[], thumbs: Record<string, string>): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  let made = 0;
  for (const m of media) {
    if (m.kind !== "image" || thumbs[m.path] || tried.has(m.path)) continue;
    tried.add(m.path);
    const { data } = await sb.storage.from(BUCKET).download(m.path);
    if (data && (await uploadThumb(data, m.path))) made++;
  }
  return made;
}

/** Remove a photo and its small copy. */
export async function removePhotoFiles(path: string) {
  await getSupabase()?.storage.from(BUCKET).remove([path, thumbPath(path)]);
  forgetSigned(BUCKET, [path, thumbPath(path)]);
}

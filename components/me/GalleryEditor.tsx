"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPT_ATTR, GALLERY, ImageError, newPath, prepareImage } from "@/lib/images";
import { getSupabase, signedMediaUrls, type Media } from "@/lib/supabase";

const MAX = 24;

export default function GalleryEditor({ userId }: { userId: string }) {
  const [media, setMedia] = useState<Media[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("profile_media").select("*").eq("user_id", userId).order("sort").order("created_at", { ascending: false });
    const ms = (data as Media[] | null) ?? [];
    setMedia(ms);
    setUrls(await signedMediaUrls(ms.map((m) => m.path)));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(files: FileList | null) {
    const sb = getSupabase();
    if (!sb || !files?.length || !media) return;
    const room = MAX - media.length;
    const list = Array.from(files).slice(0, room);
    setError(files.length > room ? `Only ${room} more fit (${MAX} photos at most).` : null);
    for (const [i, file] of list.entries()) {
      setBusy(`Uploading ${i + 1} of ${list.length}...`);
      let path: string | null = null;
      try {
        const img = await prepareImage(file, GALLERY);
        path = newPath(userId, "photo", img.ext);
        const up = await sb.storage.from("profile-media").upload(path, img.blob, { contentType: img.contentType });
        if (up.error) throw new ImageError("Couldn't upload. Try again.");
        const { error } = await sb.from("profile_media").insert({ path, kind: img.kind, sort: 0 });
        if (error) throw new ImageError(error.message.includes("Limit") ? `That's the limit of ${MAX} photos.` : "Couldn't save. Try again.");
      } catch (e) {
        if (path) await sb.storage.from("profile-media").remove([path]);
        setError(`${file.name}: ${e instanceof ImageError ? e.message : "Couldn't upload."}`);
        break;
      }
    }
    setBusy(null);
    load();
  }

  async function remove(m: Media) {
    const sb = getSupabase();
    if (!sb || !window.confirm("Remove this photo?")) return;
    await sb.from("profile_media").delete().eq("id", m.id);
    await sb.storage.from("profile-media").remove([m.path]);
    load();
  }

  async function caption(m: Media, text: string) {
    const value = text.trim() || null;
    if (value === m.caption) return;
    await getSupabase()?.from("profile_media").update({ caption: value }).eq("id", m.id);
  }

  return (
    <section aria-labelledby="photos">
      <h2 id="photos">Photos</h2>
      {!media ? (
        <p className="fine">Loading...</p>
      ) : (
        <>
          <p className="fine">Photos and GIFs, up to {MAX}, each up to 8 MB.</p>
          <ul className="gallery editable">
            {media.map((m) => (
              <li key={m.id}>
                {urls[m.path] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[m.path]} alt={m.caption ?? "Photo"} loading="lazy" />
                )}
                <input
                  aria-label="Caption"
                  placeholder="Caption"
                  maxLength={200}
                  defaultValue={m.caption ?? ""}
                  onBlur={(e) => caption(m, e.target.value)}
                />
                <button type="button" className="link" onClick={() => remove(m)}>Remove</button>
              </li>
            ))}
          </ul>
          {media.length < MAX && (
            <button type="button" className="button ghost" disabled={!!busy} onClick={() => input.current?.click()}>
              {busy ?? "Add photos"}
            </button>
          )}
          {error && <p className="hint warn" role="alert">{error}</p>}
          <input ref={input} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </>
      )}
    </section>
  );
}

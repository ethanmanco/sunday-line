"use client";

import { useRef, useState } from "react";
import Cropper from "@/components/me/Cropper";
import { AVATAR, BANNER, BANNER_ASPECT, IMMUTABLE_CACHE, ImageError, prepareImage, type CropRect } from "@/lib/images";
import { getSupabase, type CropBox, type Group } from "@/lib/supabase";

type Which = "avatar" | "banner";
interface Cropping {
  which: Which;
  source: Blob;
  ext: "webp" | "jpg" | "gif";
  initial: CropBox | null;
  fresh: boolean;
}
const SOURCE = { width: 2048, height: 2048, maxBytes: 8 * 1048576 };
const BUCKET = "group-images";

/** Organizer only: the group's picture and banner, cropped like a profile's. */
export default function GroupPictures({ group, urls, onChanged }: {
  group: Group;
  urls: Record<string, string>;
  onChanged: () => void;
}) {
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Which | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cropping, setCropping] = useState<Cropping | null>(null);

  const sb = getSupabase()!;
  const remove = async (path: string | null) => {
    if (path) await sb.storage.from(BUCKET).remove([path]);
  };
  const newPath = (prefix: string, ext: string) => `${group.id}/${prefix}-${crypto.randomUUID()}.${ext}`;

  async function choose(which: Which, file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Use a JPEG, PNG, or WebP photo.");
      return;
    }
    setBusy(which);
    try {
      const src = await prepareImage(file, SOURCE);
      setCropping({ which, source: src.blob, ext: src.ext, initial: null, fresh: true });
    } catch (e) {
      setError(e instanceof ImageError ? e.message : "Couldn't read that picture.");
    } finally {
      setBusy(null);
    }
  }

  async function adjust(which: Which) {
    const path = which === "avatar" ? group.avatar_source_path : group.banner_source_path;
    if (!path) return;
    setBusy(which);
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    setBusy(null);
    if (error || !data) return setError("Couldn't open the original picture. Upload it again.");
    setCropping({ which, source: data, ext: path.endsWith(".jpg") ? "jpg" : "webp", initial: which === "avatar" ? group.avatar_crop : group.banner_crop, fresh: false });
  }

  async function finish(c: Cropping, rect: CropRect) {
    setBusy(c.which);
    setError(null);
    const made: { image?: string; source?: string } = {};
    try {
      const type = c.source.type || (c.ext === "jpg" ? "image/jpeg" : "image/webp");
      const img = await prepareImage(new File([c.source], `source.${c.ext}`, { type }), { ...(c.which === "avatar" ? AVATAR : BANNER), rect });
      made.image = newPath(c.which, img.ext);
      if ((await sb.storage.from(BUCKET).upload(made.image, img.blob, { contentType: img.contentType, cacheControl: IMMUTABLE_CACHE })).error) throw new ImageError("Couldn't upload.");
      if (c.fresh) {
        made.source = newPath(`source-${c.which}`, c.ext);
        if ((await sb.storage.from(BUCKET).upload(made.source, c.source, { contentType: type })).error) throw new ImageError("Couldn't upload.");
      }
      const crop = { sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh };
      const row = c.which === "avatar"
        ? { avatar_path: made.image, avatar_crop: crop, ...(c.fresh ? { avatar_source_path: made.source } : {}) }
        : { banner_path: made.image, banner_crop: crop, ...(c.fresh ? { banner_source_path: made.source } : {}) };
      if ((await sb.from("groups").update(row).eq("id", group.id)).error) throw new ImageError("Couldn't save.");
      await remove(c.which === "avatar" ? group.avatar_path : group.banner_path);
      if (c.fresh) await remove(c.which === "avatar" ? group.avatar_source_path : group.banner_source_path);
      onChanged();
    } catch (e) {
      await remove(made.image ?? null);
      await remove(made.source ?? null);
      setError(e instanceof ImageError ? e.message : "Couldn't upload. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function clear(which: Which) {
    setBusy(which);
    const row = which === "avatar"
      ? { avatar_path: null, avatar_source_path: null, avatar_crop: null }
      : { banner_path: null, banner_source_path: null, banner_crop: null };
    await sb.from("groups").update(row).eq("id", group.id);
    await remove(which === "avatar" ? group.avatar_path : group.banner_path);
    await remove(which === "avatar" ? group.avatar_source_path : group.banner_source_path);
    setBusy(null);
    onChanged();
  }

  const banner = group.banner_path ? urls[group.banner_path] : null;
  const avatar = group.avatar_path ? urls[group.avatar_path] : null;
  return (
    <div className="pictures">
      <div className="banner small" style={banner ? { backgroundImage: `url("${banner}")` } : undefined} />
      <div className="row">
        <button type="button" className="button ghost" disabled={!!busy} onClick={() => bannerInput.current?.click()}>
          {busy === "banner" ? "Working..." : banner ? "Change banner" : "Add a banner"}
        </button>
        {group.banner_source_path && <button type="button" className="button ghost" disabled={!!busy} onClick={() => adjust("banner")}>Adjust crop</button>}
        {banner && <button type="button" className="link" disabled={!!busy} onClick={() => clear("banner")}>Remove</button>}
      </div>
      <div className="avatar-row">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="group-avatar" width={72} height={72} />
        ) : (
          <span className="group-mark big" aria-hidden="true">{group.name.trim()[0]?.toUpperCase()}</span>
        )}
        <div className="row">
          <button type="button" className="button ghost" disabled={!!busy} onClick={() => avatarInput.current?.click()}>
            {busy === "avatar" ? "Working..." : avatar ? "Change picture" : "Add a group picture"}
          </button>
          {group.avatar_source_path && <button type="button" className="button ghost" disabled={!!busy} onClick={() => adjust("avatar")}>Adjust crop</button>}
          {avatar && <button type="button" className="link" disabled={!!busy} onClick={() => clear("avatar")}>Remove</button>}
        </div>
      </div>
      {error && <p className="hint warn" role="alert">{error}</p>}
      <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose("avatar", e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose("banner", e.target.files?.[0]); e.target.value = ""; }} />
      {cropping && (
        <Cropper
          file={cropping.source}
          aspect={cropping.which === "avatar" ? 1 : BANNER_ASPECT}
          initial={cropping.initial}
          title={cropping.which === "avatar" ? "Crop the group picture" : "Crop the group banner"}
          onCancel={() => setCropping(null)}
          onDone={(rect) => { const c = cropping; setCropping(null); finish(c, rect); }}
        />
      )}
    </div>
  );
}

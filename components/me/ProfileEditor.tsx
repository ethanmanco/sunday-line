"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import AvatarLibraryPicker from "./AvatarLibraryPicker";
import { useAuth } from "@/components/AuthProvider";
import Cropper from "./Cropper";
import UsernameField, { BLOCKING, profileSaveError, type Availability } from "./UsernameField";
import { AVATAR, BANNER, BANNER_ASPECT, ImageError, newPath, prepareImage, type CropRect } from "@/lib/images";
import { getSupabase, publicImageUrl, USERNAME_PATTERN, type CropBox, type DmPolicy, type OwnProfile } from "@/lib/supabase";

type Which = "avatar" | "banner";
interface Cropping {
  which: Which;
  source: Blob;
  ext: "webp" | "jpg" | "gif";
  initial: CropBox | null;
  /** A new upload (keep its original too) rather than a new crop of the old one. */
  fresh: boolean;
}
/** The kept original: resized and stripped, big enough to re-crop well. */
const SOURCE = { width: 2048, height: 2048, maxBytes: 8 * 1048576 };

export default function ProfileEditor({ profile }: { profile: OwnProfile }) {
  const { refreshProfile } = useAuth();
  const [username, setUsername] = useState(profile.username);
  const [name, setName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [isPrivate, setIsPrivate] = useState(profile.is_private);
  const [dmPolicy, setDmPolicy] = useState<DmPolicy>(profile.dm_policy);
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setUsername(profile.username);
    setName(profile.display_name);
    setBio(profile.bio ?? "");
    setIsPrivate(profile.is_private);
    setDmPolicy(profile.dm_policy);
  }, [profile]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    if (!USERNAME_PATTERN.test(username)) {
      setMessage("Usernames are 3 to 20 letters, numbers, or underscores.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await sb.from("profiles").update({
      username,
      display_name: name.trim() || username,
      bio: bio.trim() || null,
      is_private: isPrivate,
      dm_policy: dmPolicy,
    }).eq("id", profile.id);
    setBusy(false);
    if (error) {
      setMessage(profileSaveError(error.code, error.message));
      return;
    }
    await refreshProfile();
    setMessage("Saved.");
  }

  return (
    <section aria-labelledby="me-profile">
      <h2 id="me-profile">Profile</h2>
      <Pictures profile={profile} />
      <form onSubmit={save} className="form">
        <UsernameField value={username} current={profile.username} onChange={setUsername} onAvailability={setAvailability} />
        <label>
          <span>Display name (optional, shown with your ratings)</span>
          <input maxLength={40} placeholder={username} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Bio (optional)</span>
          <textarea maxLength={300} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Favorite roads, what you're building, where you meet up" />
        </label>
        <label className="check">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          <span>
            Private profile. Only followers you approve see your garage, photos, and follow lists. Your name, picture,
            bio, and road ratings stay public.
          </span>
        </label>
        <fieldset>
          <legend>Who can message you</legend>
          <div className="seg">
            {([["everyone", "Everyone"], ["following", "People I follow"], ["nobody", "Nobody"]] as [DmPolicy, string][]).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={dmPolicy === k} onClick={() => setDmPolicy(k)}>{label}</button>
            ))}
          </div>
          <span className="fine">People you message first can always reply. Blocked people can never message you. With a private profile, messages from people you don&apos;t follow and haven&apos;t approved wait until you accept their follow request.</span>
        </fieldset>
        {profile.is_private && !isPrivate && (
          <p className="fine warn">Going public approves everyone waiting to follow you.</p>
        )}
        <button type="submit" className="button" disabled={busy || BLOCKING.includes(availability)}>
          {busy ? "Saving..." : "Save profile"}
        </button>
        {message && <p className="hint" role="status">{message}</p>}
      </form>
    </section>
  );
}

function Pictures({ profile }: { profile: OwnProfile }) {
  const { refreshProfile } = useAuth();
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState<Cropping | null>(null);
  const current = !!profile.avatar_preset;
  const libraryId = profile.avatar_preset?.startsWith("lib:") ? profile.avatar_preset.slice(4) : null;

  async function removeImage(path: string | null) {
    if (path) await getSupabase()?.storage.from("profile-images").remove([path]);
  }
  async function removeSource(path: string | null) {
    if (path) await getSupabase()?.storage.from("profile-media").remove([path]);
  }

  // New picture: shrink it and strip its hidden details first, then crop.
  async function choose(which: Which, file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(file.type === "image/gif" ? "GIFs work in the gallery. Use a photo here." : "Use a JPEG, PNG, or WebP photo.");
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

  // Change the crop of the picture already uploaded.
  async function adjust(which: Which) {
    const sb = getSupabase();
    const path = which === "avatar" ? profile.avatar_source_path : profile.banner_source_path;
    if (!sb || !path) return;
    setBusy(which);
    setError(null);
    const { data, error } = await sb.storage.from("profile-media").download(path);
    setBusy(null);
    if (error || !data) {
      setError("Couldn't open the original picture. Upload it again to crop it.");
      return;
    }
    setCropping({
      which,
      source: data,
      ext: path.endsWith(".jpg") ? "jpg" : "webp",
      initial: which === "avatar" ? profile.avatar_crop : profile.banner_crop,
      fresh: false,
    });
  }

  async function finish(c: Cropping, rect: CropRect) {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(c.which);
    setError(null);
    const made: { image?: string; source?: string } = {};
    try {
      const type = c.source.type || (c.ext === "jpg" ? "image/jpeg" : "image/webp");
      const sourceFile = new File([c.source], `source.${c.ext}`, { type });
      const img = await prepareImage(sourceFile, { ...(c.which === "avatar" ? AVATAR : BANNER), rect });
      made.image = newPath(profile.id, c.which, img.ext);
      const up = await sb.storage.from("profile-images").upload(made.image, img.blob, { contentType: img.contentType, cacheControl: "31536000" });
      if (up.error) throw new ImageError("Couldn't upload. Try again.");
      if (c.fresh) {
        made.source = newPath(profile.id, `source-${c.which}`, c.ext);
        const upSrc = await sb.storage.from("profile-media").upload(made.source, c.source, { contentType: type });
        if (upSrc.error) throw new ImageError("Couldn't upload. Try again.");
      }
      const crop = { sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh };
      const row =
        c.which === "avatar"
          ? { avatar_path: made.image, avatar_crop: crop, avatar_preset: null, ...(c.fresh ? { avatar_source_path: made.source } : {}) }
          : { banner_path: made.image, banner_crop: crop, ...(c.fresh ? { banner_source_path: made.source } : {}) };
      const { error } = await sb.from("profiles").update(row).eq("id", profile.id);
      if (error) throw new ImageError("Couldn't save. Try again.");
      await removeImage(c.which === "avatar" ? profile.avatar_path : profile.banner_path);
      if (c.fresh) await removeSource(c.which === "avatar" ? profile.avatar_source_path : profile.banner_source_path);
      await refreshProfile();
    } catch (e) {
      await removeImage(made.image ?? null);
      await removeSource(made.source ?? null);
      setError(e instanceof ImageError ? e.message : "Couldn't upload. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function clear(which: Which) {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(which);
    if (which === "avatar") {
      await sb.from("profiles").update({ avatar_path: null, avatar_preset: null, avatar_source_path: null, avatar_crop: null }).eq("id", profile.id);
      await removeImage(profile.avatar_path);
      await removeSource(profile.avatar_source_path);
    } else {
      await sb.from("profiles").update({ banner_path: null, banner_source_path: null, banner_crop: null }).eq("id", profile.id);
      await removeImage(profile.banner_path);
      await removeSource(profile.banner_source_path);
    }
    await refreshProfile();
    setBusy(null);
  }

  async function usePreset(id: string) {
    const sb = getSupabase();
    if (!sb) return;
    setBusy("avatar");
    await sb.from("profiles")
      .update({ avatar_preset: `lib:${id}`, avatar_path: null, avatar_source_path: null, avatar_crop: null })
      .eq("id", profile.id);
    await removeImage(profile.avatar_path);
    await removeSource(profile.avatar_source_path);
    await refreshProfile();
    setBusy(null);
    setPicking(false);
  }

  const banner = publicImageUrl(profile.banner_path);
  return (
    <div className="pictures">
      <div className="banner small" style={banner ? { backgroundImage: `url("${banner}")` } : undefined} />
      <div className="row">
        <button type="button" className="button ghost" disabled={!!busy} onClick={() => bannerInput.current?.click()}>
          {busy === "banner" ? "Uploading..." : banner ? "Change banner" : "Add a banner"}
        </button>
        {banner && profile.banner_source_path && (
          <button type="button" className="button ghost" disabled={!!busy} onClick={() => adjust("banner")}>Adjust crop</button>
        )}
        {banner && <button type="button" className="link" disabled={!!busy} onClick={() => clear("banner")}>Remove banner</button>}
      </div>
      <div className="avatar-row">
        <Avatar person={profile} size={72} />
        <div className="row">
          <button type="button" className="button ghost" disabled={!!busy} onClick={() => avatarInput.current?.click()}>
            {busy === "avatar" ? "Saving..." : "Upload a photo"}
          </button>
          {profile.avatar_path && profile.avatar_source_path && (
            <button type="button" className="button ghost" disabled={!!busy} onClick={() => adjust("avatar")}>Adjust crop</button>
          )}
          <button type="button" className="button ghost" disabled={!!busy} onClick={() => setPicking(!picking)} aria-expanded={picking}>
            Pick a car or bike
          </button>
          {(profile.avatar_path || current) && (
            <button type="button" className="link" disabled={!!busy} onClick={() => clear("avatar")}>Remove</button>
          )}
        </div>
      </div>
      {picking && (
        <AvatarLibraryPicker current={libraryId} busy={busy === "avatar"} onPick={usePreset} onCancel={() => setPicking(false)} />
      )}
      <p className="fine">Photos are resized and their hidden details (like where they were taken) are removed before upload.</p>
      {error && <p className="hint warn" role="alert">{error}</p>}
      <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose("avatar", e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose("banner", e.target.files?.[0]); e.target.value = ""; }} />
      {cropping && (
        <Cropper
          file={cropping.source}
          aspect={cropping.which === "avatar" ? 1 : BANNER_ASPECT}
          round={cropping.which === "avatar"}
          initial={cropping.initial}
          title={cropping.which === "avatar" ? "Crop your profile picture" : "Crop your banner"}
          onCancel={() => setCropping(null)}
          onDone={(rect) => {
            const c = cropping;
            setCropping(null);
            finish(c, rect);
          }}
        />
      )}
    </div>
  );
}

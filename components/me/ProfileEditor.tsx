"use client";

import { useEffect, useRef, useState } from "react";
import Avatar, { COLORS, parsePreset, PresetDrawing, SHAPES } from "@/components/Avatar";
import { useAuth } from "@/components/AuthProvider";
import Cropper from "./Cropper";
import UsernameField, { BLOCKING, profileSaveError, type Availability } from "./UsernameField";
import { AVATAR, BANNER, BANNER_ASPECT, ImageError, newPath, prepareImage, type CropRect } from "@/lib/images";
import { getSupabase, publicImageUrl, USERNAME_PATTERN, type Profile } from "@/lib/supabase";

export default function ProfileEditor({ profile }: { profile: Profile }) {
  const { refreshProfile } = useAuth();
  const [username, setUsername] = useState(profile.username);
  const [name, setName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [isPrivate, setIsPrivate] = useState(profile.is_private);
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setUsername(profile.username);
    setName(profile.display_name);
    setBio(profile.bio ?? "");
    setIsPrivate(profile.is_private);
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

function Pictures({ profile }: { profile: Profile }) {
  const { refreshProfile } = useAuth();
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState<{ which: "avatar" | "banner"; file: File } | null>(null);
  const current = parsePreset(profile.avatar_preset);
  const [shape, setShape] = useState(profile.avatar_preset?.split("-")[0] ?? "roadster");
  const [color, setColor] = useState(profile.avatar_preset?.split("-")[1] ?? "orange");

  async function removeFile(path: string | null) {
    if (path) await getSupabase()?.storage.from("profile-images").remove([path]);
  }

  function choose(which: "avatar" | "banner", file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(file.type === "image/gif" ? "GIFs work in the gallery. Use a photo here." : "Use a JPEG, PNG, or WebP photo.");
      return;
    }
    setCropping({ which, file });
  }

  async function upload(which: "avatar" | "banner", file: File, rect: CropRect) {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(which);
    setError(null);
    try {
      const img = await prepareImage(file, { ...(which === "avatar" ? AVATAR : BANNER), rect });
      const path = newPath(profile.id, which, img.ext);
      const up = await sb.storage.from("profile-images").upload(path, img.blob, { contentType: img.contentType, cacheControl: "31536000" });
      if (up.error) throw new ImageError("Couldn't upload. Try again.");
      const old = which === "avatar" ? profile.avatar_path : profile.banner_path;
      const { error } = await sb.from("profiles").update(which === "avatar" ? { avatar_path: path } : { banner_path: path }).eq("id", profile.id);
      if (error) {
        await removeFile(path);
        throw new ImageError("Couldn't save. Try again.");
      }
      await removeFile(old);
      await refreshProfile();
    } catch (e) {
      setError(e instanceof ImageError ? e.message : "Couldn't upload. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function clear(which: "avatar" | "banner") {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(which);
    const old = which === "avatar" ? profile.avatar_path : profile.banner_path;
    await sb.from("profiles").update(which === "avatar" ? { avatar_path: null, avatar_preset: null } : { banner_path: null }).eq("id", profile.id);
    await removeFile(old);
    await refreshProfile();
    setBusy(null);
  }

  async function usePreset() {
    const sb = getSupabase();
    if (!sb) return;
    setBusy("avatar");
    const old = profile.avatar_path;
    await sb.from("profiles").update({ avatar_preset: `${shape}-${color}`, avatar_path: null }).eq("id", profile.id);
    await removeFile(old);
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
        {banner && <button type="button" className="link" disabled={!!busy} onClick={() => clear("banner")}>Remove banner</button>}
      </div>
      <div className="avatar-row">
        <Avatar person={profile} size={72} />
        <div className="row">
          <button type="button" className="button ghost" disabled={!!busy} onClick={() => avatarInput.current?.click()}>
            {busy === "avatar" ? "Saving..." : "Upload a photo"}
          </button>
          <button type="button" className="button ghost" disabled={!!busy} onClick={() => setPicking(!picking)} aria-expanded={picking}>
            Pick a drawing
          </button>
          {(profile.avatar_path || current) && (
            <button type="button" className="link" disabled={!!busy} onClick={() => clear("avatar")}>Remove</button>
          )}
        </div>
      </div>
      {picking && (
        <div className="preset-picker">
          <fieldset>
            <legend>Body style</legend>
            <div className="preset-grid">
              {Object.entries(SHAPES).map(([k, s]) => (
                <button key={k} type="button" aria-pressed={shape === k} onClick={() => setShape(k)} aria-label={s.label} title={s.label}>
                  <PresetDrawing preset={`${k}-${color}`} />
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Color</legend>
            <div className="swatches">
              {Object.entries(COLORS).map(([k, c]) => (
                <button key={k} type="button" aria-pressed={color === k} onClick={() => setColor(k)} aria-label={k} title={k} style={{ background: c }} />
              ))}
            </div>
          </fieldset>
          <div className="row">
            <button type="button" className="button" disabled={!!busy} onClick={usePreset}>Use this one</button>
            <button type="button" className="button ghost" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      )}
      <p className="fine">Photos are resized and their hidden details (like where they were taken) are removed before upload.</p>
      {error && <p className="hint warn" role="alert">{error}</p>}
      <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose("avatar", e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose("banner", e.target.files?.[0]); e.target.value = ""; }} />
      {cropping && (
        <Cropper
          file={cropping.file}
          aspect={cropping.which === "avatar" ? 1 : BANNER_ASPECT}
          round={cropping.which === "avatar"}
          title={cropping.which === "avatar" ? "Crop your profile picture" : "Crop your banner"}
          onCancel={() => setCropping(null)}
          onDone={(rect) => {
            const c = cropping;
            setCropping(null);
            upload(c.which, c.file, rect);
          }}
        />
      )}
    </div>
  );
}

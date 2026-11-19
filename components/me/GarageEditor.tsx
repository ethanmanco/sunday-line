"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import VehicleCard from "@/components/profile/VehicleCard";
import { ImageError, newPath, prepareImage, VEHICLE_PHOTO } from "@/lib/images";
import {
  getSupabase, signedMediaUrls, sortPhotos, vehicleName, type Vehicle, type VehicleKind, type VehiclePhoto,
} from "@/lib/supabase";

const MAX_VEHICLES = 10;
const MAX_PHOTOS = 8;
const PHOTO_TYPES = "image/jpeg,image/png,image/webp";

export default function GarageEditor({ userId }: { userId: string }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [photos, setPhotos] = useState<VehiclePhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [v, p] = await Promise.all([
      sb.from("vehicles").select("*").eq("user_id", userId).order("sort").order("created_at"),
      sb.from("vehicle_photos").select("*").eq("user_id", userId),
    ]);
    const ps = (p.data as VehiclePhoto[] | null) ?? [];
    setVehicles((v.data as Vehicle[] | null) ?? []);
    setPhotos(ps);
    setUrls(await signedMediaUrls(ps.map((x) => x.path)));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(v: Vehicle) {
    const sb = getSupabase();
    if (!sb || !window.confirm(`Remove the ${vehicleName(v)} and its photos from your garage?`)) return;
    const paths = photos.filter((p) => p.vehicle_id === v.id).map((p) => p.path);
    await sb.from("vehicles").delete().eq("id", v.id);
    if (paths.length) await sb.storage.from("profile-media").remove(paths);
    load();
  }

  const photosOf = (id: string) => sortPhotos(photos.filter((p) => p.vehicle_id === id));

  return (
    <section aria-labelledby="garage">
      <h2 id="garage">Garage</h2>
      {!vehicles ? (
        <p className="fine">Loading...</p>
      ) : (
        <>
          {vehicles.length === 0 && <p className="fine">Add what you drive or ride, with up to {MAX_PHOTOS} photos each.</p>}
          <ul className="garage editable">
            {vehicles.map((v) =>
              editing === v.id ? (
                <li key={v.id} className="wide">
                  <VehicleForm
                    userId={userId}
                    vehicle={v}
                    photos={photosOf(v.id)}
                    urls={urls}
                    sort={v.sort}
                    onChanged={load}
                    onDone={() => { setEditing(null); load(); }}
                  />
                </li>
              ) : (
                <VehicleCard key={v.id} vehicle={v} photos={photosOf(v.id)} urls={urls}>
                  <p className="row">
                    <button type="button" className="link" onClick={() => setEditing(v.id)}>Edit and photos</button>
                    <button type="button" className="link" onClick={() => remove(v)}>Remove</button>
                  </p>
                </VehicleCard>
              ),
            )}
          </ul>
          {editing === "new" ? (
            <VehicleForm
              userId={userId}
              vehicle={null}
              photos={[]}
              urls={urls}
              sort={vehicles.length}
              onChanged={load}
              onDone={() => { setEditing(null); load(); }}
            />
          ) : vehicles.length < MAX_VEHICLES ? (
            <button type="button" className="button ghost" onClick={() => setEditing("new")}>Add a vehicle</button>
          ) : (
            <p className="fine">That&apos;s the limit of {MAX_VEHICLES} vehicles.</p>
          )}
        </>
      )}
    </section>
  );
}

async function uploadPhoto(userId: string, vehicleId: string, file: File, sort: number) {
  const sb = getSupabase();
  if (!sb) throw new ImageError("Not signed in.");
  const img = await prepareImage(file, VEHICLE_PHOTO);
  const path = newPath(userId, "vehicle", img.ext);
  const up = await sb.storage.from("profile-media").upload(path, img.blob, { contentType: img.contentType });
  if (up.error) throw new ImageError("Couldn't upload. Try again.");
  const { error } = await sb.from("vehicle_photos").insert({ vehicle_id: vehicleId, path, sort });
  if (error) {
    await sb.storage.from("profile-media").remove([path]);
    throw new ImageError(error.message.includes("Limit") ? `That's the limit of ${MAX_PHOTOS} photos.` : "Couldn't save. Try again.");
  }
}

function VehicleForm({ userId, vehicle, photos, urls, sort, onChanged, onDone }: {
  userId: string;
  vehicle: Vehicle | null;
  photos: VehiclePhoto[];
  urls: Record<string, string>;
  sort: number;
  onChanged: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<VehicleKind>(vehicle?.kind ?? "car");
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : "");
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Photos for a vehicle that already exists are saved right away.
  async function addNow(files: File[]) {
    if (!vehicle) return;
    const room = MAX_PHOTOS - photos.length;
    const list = files.slice(0, room);
    setError(files.length > room ? `Only ${room} more fit (${MAX_PHOTOS} per vehicle).` : null);
    let next = photos.length ? Math.max(...photos.map((p) => p.sort)) + 1 : 0;
    for (const [i, f] of list.entries()) {
      setBusy(`Uploading ${i + 1} of ${list.length}...`);
      try {
        await uploadPhoto(userId, vehicle.id, f, next++);
      } catch (e) {
        setError(`${f.name}: ${e instanceof ImageError ? e.message : "Couldn't upload."}`);
        break;
      }
    }
    setBusy(null);
    onChanged();
  }

  async function makeCover(p: VehiclePhoto) {
    const sb = getSupabase();
    if (!sb) return;
    const lowest = Math.min(...photos.map((x) => x.sort));
    await sb.from("vehicle_photos").update({ sort: lowest - 1 }).eq("id", p.id);
    onChanged();
  }

  async function removePhoto(p: VehiclePhoto) {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from("vehicle_photos").delete().eq("id", p.id);
    await sb.storage.from("profile-media").remove([p.path]);
    onChanged();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    const y = year.trim() ? Number(year) : null;
    if (y !== null && !(Number.isInteger(y) && y >= 1885 && y <= 2100)) {
      setError("Year should look like 2019.");
      return;
    }
    setBusy("Saving...");
    setError(null);
    const row = { kind, year: y, make: make.trim() || null, model: model.trim() };
    if (vehicle) {
      const { error } = await sb.from("vehicles").update(row).eq("id", vehicle.id);
      setBusy(null);
      if (error) setError("Couldn't save. Try again.");
      else onDone();
      return;
    }
    const { data, error } = await sb.from("vehicles").insert({ ...row, sort }).select("id").single();
    if (error || !data) {
      setBusy(null);
      setError(error?.message.includes("Limit") ? `That's the limit of ${MAX_VEHICLES} vehicles.` : "Couldn't save. Try again.");
      return;
    }
    for (const [i, f] of pending.entries()) {
      setBusy(`Uploading ${i + 1} of ${pending.length}...`);
      try {
        await uploadPhoto(userId, (data as { id: string }).id, f, i);
      } catch (err) {
        setError(`${f.name}: ${err instanceof ImageError ? err.message : "Couldn't upload."}`);
        setBusy(null);
        onChanged();
        return;
      }
    }
    setBusy(null);
    onDone();
  }

  const count = vehicle ? photos.length : pending.length;
  return (
    <form onSubmit={save} className="form rate">
      <fieldset>
        <legend>Type</legend>
        <div className="seg">
          {(["car", "motorcycle"] as VehicleKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "car" ? "Car" : "Motorcycle"}</button>
          ))}
        </div>
      </fieldset>
      <div className="row three">
        <label>
          <span>Year</span>
          <input inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} placeholder="2020" />
        </label>
        <label>
          <span>Make</span>
          <input maxLength={40} value={make} onChange={(e) => setMake(e.target.value)} placeholder="BMW" />
        </label>
        <label>
          <span>Model</span>
          <input required maxLength={60} value={model} onChange={(e) => setModel(e.target.value)} placeholder="M2 Competition" />
        </label>
      </div>

      <fieldset>
        <legend>Photos ({count} of {MAX_PHOTOS}){vehicle && photos.length > 1 ? ". The first one is the cover." : ""}</legend>
        {vehicle && photos.length > 0 && (
          <ul className="photo-manage">
            {photos.map((p, i) => (
              <li key={p.id}>
                {urls[p.path] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[p.path]} alt={`Photo ${i + 1}`} />
                )}
                {i === 0 ? <span className="tag">Cover</span> : (
                  <button type="button" className="link" onClick={() => makeCover(p)}>Make cover</button>
                )}
                <button type="button" className="link" onClick={() => removePhoto(p)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {!vehicle && pending.length > 0 && (
          <ul className="pending-files">
            {pending.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                {f.name}{" "}
                <button type="button" className="link" onClick={() => setPending(pending.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        {count < MAX_PHOTOS && (
          <button type="button" className="button ghost" disabled={!!busy} onClick={() => input.current?.click()}>
            {busy && busy !== "Saving..." ? busy : "Add photos"}
          </button>
        )}
      </fieldset>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (vehicle) addNow(files);
          else setPending([...pending, ...files].slice(0, MAX_PHOTOS));
        }}
      />
      <div className="row">
        <button type="submit" className="button" disabled={!!busy}>{busy === "Saving..." ? busy : vehicle ? "Done" : "Save vehicle"}</button>
        <button type="button" className="button ghost" onClick={onDone}>{vehicle ? "Close" : "Cancel"}</button>
      </div>
      {error && <p className="hint warn" role="alert">{error}</p>}
    </form>
  );
}

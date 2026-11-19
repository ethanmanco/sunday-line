"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageError, newPath, prepareImage, VEHICLE_PHOTO } from "@/lib/images";
import { getSupabase, signedMediaUrls, vehicleName, type Vehicle, type VehicleKind } from "@/lib/supabase";

const MAX = 10;

export default function GarageEditor({ userId }: { userId: string }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("vehicles").select("*").eq("user_id", userId).order("sort").order("created_at");
    const vs = (data as Vehicle[] | null) ?? [];
    setVehicles(vs);
    setUrls(await signedMediaUrls(vs.flatMap((v) => (v.photo_path ? [v.photo_path] : []))));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(v: Vehicle) {
    const sb = getSupabase();
    if (!sb || !window.confirm(`Remove the ${vehicleName(v)} from your garage?`)) return;
    await sb.from("vehicles").delete().eq("id", v.id);
    if (v.photo_path) await sb.storage.from("profile-media").remove([v.photo_path]);
    load();
  }

  return (
    <section aria-labelledby="garage">
      <h2 id="garage">Garage</h2>
      {!vehicles ? (
        <p className="fine">Loading...</p>
      ) : (
        <>
          {vehicles.length === 0 && <p className="fine">Add what you drive or ride.</p>}
          <ul className="garage editable">
            {vehicles.map((v) =>
              editing !== "new" && editing?.id === v.id ? (
                <li key={v.id} className="wide">
                  <VehicleForm userId={userId} vehicle={v} sort={v.sort} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={v.id}>
                  {v.photo_path && urls[v.photo_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[v.photo_path]} alt={vehicleName(v)} loading="lazy" />
                  ) : (
                    <div className="garage-blank" aria-hidden="true">{v.kind === "motorcycle" ? "Motorcycle" : "Car"}</div>
                  )}
                  <p><b>{vehicleName(v)}</b></p>
                  <p className="row">
                    <button type="button" className="link" onClick={() => setEditing(v)}>Edit</button>
                    <button type="button" className="link" onClick={() => remove(v)}>Remove</button>
                  </p>
                </li>
              ),
            )}
          </ul>
          {editing === "new" ? (
            <VehicleForm userId={userId} vehicle={null} sort={vehicles.length} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
          ) : vehicles.length < MAX ? (
            <button type="button" className="button ghost" onClick={() => setEditing("new")}>Add a vehicle</button>
          ) : (
            <p className="fine">That&apos;s the limit of {MAX} vehicles.</p>
          )}
        </>
      )}
    </section>
  );
}

function VehicleForm({ userId, vehicle, sort, onDone, onCancel }: {
  userId: string;
  vehicle: Vehicle | null;
  sort: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<VehicleKind>(vehicle?.kind ?? "car");
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : "");
  const [make, setMake] = useState(vehicle?.make ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    const y = year.trim() ? Number(year) : null;
    if (y !== null && !(Number.isInteger(y) && y >= 1885 && y <= 2100)) {
      setError("Year should look like 2019.");
      return;
    }
    setBusy(true);
    setError(null);
    let photoPath = dropPhoto ? null : vehicle?.photo_path ?? null;
    let uploaded: string | null = null;
    try {
      if (file) {
        const img = await prepareImage(file, VEHICLE_PHOTO);
        uploaded = newPath(userId, "vehicle", img.ext);
        const up = await sb.storage.from("profile-media").upload(uploaded, img.blob, { contentType: img.contentType });
        if (up.error) throw new ImageError("Couldn't upload the photo. Try again.");
        photoPath = uploaded;
      }
      const row = { kind, year: y, make: make.trim() || null, model: model.trim(), photo_path: photoPath };
      const res = vehicle
        ? await sb.from("vehicles").update(row).eq("id", vehicle.id)
        : await sb.from("vehicles").insert({ ...row, sort });
      if (res.error) throw new ImageError(res.error.message.includes("Limit") ? "That's the limit of 10 vehicles." : "Couldn't save. Try again.");
      if (vehicle?.photo_path && vehicle.photo_path !== photoPath) await sb.storage.from("profile-media").remove([vehicle.photo_path]);
      onDone();
    } catch (err) {
      if (uploaded) await sb.storage.from("profile-media").remove([uploaded]);
      setError(err instanceof ImageError ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

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
      <div className="row">
        <button type="button" className="button ghost" onClick={() => input.current?.click()}>
          {file ? "Change photo" : vehicle?.photo_path && !dropPhoto ? "Replace photo" : "Add a photo"}
        </button>
        {file && <span className="fine">{file.name}</span>}
        {vehicle?.photo_path && !file && !dropPhoto && (
          <button type="button" className="link" onClick={() => setDropPhoto(true)}>Remove photo</button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setDropPhoto(false); e.target.value = ""; }} />
      <div className="row">
        <button type="submit" className="button" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="hint warn" role="alert">{error}</p>}
    </form>
  );
}

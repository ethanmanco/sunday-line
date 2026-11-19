"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import {
  accountsEnabled, getSupabase, PAVEMENT_LABEL, rememberReturn, TRAFFIC_LABEL,
  type PavementCondition, type RoadCommunity, type RoadRating, type TrafficLevel, type VehicleKind,
} from "@/lib/supabase";

interface Note {
  fun: number | null;
  pavement: PavementCondition | null;
  vehicle: VehicleKind | null;
  note: string;
  updated_at: string;
  profiles: { display_name: string } | null;
}

const LIMITS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];

function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-hidden="true">
      {"★★★★★".slice(0, Math.round(n))}
      <span className="off">{"★★★★★".slice(Math.round(n))}</span>
    </span>
  );
}

function summaryLines(c: RoadCommunity): string[] {
  const out: string[] = [];
  const pav: [PavementCondition, number][] = [
    ["smooth", c.pavement_smooth], ["patchy", c.pavement_patchy], ["rough", c.pavement_rough], ["loose_gravel", c.pavement_loose_gravel],
  ];
  const pavTotal = pav.reduce((a, [, n]) => a + n, 0);
  if (pavTotal) {
    const top = pav.reduce((a, b) => (b[1] > a[1] ? b : a));
    out.push(`Pavement: mostly ${PAVEMENT_LABEL[top[0]].toLowerCase()} (${pavTotal} ${pavTotal === 1 ? "report" : "reports"})`);
  }
  const tr: [TrafficLevel, number][] = [["empty", c.traffic_empty], ["light", c.traffic_light], ["busy", c.traffic_busy]];
  const trTotal = tr.reduce((a, [, n]) => a + n, 0);
  if (trTotal) {
    const top = tr.reduce((a, b) => (b[1] > a[1] ? b : a));
    out.push(`Traffic: usually ${TRAFFIC_LABEL[top[0]].toLowerCase()}`);
  }
  if (c.drove_count) out.push(`${c.drove_count} ${c.drove_count === 1 ? "member has" : "members have"} driven it`);
  const from = [
    c.by_car ? `${c.by_car} ${c.by_car === 1 ? "car" : "cars"}` : null,
    c.by_motorcycle ? `${c.by_motorcycle} ${c.by_motorcycle === 1 ? "motorcycle" : "motorcycles"}` : null,
  ].filter(Boolean);
  if (from.length) out.push(`Rated from ${from.join(" and ")}`);
  return out;
}

export default function Community({ roadId, units }: { roadId: string; units: string }) {
  const { ready, user, profile } = useAuth();
  const [summary, setSummary] = useState<RoadCommunity | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [mine, setMine] = useState<RoadRating | null>(null);
  const [myLimit, setMyLimit] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [s, n] = await Promise.all([
      sb.from("road_community").select("*").eq("road_id", roadId).maybeSingle(),
      sb.from("road_ratings")
        .select("fun, pavement, vehicle, note, updated_at, profiles(display_name)")
        .eq("road_id", roadId).not("note", "is", null).neq("note", "")
        .order("updated_at", { ascending: false }).limit(10),
    ]);
    if (s.error || n.error) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setSummary((s.data as RoadCommunity | null) ?? null);
    setNotes((n.data as unknown as Note[]) ?? []);
    if (user) {
      const [r, l] = await Promise.all([
        sb.from("road_ratings").select("*").eq("road_id", roadId).eq("user_id", user.id).maybeSingle(),
        sb.from("speed_reports").select("posted_limit").eq("road_id", roadId).eq("user_id", user.id).maybeSingle(),
      ]);
      setMine((r.data as RoadRating | null) ?? null);
      setMyLimit((l.data as { posted_limit: number } | null)?.posted_limit ?? null);
    } else {
      setMine(null);
      setMyLimit(null);
    }
    setLoaded(true);
  }, [roadId, user]);

  useEffect(() => {
    setEditing(false);
    setLoaded(false);
    if (ready) load();
  }, [ready, load]);

  if (!accountsEnabled) return null;
  if (failed) return null; // Database not set up yet, or offline: the rest of the page still works.

  const lines = summary ? summaryLines(summary) : [];
  return (
    <section className="community" aria-label="Member ratings">
      <h2>From members</h2>
      {!loaded ? (
        <p className="fine">Loading ratings...</p>
      ) : summary && summary.ratings > 0 ? (
        <div className="community-summary">
          {summary.fun_avg !== null && (
            <p className="fun-line">
              <Stars n={summary.fun_avg} /> <b>{summary.fun_avg.toFixed(1)}</b> fun from {summary.fun_count}{" "}
              {summary.fun_count === 1 ? "rating" : "ratings"}
            </p>
          )}
          {summary.pavement_loose_gravel > 0 && (
            <p className="chip warn">
              {summary.pavement_loose_gravel} {summary.pavement_loose_gravel === 1 ? "member reports" : "members report"} loose gravel on the surface
            </p>
          )}
          {lines.map((l) => <p key={l}>{l}</p>)}
        </div>
      ) : (
        <p className="fine">No ratings yet. Driven it? Be the first.</p>
      )}
      {summary?.reported_limit && (
        <p>Members report a posted limit of <b>{summary.reported_limit} {units}</b> ({summary.reported_limit_count} reports).</p>
      )}

      {!user ? (
        <p>
          <Link href="/signin" onClick={() => rememberReturn(window.location.pathname)}>Sign in</Link> to rate this road.
        </p>
      ) : !profile ? (
        <p><Link href="/me">Set up your profile</Link> to rate this road.</p>
      ) : editing ? (
        <RateForm
          roadId={roadId}
          units={units}
          mine={mine}
          myLimit={myLimit}
          onDone={async () => { setEditing(false); await load(); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button type="button" className="button" onClick={() => setEditing(true)}>
          {mine || myLimit ? "Edit your rating" : "Rate this road"}
        </button>
      )}

      {notes.length > 0 && (
        <ul className="notes">
          {notes.map((n, i) => (
            <li key={i}>
              <p>{n.note}</p>
              <p className="fine">
                {n.profiles?.display_name ?? "A member"}
                {n.vehicle ? `, ${n.vehicle === "car" ? "car" : "motorcycle"}` : ""}
                {n.fun ? `, ${n.fun} of 5 fun` : ""}
                {n.pavement ? `, ${PAVEMENT_LABEL[n.pavement].toLowerCase()}` : ""}
                {` · ${new Date(n.updated_at).toLocaleDateString()}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RateForm({ roadId, units, mine, myLimit, onDone, onCancel }: {
  roadId: string;
  units: string;
  mine: RoadRating | null;
  myLimit: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fun, setFun] = useState<number | null>(mine?.fun ?? null);
  const [pavement, setPavement] = useState<PavementCondition | null>(mine?.pavement ?? null);
  const [traffic, setTraffic] = useState<TrafficLevel | null>(mine?.traffic ?? null);
  const [vehicle, setVehicle] = useState<VehicleKind | null>(mine?.vehicle ?? null);
  const [drove, setDrove] = useState(mine?.drove_it ?? false);
  const [note, setNote] = useState(mine?.note ?? "");
  const [limit, setLimit] = useState<number | null>(myLimit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const says = fun !== null || pavement !== null || traffic !== null || drove || note.trim() !== "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const row = { fun, pavement, traffic, vehicle, drove_it: drove, note: note.trim() || null };
    let err = null;
    if (says) {
      const res = mine
        ? await sb.from("road_ratings").update(row).eq("road_id", roadId).eq("user_id", mine.user_id)
        : await sb.from("road_ratings").insert({ road_id: roadId, ...row });
      err = res.error;
    } else if (mine) {
      err = (await sb.from("road_ratings").delete().eq("road_id", roadId).eq("user_id", mine.user_id)).error;
    }
    if (!err) {
      const { data: auth } = await sb.auth.getUser();
      const uid = auth.user?.id;
      if (limit === null && myLimit !== null && uid) {
        err = (await sb.from("speed_reports").delete().eq("road_id", roadId).eq("user_id", uid)).error;
      } else if (limit !== null && myLimit !== null && uid) {
        err = (await sb.from("speed_reports").update({ posted_limit: limit, reported_at: new Date().toISOString() })
          .eq("road_id", roadId).eq("user_id", uid)).error;
      } else if (limit !== null) {
        err = (await sb.from("speed_reports").insert({ road_id: roadId, posted_limit: limit })).error;
      }
    }
    setBusy(false);
    if (err) setError("Couldn't save. Check your connection and try again.");
    else onDone();
  }

  return (
    <form onSubmit={save} className="form rate">
      <fieldset>
        <legend>Fun</legend>
        <div className="seg">
          {[1, 2, 3, 4, 5].map((v) => (
            <button key={v} type="button" aria-pressed={fun === v} aria-label={`${v} of 5`} onClick={() => setFun(fun === v ? null : v)}>
              {"★".repeat(v)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Pavement</legend>
        <div className="seg">
          {(Object.keys(PAVEMENT_LABEL) as PavementCondition[]).map((k) => (
            <button key={k} type="button" aria-pressed={pavement === k} onClick={() => setPavement(pavement === k ? null : k)}>
              {PAVEMENT_LABEL[k]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Traffic</legend>
        <div className="seg">
          {(Object.keys(TRAFFIC_LABEL) as TrafficLevel[]).map((k) => (
            <button key={k} type="button" aria-pressed={traffic === k} onClick={() => setTraffic(traffic === k ? null : k)}>
              {TRAFFIC_LABEL[k]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>You were in a</legend>
        <div className="seg">
          {(["car", "motorcycle"] as VehicleKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={vehicle === k} onClick={() => setVehicle(vehicle === k ? null : k)}>
              {k === "car" ? "Car" : "Motorcycle"}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={drove} onChange={(e) => setDrove(e.target.checked)} />
        <span>I&apos;ve driven it</span>
      </label>
      <label>
        <span>Posted speed limit you saw (optional)</span>
        <select value={limit ?? ""} onChange={(e) => setLimit(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Not sure</option>
          {LIMITS.map((v) => <option key={v} value={v}>{v} {units}</option>)}
        </select>
      </label>
      <label>
        <span>Note (optional): best direction, rough spots, where to stop</span>
        <textarea maxLength={500} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" className="button" disabled={busy}>{busy ? "Saving..." : says || limit !== null ? "Save" : "Remove my rating"}</button>
        <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="hint warn" role="alert">{error}</p>}
    </form>
  );
}

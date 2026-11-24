"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import {
  accountsEnabled, FLAG_LABEL, getSupabase, PAVEMENT_LABEL, rememberReturn, TRAFFIC_LABEL, WORTH_HINT, WORTH_LABEL,
  type PavementCondition, type RoadCommunity, type RoadFlag, type RoadRating, type TrafficLevel, type VehicleKind, type Worth,
} from "@/lib/supabase";

interface Note {
  user_id: string;
  worth: Worth | null;
  local_best: boolean;
  flags: RoadFlag[];
  pavement: PavementCondition | null;
  vehicle: VehicleKind | null;
  note: string;
  updated_at: string;
  profiles: { display_name: string; username: string } | null;
}

const LIMITS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];

const WORTHS: Worth[] = [2, 3, 4, 1];
const FLAGS = Object.keys(FLAG_LABEL) as RoadFlag[];

/** The most common answer to "how far would you drive for it", with how many gave it. */
function worthLine(c: RoadCommunity): string | null {
  if (!c.worth_count) return null;
  const counts: [Worth, number][] = [[1, c.worth_skip], [2, c.worth_nearby], [3, c.worth_detour], [4, c.worth_trip]];
  const top = counts.reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && b[0] > a[0]) ? b : a));
  return `${WORTH_LABEL[top[0]]}, say ${top[1]} of ${c.worth_count}`;
}

function flagLines(c: RoadCommunity): string[] {
  const n: [RoadFlag, number][] = [
    ["gravel", c.flag_gravel], ["private", c.flag_private], ["closed", c.flag_closed], ["police", c.flag_police], ["paved", c.flag_paved ?? 0],
  ];
  return n.filter(([, k]) => k > 0).map(([f, k]) =>
    f === "paved" ? `Paved: ${k} ${k === 1 ? "member checked" : "members checked"}` : `${FLAG_LABEL[f]}: ${k} ${k === 1 ? "member says" : "members say"} so`);
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

/** needsCheck: the road's surface needs a check (a bounty), so the form offers "Paved, I checked it" (11.78). */
export default function Community({ roadId, units, needsCheck = false }: { roadId: string; units: string; needsCheck?: boolean }) {
  const { ready, user, profile } = useAuth();
  const [summary, setSummary] = useState<RoadCommunity | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [mine, setMine] = useState<RoadRating | null>(null);
  const [myLimit, setMyLimit] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Reviewers whose checks have held up (11.78).
  const [trusted, setTrusted] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [s, n] = await Promise.all([
      sb.from("road_community").select("*").eq("road_id", roadId).maybeSingle(),
      sb.from("road_ratings")
        .select("user_id, worth, local_best, flags, pavement, vehicle, note, updated_at, profiles(display_name, username)")
        .eq("road_id", roadId).not("note", "is", null).neq("note", "")
        .order("updated_at", { ascending: false }).limit(10),
    ]);
    if (s.error || n.error) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setSummary((s.data as RoadCommunity | null) ?? null);
    const ns = (n.data as unknown as Note[]) ?? [];
    setNotes(ns);
    if (ns.length) {
      const { data: t } = await sb.rpc("trusted_checkers", { p_ids: [...new Set(ns.map((x) => x.user_id))] });
      setTrusted(new Set(((t as string[] | null) ?? [])));
    }
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
  const worth = summary ? worthLine(summary) : null;
  const flags = summary ? flagLines(summary) : [];
  return (
    <section className="community" aria-label="Member ratings">
      <h2>From members</h2>
      {!loaded ? (
        <p className="fine">Loading ratings...</p>
      ) : summary && summary.ratings > 0 ? (
        <div className="community-summary">
          {worth && <p className="fun-line"><b>{worth}</b></p>}
          {summary.local_best > 0 && (
            <p className="chip">
              One of the best around here, say {summary.local_best} {summary.local_best === 1 ? "member" : "members"}
            </p>
          )}
          {flags.map((f) => <p key={f} className="chip warn">{f}</p>)}
          {summary.pavement_loose_gravel > 0 && (
            <p className="chip warn">
              {summary.pavement_loose_gravel} {summary.pavement_loose_gravel === 1 ? "member reports" : "members report"} loose gravel on the surface
            </p>
          )}
          {lines.map((l) => <p key={l}>{l}</p>)}
        </div>
      ) : (
        <p className="fine">No reviews yet. Driven it? Be the first.</p>
      )}
      {summary?.reported_limit && (
        <p>Members report a posted limit of <b>{summary.reported_limit} {units}</b> ({summary.reported_limit_count} reports).</p>
      )}

      {!user ? (
        <p>
          <Link href="/signin" onClick={() => rememberReturn(window.location.pathname)}>Sign in</Link> to review this road.
        </p>
      ) : !profile ? (
        <p><Link href="/me">Set up your profile</Link> to review this road.</p>
      ) : editing ? (
        <RateForm
          roadId={roadId}
          units={units}
          mine={mine}
          myLimit={myLimit}
          needsCheck={needsCheck}
          onDone={async () => { setEditing(false); await load(); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <button type="button" className="button" onClick={() => setEditing(true)}>
          {mine || myLimit ? "Edit your review" : "Review this road"}
        </button>
      )}

      {notes.length > 0 && (
        <ul className="notes">
          {notes.map((n, i) => (
            <li key={i}>
              <p>{n.note}</p>
              <p className="fine">
                {n.profiles ? <Link href={`/u/${n.profiles.username}`}>{n.profiles.display_name}</Link> : "A member"}
                {trusted.has(n.user_id) && <span className="trusted-badge" title="Their road checks have held up">Trusted checker</span>}
                {n.vehicle ? `, ${n.vehicle === "car" ? "car" : "motorcycle"}` : ""}
                {n.worth ? `, ${WORTH_LABEL[n.worth].toLowerCase()}` : ""}
                {n.local_best ? ", one of the best around here" : ""}
                {n.flags?.length ? `, flagged: ${n.flags.map((f) => FLAG_LABEL[f].toLowerCase()).join(", ")}` : ""}
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

function RateForm({ roadId, units, mine, myLimit, needsCheck, onDone, onCancel }: {
  roadId: string;
  needsCheck: boolean;
  units: string;
  mine: RoadRating | null;
  myLimit: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [worth, setWorth] = useState<Worth | null>(mine?.worth ?? null);
  const [localBest, setLocalBest] = useState(mine?.local_best ?? false);
  const [flags, setFlags] = useState<RoadFlag[]>(mine?.flags ?? []);
  const [pavement, setPavement] = useState<PavementCondition | null>(mine?.pavement ?? null);
  const [traffic, setTraffic] = useState<TrafficLevel | null>(mine?.traffic ?? null);
  const [vehicle, setVehicle] = useState<VehicleKind | null>(mine?.vehicle ?? null);
  const [drove, setDrove] = useState(mine?.drove_it ?? false);
  const [note, setNote] = useState(mine?.note ?? "");
  const [limit, setLimit] = useState<number | null>(myLimit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const says = worth !== null || localBest || flags.length > 0 || pavement !== null || traffic !== null || drove || note.trim() !== "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const row = { worth, local_best: localBest, flags, pavement, traffic, vehicle, drove_it: drove, note: note.trim() || null };
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
      <p className="fine">Every part is optional. A review can be just a flag, or just a note.</p>
      <fieldset>
        <legend>How far would you drive for it?</legend>
        <div className="seg worth">
          {WORTHS.map((v) => (
            <button key={v} type="button" aria-pressed={worth === v} onClick={() => setWorth(worth === v ? null : v)}>
              {WORTH_LABEL[v]}
            </button>
          ))}
        </div>
        {worth && <span className="fine">{WORTH_HINT[worth]}.</span>}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={localBest} onChange={(e) => setLocalBest(e.target.checked)} />
        <span>One of the best roads around here</span>
      </label>
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
      <fieldset>
        <legend>Anything to flag?</legend>
        {FLAGS.filter((f) => f !== "paved" || needsCheck || flags.includes("paved")).map((f) => (
          <label key={f} className="check">
            <input type="checkbox" checked={flags.includes(f)}
              onChange={(e) => setFlags(e.target.checked ? [...flags, f] : flags.filter((x) => x !== f))} />
            <span>{FLAG_LABEL[f]}</span>
          </label>
        ))}
        <span className="fine">
          When three members flag the same thing (or say the pavement is poor), the road gets a check. If the site admin
          confirms it, the road moves lists and everyone who flagged it earns rep. Wrong flags cost rep, so only flag what
          you saw.
        </span>
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
        <button type="submit" className="button" disabled={busy}>{busy ? "Saving..." : says || limit !== null ? "Save" : "Remove my review"}</button>
        <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="hint warn" role="alert">{error}</p>}
    </form>
  );
}

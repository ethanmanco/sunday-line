"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { roadsById, type RoadOnMap } from "@/lib/roadData";
import { getSupabase } from "@/lib/supabase";
import { NO_COUNT_KEY } from "@/lib/viewCount";

interface Day {
  day: string;
  signups: number;
  active: number;
  reviews: number;
  heads_ups: number;
  spots: number;
  messages: number;
  views: number;
  visits: number;
}

interface Stats {
  days: number;
  since: string;
  today: string;
  people: Record<
    "accounts" | "profiles" | "private_profiles" | "new_7d" | "new_period" | "active_today" | "active_7d" | "active_period"
    | "follows" | "vehicles" | "photos" | "push_people" | "push_devices",
    number
  >;
  traffic: {
    views_today: number;
    views_7d: number;
    views_period: number;
    visits_today: number;
    visits_7d: number;
    member_visits_7d: number;
    counting_since: string | null;
    pages: { page: string; views: number }[];
  };
  roads: {
    reviews: number;
    reviews_7d: number;
    roads_reviewed: number;
    speed_reports: number;
    checks_waiting: number;
    checks_accepted: number;
    most_viewed: { road_id: string; views: number }[];
    most_reviewed: { road_id: string; reviews: number }[];
  };
  spots: Record<"spots" | "public" | "waiting" | "scored_roads" | "heads_ups" | "heads_ups_live" | "heads_ups_7d", number>;
  groups: Record<
    "groups" | "public_groups" | "memberships" | "events_upcoming" | "events" | "rsvps" | "messages_7d" | "messages_period" | "chats_active_7d",
    number
  >;
  notifications: { sent_7d: number; pushed_7d: number };
  series: Day[];
  contributors: { username: string; display_name: string; reviews: number; heads_ups: number; public_spots: number }[];
  makes: { make: string; count: number }[];
}

type Metric = Exclude<keyof Day, "day">;

const METRICS: { key: Metric; label: string }[] = [
  { key: "visits", label: "Visits" },
  { key: "views", label: "Page views" },
  { key: "active", label: "Active members" },
  { key: "signups", label: "New members" },
  { key: "reviews", label: "Road reviews" },
  { key: "heads_ups", label: "Heads-ups" },
  { key: "spots", label: "Spots saved" },
  { key: "messages", label: "Messages" },
];

const PAGE_LABEL: Record<string, string> = {
  map: "Map",
  road: "Road pages",
  group: "Group pages",
  groups: "Groups list",
  event: "Drives (events)",
  profile: "Profiles",
  people: "People",
  messages: "Messages",
  notifications: "Notifications",
  spots: "Your spots",
  about: "About",
  me: "Edit profile",
  join: "Invite links",
  signin: "Sign in",
  other: "Other",
};

const PERIODS = [7, 30, 90];
const num = new Intl.NumberFormat("en-US");
const fmt = (n: number | null | undefined) => num.format(n ?? 0);

function shortDay(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Site admin only (11.66): traffic and what people are doing, as counts. */
export default function SiteStats() {
  const { ready, user } = useAuth();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roads, setRoads] = useState<Record<string, RoadOnMap>>({});

  const load = useCallback(async (period: number) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data: ok } = await sb.rpc("am_site_admin");
    setAdmin(Boolean(ok));
    if (!ok) return;
    const { data, error: e } = await sb.rpc("admin_stats", { p_days: period });
    if (e) {
      setError("Couldn't load the stats. Try again in a moment.");
      return;
    }
    setError(null);
    const s = data as Stats;
    setStats(s);
    const ids = [...new Set([...s.roads.most_viewed, ...s.roads.most_reviewed].map((r) => r.road_id))];
    if (ids.length) setRoads(await roadsById(ids));
  }, []);

  useEffect(() => {
    if (ready && user) load(days);
    else if (ready) setAdmin(false);
  }, [ready, user, days, load]);

  if (admin === null) return <div className="page narrow"><p>Loading...</p></div>;
  if (!admin) return <div className="page narrow"><h1>Not found</h1><p><Link href="/">Back to the roads</Link></p></div>;

  const roadName = (id: string) => roads[id]?.name ?? "A road";
  const roadNear = (id: string) => {
    const r = roads[id];
    return r?.near ? `near ${r.near}${r.state ? `, ${r.state}` : ""}` : null;
  };

  return (
    <div className="page narrow stats">
      <h1>Site stats</h1>
      <p className="lead">Only you can see this page.</p>

      <div className="stats-periods" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p} type="button" className={`button small${p === days ? "" : " ghost"}`} aria-pressed={p === days}
            onClick={() => setDays(p)}>
            {p} days
          </button>
        ))}
      </div>

      {error && <p className="hint" role="alert">{error}</p>}
      {!stats ? (
        <p>Loading...</p>
      ) : (
        <>
          <ul className="stats-tiles" aria-label="Headlines">
            <Tile label="Visits today" value={stats.traffic.visits_today} />
            <Tile label="Visits, last 7 days" value={stats.traffic.visits_7d} />
            <Tile label="Active members, last 7 days" value={stats.people.active_7d} />
            <Tile label={`New members, last ${stats.days} days`} value={stats.people.new_period} />
          </ul>

          <DailyChart series={stats.series} />

          <section aria-labelledby="st-people">
            <h2 id="st-people">People</h2>
            <dl className="stats-list">
              <Row label="Accounts" value={stats.people.accounts} note={`${fmt(stats.people.profiles)} with a profile`} />
              <Row label="Private profiles" value={stats.people.private_profiles} />
              <Row label="New this week" value={stats.people.new_7d} />
              <Row label="Active today" value={stats.people.active_today} />
              <Row label={`Active in ${stats.days} days`} value={stats.people.active_period} />
              <Row label="Follows" value={stats.people.follows} />
              <Row label="Cars and bikes in garages" value={stats.people.vehicles} />
              <Row label="Photos" value={stats.people.photos} />
              <Row label="Push notifications on" value={stats.people.push_people}
                note={`${fmt(stats.people.push_devices)} ${stats.people.push_devices === 1 ? "device" : "devices"}`} />
            </dl>
            <p className="fine">Active means signed in, rated, posted, voted, saved, followed, joined, or read a chat that day.</p>
          </section>

          <section aria-labelledby="st-traffic">
            <h2 id="st-traffic">Traffic</h2>
            <dl className="stats-list">
              <Row label="Page views today" value={stats.traffic.views_today} />
              <Row label="Page views, last 7 days" value={stats.traffic.views_7d} />
              <Row label={`Page views, last ${stats.days} days`} value={stats.traffic.views_period} />
              <Row label="Visits by members, last 7 days" value={stats.traffic.member_visits_7d}
                note={`of ${fmt(stats.traffic.visits_7d)}`} />
            </dl>
            {stats.traffic.pages.length > 0 && (
              <>
                <h3>Most viewed pages, last {stats.days} days</h3>
                <Bars items={stats.traffic.pages.map((p) => ({ key: p.page, label: PAGE_LABEL[p.page] ?? p.page, value: p.views }))} />
              </>
            )}
            <p className="fine">
              {stats.traffic.counting_since
                ? `Counting since ${shortDay(stats.traffic.counting_since)}. `
                : "Nothing counted yet. "}
              Counts are anonymous: only the kind of page and the day are kept, never who, where, or what device. A visit is
              one browser session. Browsers with Do Not Track or Global Privacy Control aren&apos;t counted.
            </p>
          </section>

          <section aria-labelledby="st-roads">
            <h2 id="st-roads">Roads</h2>
            <dl className="stats-list">
              <Row label="Reviews" value={stats.roads.reviews} note={`${fmt(stats.roads.reviews_7d)} this week`} />
              <Row label="Roads reviewed" value={stats.roads.roads_reviewed} />
              <Row label="Speed limit reports" value={stats.roads.speed_reports} />
              <Row label="Road checks waiting" value={stats.roads.checks_waiting} />
              <Row label="Road checks accepted" value={stats.roads.checks_accepted} />
            </dl>
            <h3>Most viewed roads, last {stats.days} days</h3>
            {stats.roads.most_viewed.length === 0 ? (
              <p className="fine">None yet.</p>
            ) : (
              <ol className="stats-rank">
                {stats.roads.most_viewed.map((r) => (
                  <li key={r.road_id}>
                    <span><Link href={`/road/${r.road_id}`}>{roadName(r.road_id)}</Link>
                      {roadNear(r.road_id) && <span className="fine"> {roadNear(r.road_id)}</span>}</span>
                    <b>{fmt(r.views)}</b>
                  </li>
                ))}
              </ol>
            )}
            <h3>Most reviewed roads</h3>
            {stats.roads.most_reviewed.length === 0 ? (
              <p className="fine">None yet.</p>
            ) : (
              <ol className="stats-rank">
                {stats.roads.most_reviewed.map((r) => (
                  <li key={r.road_id}>
                    <span><Link href={`/road/${r.road_id}`}>{roadName(r.road_id)}</Link>
                      {roadNear(r.road_id) && <span className="fine"> {roadNear(r.road_id)}</span>}</span>
                    <b>{fmt(r.reviews)}</b>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="st-spots">
            <h2 id="st-spots">Spots and heads-ups</h2>
            <dl className="stats-list">
              <Row label="Spots saved" value={stats.spots.spots} />
              <Row label="On the public map" value={stats.spots.public} />
              <Row label="Waiting for you" value={stats.spots.waiting} />
              <Row label="Roads scored for members" value={stats.spots.scored_roads} />
              <Row label="Heads-ups up now" value={stats.spots.heads_ups_live} note={`${fmt(stats.spots.heads_ups)} ever`} />
              <Row label="Heads-ups this week" value={stats.spots.heads_ups_7d} />
            </dl>
            <p className="row">
              <Link href="/admin/spots" className="button ghost small">Review spots</Link>
              <Link href="/admin/roads" className="button ghost small">Review road checks</Link>
            </p>
          </section>

          <section aria-labelledby="st-groups">
            <h2 id="st-groups">Groups and chats</h2>
            <dl className="stats-list">
              <Row label="Groups" value={stats.groups.groups} note={`${fmt(stats.groups.public_groups)} public`} />
              <Row label="Group memberships" value={stats.groups.memberships} />
              <Row label="Drives coming up" value={stats.groups.events_upcoming} note={`${fmt(stats.groups.events)} ever`} />
              <Row label="RSVPs" value={stats.groups.rsvps} />
              <Row label="Messages this week" value={stats.groups.messages_7d} />
              <Row label={`Messages in ${stats.days} days`} value={stats.groups.messages_period} />
              <Row label="Chats with messages this week" value={stats.groups.chats_active_7d} />
              <Row label="Notifications this week" value={stats.notifications.sent_7d}
                note={`${fmt(stats.notifications.pushed_7d)} pushed`} />
            </dl>
          </section>

          <section aria-labelledby="st-top">
            <h2 id="st-top">Top contributors</h2>
            {stats.contributors.length === 0 ? (
              <p className="fine">None yet.</p>
            ) : (
              <ol className="stats-rank">
                {stats.contributors.map((c) => (
                  <li key={c.username}>
                    <span>
                      <Link href={`/u/${c.username}`}>{c.display_name}</Link>
                      <span className="fine">
                        {" "}{[
                          c.reviews ? `${fmt(c.reviews)} ${c.reviews === 1 ? "review" : "reviews"}` : null,
                          c.heads_ups ? `${fmt(c.heads_ups)} ${c.heads_ups === 1 ? "heads-up" : "heads-ups"}` : null,
                          c.public_spots ? `${fmt(c.public_spots)} public ${c.public_spots === 1 ? "spot" : "spots"}` : null,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <b>{fmt(c.reviews + c.heads_ups + c.public_spots)}</b>
                  </li>
                ))}
              </ol>
            )}
            <p className="fine">Counts public things only: reviews, heads-ups, and spots on the public map.</p>
          </section>

          {stats.makes.length > 0 && (
            <section aria-labelledby="st-garage">
              <h2 id="st-garage">In the garages</h2>
              <Bars items={stats.makes.map((m) => ({ key: m.make, label: m.make, value: m.count }))} />
            </section>
          )}

          <CountMe />
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <li className="stats-tile">
      <span className="stats-tile-value">{fmt(value)}</span>
      <span className="stats-tile-label">{label}</span>
    </li>
  );
}

function Row({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <b>{fmt(value)}</b>
        {note && <span className="fine"> {note}</span>}
      </dd>
    </div>
  );
}

/** Horizontal bars with the number beside each; the list itself is the table view. */
function Bars({ items }: { items: { key: string; label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="stats-bars">
      {items.map((i) => (
        <li key={i.key}>
          <span className="stats-bars-label">{i.label}</span>
          <span className="stats-bars-track" aria-hidden="true">
            <span className="stats-bars-fill" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </span>
          <b>{fmt(i.value)}</b>
        </li>
      ))}
    </ul>
  );
}

function DailyChart({ series }: { series: Day[] }) {
  const [metric, setMetric] = useState<Metric>("visits");
  const [picked, setPicked] = useState<number | null>(null);
  const label = METRICS.find((m) => m.key === metric)?.label ?? "";
  const values = series.map((d) => d[metric] ?? 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const shown = picked !== null && series[picked] ? picked : null;

  // Geometry: one slot per day, a 2px gap between bars, rounded tops.
  const W = 320;
  const H = 120;
  const slot = W / Math.max(1, series.length);
  const gap = Math.min(2, slot * 0.25);

  return (
    <section className="stats-chart" aria-labelledby="st-daily">
      <div className="stats-chart-head">
        <h2 id="st-daily">Day by day</h2>
        <label>
          <span className="visually-hidden">Show</span>
          <select value={metric} onChange={(e) => { setMetric(e.target.value as Metric); setPicked(null); }}>
            {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
      </div>
      <p className="stats-readout" aria-live="polite">
        {shown !== null ? (
          <><b>{fmt(values[shown])}</b> {label.toLowerCase()} on {shortDay(series[shown].day)}</>
        ) : (
          <><b>{fmt(total)}</b> {label.toLowerCase()} in {series.length} days</>
        )}
      </p>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="stats-svg" role="img"
        aria-label={`${label} per day, ${series.length} days, highest ${fmt(max)}`}
        onMouseLeave={() => setPicked(null)}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} className="stats-axis" />
        {series.map((d, i) => {
          const h = values[i] > 0 ? Math.max(2, (values[i] / max) * (H - 4)) : 0;
          const x = i * slot + gap / 2;
          const w = Math.max(1, slot - gap);
          const r = Math.min(4, w / 2, h);
          return (
            <g key={d.day}>
              {h > 0 && (
                <path className={`stats-bar${shown === i ? " on" : ""}`}
                  d={`M${x},${H} V${H - h + r} Q${x},${H - h} ${x + r},${H - h} H${x + w - r} Q${x + w},${H - h} ${x + w},${H - h + r} V${H} Z`} />
              )}
              {/* Hit area: the whole day's column, taller than the bar. */}
              <rect x={i * slot} y="0" width={slot} height={H} fill="transparent"
                onMouseEnter={() => setPicked(i)} onClick={() => setPicked(i)} />
            </g>
          );
        })}
        <text x="0" y={H + 14} className="stats-tick">{series[0] ? shortDay(series[0].day) : ""}</text>
        <text x={W} y={H + 14} className="stats-tick" textAnchor="end">
          {series.length ? shortDay(series[series.length - 1].day) : ""}
        </text>
      </svg>
      <details className="stats-table">
        <summary>Show as a table</summary>
        <table>
          <thead><tr><th scope="col">Day</th><th scope="col">{label}</th></tr></thead>
          <tbody>
            {[...series].reverse().map((d) => (
              <tr key={d.day}><th scope="row">{shortDay(d.day)}</th><td>{fmt(d[metric])}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="fine">Days run on UTC time.</p>
    </section>
  );
}

/** Keeps the admin's own browsing out of the traffic counts, on this device. */
function CountMe() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    try {
      setOff(localStorage.getItem(NO_COUNT_KEY) === "1");
    } catch {
      // No storage: nothing to change.
    }
  }, []);
  function toggle(next: boolean) {
    setOff(next);
    try {
      if (next) localStorage.setItem(NO_COUNT_KEY, "1");
      else localStorage.removeItem(NO_COUNT_KEY);
    } catch {
      // No storage: nothing to keep.
    }
  }
  return (
    <section aria-labelledby="st-me">
      <h2 id="st-me">Your own visits</h2>
      <label className="check">
        <input type="checkbox" checked={off} onChange={(e) => toggle(e.target.checked)} />
        <span>Don&apos;t count my visits on this device</span>
      </label>
    </section>
  );
}

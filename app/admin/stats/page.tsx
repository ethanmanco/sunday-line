"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { roadsById, type RoadOnMap } from "@/lib/roadData";
import { getSupabase } from "@/lib/supabase";
import { NO_COUNT_KEY } from "@/lib/viewCount";

interface Bucket {
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

type Group = "day" | "week" | "month";

interface Stats {
  days: number;
  since: string;
  until: string;
  today: string;
  first_day: string;
  group: Group;
  previous_since: string;
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
    visits_period: number;
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
  series: Bucket[];
  previous: Bucket[];
  contributors: { username: string; display_name: string; reviews: number; heads_ups: number; public_spots: number }[];
  makes: { make: string; count: number }[];
}

/** Unique visitors from Vercel Web Analytics (11.68), through our admin-only route. */
interface Visitors {
  configured: boolean;
  error?: string;
  keepDays?: number;
  since?: string;
  until?: string;
  visitors?: number;
  pageviews?: number;
  series?: { day: string; visitors: number; pageviews: number }[];
  referrers?: { name: string; visitors: number }[];
  devices?: { name: string; visitors: number }[];
}

type Metric = Exclude<keyof Bucket, "day"> | "uniques";

/** "Distinct" metrics count people, so they can't be added up across days. */
const METRICS: { key: Metric; label: string; distinct?: boolean }[] = [
  { key: "uniques", label: "Unique visitors", distinct: true },
  { key: "visits", label: "Visits" },
  { key: "views", label: "Page views" },
  { key: "active", label: "Active members", distinct: true },
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

const DEVICE_LABEL: Record<string, string> = { mobile: "Phones", desktop: "Computers", tablet: "Tablets" };

/** Time windows: days back from today (0 = all time), or a custom range. */
const PERIODS: { key: string; label: string; days?: number }[] = [
  { key: "1", label: "Today", days: 1 },
  { key: "7", label: "7 days", days: 7 },
  { key: "14", label: "14 days", days: 14 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "182", label: "6 months", days: 182 },
  { key: "365", label: "1 year", days: 365 },
  { key: "all", label: "All time", days: 0 },
  { key: "custom", label: "Pick dates" },
];

interface Request {
  period: string;
  from: string;
  to: string;
  group: Group;
}

const num = new Intl.NumberFormat("en-US");
const fmt = (n: number | null | undefined) => num.format(n ?? 0);
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function shortDay(iso: string, withYear = false) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  });
}

function bucketLabel(iso: string, group: Group) {
  if (group === "month") {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  return group === "week" ? `the week of ${shortDay(iso)}` : shortDay(iso);
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date in Central time, the stats' day (11.72). */
function centralToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

/** Site admin only (11.66, 11.68): traffic and what people are doing, as counts. */
export default function SiteStats() {
  const { ready, user } = useAuth();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [req, setReq] = useState<Request>(() => ({ period: "30", from: addDays(centralToday(), -29), to: centralToday(), group: "day" }));
  const [stats, setStats] = useState<Stats | null>(null);
  const [visitors, setVisitors] = useState<Visitors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roads, setRoads] = useState<Record<string, RoadOnMap>>({});

  const load = useCallback(async (r: Request) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data: ok } = await sb.rpc("am_site_admin");
    setAdmin(Boolean(ok));
    if (!ok) return;
    setBusy(true);
    const preset = PERIODS.find((p) => p.key === r.period);
    const args = r.period === "custom"
      ? { p_from: r.from, p_to: r.to, p_group: r.group }
      : { p_days: preset?.days ?? 30, p_group: r.group };
    const { data, error: e } = await sb.rpc("admin_stats", args);
    setBusy(false);
    if (e) {
      setError("Couldn't load the stats. Try again in a moment.");
      return;
    }
    setError(null);
    const s = data as Stats;
    setStats(s);

    // Unique visitors come from Vercel through our own admin-only route.
    const { data: session } = await sb.auth.getSession();
    const token = session.session?.access_token;
    if (token) {
      const q = new URLSearchParams({ since: s.since, until: s.until, group: s.group });
      fetch(`/api/admin/visitors?${q}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok || res.status === 502 ? (res.json() as Promise<Visitors>) : null))
        .then((v) => setVisitors(v ?? { configured: false }))
        .catch(() => setVisitors({ configured: true, error: "Vercel did not answer" }));
    }

    const ids = [...new Set([...s.roads.most_viewed, ...s.roads.most_reviewed].map((x) => x.road_id))];
    if (ids.length) setRoads(await roadsById(ids));
  }, []);

  useEffect(() => {
    if (ready && user) load(req);
    else if (ready) setAdmin(false);
  }, [ready, user, req, load]);

  if (admin === null) return <div className="page narrow"><p>Loading...</p></div>;
  if (!admin) return <div className="page narrow"><h1>Not found</h1><p><Link href="/">Back to the roads</Link></p></div>;

  const roadName = (id: string) => roads[id]?.name ?? "A road";
  const roadNear = (id: string) => {
    const r = roads[id];
    return r?.near ? `near ${r.near}${r.state ? `, ${r.state}` : ""}` : null;
  };
  const uniquesOn = Boolean(visitors?.configured && !visitors.error);
  const periodWords = stats
    ? stats.days === 1 ? (stats.since === stats.today ? "today" : `on ${shortDay(stats.since)}`) : `in ${fmt(stats.days)} days`
    : "";

  return (
    <div className="page narrow stats">
      <h1>Site stats</h1>
      <p className="lead">Only you can see this page.</p>

      <PeriodPicker req={req} onChange={setReq} firstDay={stats?.first_day} />
      {stats && (
        <p className="fine stats-range" aria-live="polite">
          {busy ? "Loading..." : stats.since === stats.until
            ? shortDay(stats.since, true)
            : `${shortDay(stats.since, stats.since.slice(0, 4) !== stats.until.slice(0, 4))} to ${shortDay(stats.until, true)}`}
        </p>
      )}

      {error && <p className="hint" role="alert">{error}</p>}
      {!stats ? (
        <p>Loading...</p>
      ) : (
        <>
          <ul className="stats-tiles" aria-label="Headlines">
            {uniquesOn && <Tile label={`Unique visitors ${periodWords}`} value={visitors?.visitors ?? 0} />}
            <Tile label={`Visits ${periodWords}`} value={stats.traffic.visits_period} />
            <Tile label={`Page views ${periodWords}`} value={stats.traffic.views_period} />
            <Tile label={`Active members ${periodWords}`} value={stats.people.active_period} />
            <Tile label={`New members ${periodWords}`} value={stats.people.new_period} />
          </ul>

          <ChartCard stats={stats} visitors={uniquesOn ? visitors : null}
            group={req.group} onGroup={(g) => setReq({ ...req, group: g })} />

          <section aria-labelledby="st-traffic">
            <h2 id="st-traffic">Traffic</h2>
            <dl className="stats-list">
              {uniquesOn && (
                <Row label={`Unique visitors ${periodWords}`} value={visitors?.visitors ?? 0}
                  note={`${fmt(visitors?.pageviews)} page views on Vercel`} />
              )}
              <Row label="Visits today" value={stats.traffic.visits_today} />
              <Row label="Visits, last 7 days" value={stats.traffic.visits_7d} note={`${fmt(stats.traffic.member_visits_7d)} by members`} />
              <Row label="Page views today" value={stats.traffic.views_today} />
              <Row label="Page views, last 7 days" value={stats.traffic.views_7d} />
            </dl>
            {stats.traffic.pages.length > 0 && (
              <>
                <h3>Most viewed pages {periodWords}</h3>
                <Bars items={stats.traffic.pages.map((p) => ({ key: p.page, label: PAGE_LABEL[p.page] ?? p.page, value: p.views }))} />
              </>
            )}
            {uniquesOn && (visitors?.referrers?.length ?? 0) > 0 && (
              <>
                <h3>Where visitors came from</h3>
                <Bars items={visitors!.referrers!.map((r) => ({ key: r.name, label: r.name, value: r.visitors }))} />
              </>
            )}
            {uniquesOn && (visitors?.devices?.length ?? 0) > 0 && (
              <>
                <h3>Phones and computers</h3>
                <Bars items={visitors!.devices!.map((d) => ({ key: d.name, label: DEVICE_LABEL[d.name] ?? d.name, value: d.visitors }))} />
              </>
            )}
            <VisitorsNote visitors={visitors} stats={stats} />
            <p className="fine">
              {stats.traffic.counting_since
                ? `Our own count started ${shortDay(stats.traffic.counting_since, true)}. `
                : "Nothing counted yet. "}
              Counts are anonymous: only the kind of page and the day are kept, never who, where, or what device. A visit is
              one browser session. Browsers with Do Not Track or Global Privacy Control aren&apos;t counted.
            </p>
          </section>

          <section aria-labelledby="st-people">
            <h2 id="st-people">People</h2>
            <dl className="stats-list">
              <Row label="Accounts" value={stats.people.accounts} note={`${fmt(stats.people.profiles)} with a profile`} />
              <Row label="Private profiles" value={stats.people.private_profiles} />
              <Row label="New this week" value={stats.people.new_7d} />
              <Row label="Active today" value={stats.people.active_today} />
              <Row label="Active this week" value={stats.people.active_7d} />
              <Row label="Follows" value={stats.people.follows} />
              <Row label="Cars and bikes in garages" value={stats.people.vehicles} />
              <Row label="Photos" value={stats.people.photos} />
              <Row label="Push notifications on" value={stats.people.push_people}
                note={`${fmt(stats.people.push_devices)} ${stats.people.push_devices === 1 ? "device" : "devices"}`} />
            </dl>
            <p className="fine">Active means signed in, rated, posted, voted, saved, followed, joined, or read a chat that day.</p>
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
            <h3>Most viewed roads {periodWords}</h3>
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
              <Row label={`Messages ${periodWords}`} value={stats.groups.messages_period} />
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

function PeriodPicker({ req, onChange, firstDay }: { req: Request; onChange: (r: Request) => void; firstDay?: string }) {
  const [from, setFrom] = useState(req.from);
  const [to, setTo] = useState(req.to);
  const today = centralToday();
  return (
    <div className="stats-period">
      <div className="stats-chips" role="group" aria-label="Time window">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" className={`button small${p.key === req.period ? "" : " ghost"}`}
            aria-pressed={p.key === req.period}
            onClick={() => {
              // Long windows read better by month, short ones by day.
              const days = p.days ?? 0;
              const group: Group = p.key === "custom" ? req.group
                : days === 0 || days > 200 ? (req.group === "day" ? "month" : req.group)
                : days <= 14 ? "day" : req.group;
              onChange({ ...req, period: p.key, group });
            }}>
            {p.label}
          </button>
        ))}
      </div>
      {req.period === "custom" && (
        <form className="stats-dates" onSubmit={(e) => { e.preventDefault(); onChange({ ...req, from, to }); }}>
          <label>
            <span>From</span>
            <input type="date" value={from} min={firstDay} max={to || today} required onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={to} min={from} max={today} required onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="submit" className="button small">Show</button>
        </form>
      )}
    </div>
  );
}

function VisitorsNote({ visitors, stats }: { visitors: Visitors | null; stats: Stats }) {
  if (!visitors) return null;
  if (!visitors.configured) {
    return (
      <div className="stats-setup">
        <p><b>Unique visitors</b> come from Vercel Web Analytics, which isn&apos;t connected yet.</p>
        <ol>
          <li>In Vercel, open the sunday-line project, then Analytics, and turn on Web Analytics.</li>
          <li>Make an access token (Account settings, Tokens).</li>
          <li>Add it to the project&apos;s environment variables as <code>VERCEL_ANALYTICS_TOKEN</code> (and <code>VERCEL_ANALYTICS_TEAM</code> if the project is under a team), then redeploy.</li>
        </ol>
      </div>
    );
  }
  if (visitors.error) return <p className="fine warn">Unique visitors: Vercel didn&apos;t answer ({visitors.error}).</p>;
  const clipped = visitors.since && visitors.since > stats.since;
  return (
    <p className="fine">
      Unique visitors come from Vercel Web Analytics (no cookies; the same cleaned-up addresses).
      {clipped && ` Vercel keeps ${visitors.keepDays} days on this plan, so they start ${shortDay(visitors.since!)}.`}
    </p>
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

type Style = "bars" | "line";
type Show = "each" | "total";

/** One value per bucket; unique visitors are matched to our buckets by date (null before Vercel's data starts). */
function valuesFor(metric: Metric, buckets: Bucket[], visitors: Visitors | null): (number | null)[] {
  if (metric !== "uniques") return buckets.map((b) => b[metric] ?? 0);
  const since = visitors?.since ?? "";
  const out: (number | null)[] = buckets.map((_, k) => {
    const next = buckets[k + 1]?.day;
    return next !== undefined && next <= since ? null : 0;
  });
  for (const r of visitors?.series ?? []) {
    let i = -1;
    for (let k = 0; k < buckets.length; k++) if (buckets[k].day <= r.day) i = k;
    if (i >= 0) out[i] = Math.max(out[i] ?? 0, r.visitors);
  }
  return out;
}

function ChartCard({ stats, visitors, group, onGroup }: {
  stats: Stats;
  visitors: Visitors | null;
  group: Group;
  onGroup: (g: Group) => void;
}) {
  const [metric, setMetric] = useState<Metric>("visits");
  const [style, setStyle] = useState<Style>("bars");
  const [show, setShow] = useState<Show>("each");
  const [compare, setCompare] = useState(false);
  const [average, setAverage] = useState(false);
  const [all, setAll] = useState(false);

  const metrics = METRICS.filter((m) => m.key !== "uniques" || visitors);
  const m = metrics.find((x) => x.key === metric) ?? metrics.find((x) => x.key === "visits")!;
  const canTotal = !m.distinct;
  const canCompare = m.key !== "uniques";
  const groupWord = stats.group;

  return (
    <section className="stats-chart" aria-labelledby="st-chart">
      <div className="stats-chart-head">
        <h2 id="st-chart">Over time</h2>
        {!all && (
          <label>
            <span className="visually-hidden">Show</span>
            <select value={m.key} onChange={(e) => setMetric(e.target.value as Metric)}>
              {metrics.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
        )}
      </div>

      {all ? (
        <div className="stats-multiples">
          {metrics.map((x) => (
            <button key={x.key} type="button" className="stats-multiple" onClick={() => { setMetric(x.key); setAll(false); }}>
              <span className="stats-multiple-label">{x.label}</span>
              <span className="stats-multiple-value">
                {x.distinct
                  ? `up to ${fmt(Math.max(0, ...valuesFor(x.key, stats.series, visitors).filter((v): v is number => v !== null)))}`
                  : fmt(valuesFor(x.key, stats.series, visitors).reduce<number>((a, b) => a + (b ?? 0), 0))}
              </span>
              <Plot values={valuesFor(x.key, stats.series, visitors)} buckets={stats.series} group={stats.group}
                style={style} small />
              <span className="visually-hidden">Show this chart on its own</span>
            </button>
          ))}
        </div>
      ) : (
        <Single key={`${m.key}:${stats.since}:${stats.group}`} label={m.label} distinct={Boolean(m.distinct)} stats={stats}
          values={valuesFor(m.key, stats.series, visitors)}
          previous={compare && canCompare ? valuesFor(m.key, stats.previous, null) : null}
          style={style} total={show === "total" && canTotal} average={average} />
      )}

      <div className="stats-options">
        <Segmented label="Group by" value={group} onChange={(v) => onGroup(v as Group)}
          options={[["day", "Day"], ["week", "Week"], ["month", "Month"]]} />
        <Segmented label="Style" value={style} onChange={(v) => setStyle(v as Style)}
          options={[["bars", "Bars"], ["line", "Line"]]} />
        {!all && (
          <Segmented label="Show" value={canTotal ? show : "each"} onChange={(v) => setShow(v as Show)}
            options={[["each", `Each ${groupWord}`], ["total", "Running total"]]} disabled={!canTotal} />
        )}
        {!all && (
          <>
            <label className="check">
              <input type="checkbox" checked={compare && canCompare} disabled={!canCompare} onChange={(e) => setCompare(e.target.checked)} />
              <span>Compare with the {fmt(stats.days)} {stats.days === 1 ? "day" : "days"} before</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={average} onChange={(e) => setAverage(e.target.checked)} />
              <span>Average line</span>
            </label>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>Show every chart at once</span>
        </label>
        {!all && m.distinct && (
          <p className="fine">
            {m.label} counts each person once per {groupWord}, so it can&apos;t be added into a running total.
            {m.key === "uniques" && " Vercel doesn't share the period before, so it can't be compared."}
          </p>
        )}
      </div>
      <p className="fine">Days run on Central time.</p>
    </section>
  );
}

function Segmented({ label, value, options, onChange, disabled }: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stats-seg" role="group" aria-label={label}>
      <span className="stats-seg-label" aria-hidden="true">{label}</span>
      <div>
        {options.map(([v, text]) => (
          <button key={v} type="button" disabled={disabled} aria-pressed={v === value}
            className={v === value ? "on" : ""} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Single({ label, distinct, stats, values, previous, style, total, average }: {
  label: string;
  distinct: boolean;
  stats: Stats;
  values: (number | null)[];
  previous: (number | null)[] | null;
  style: Style;
  total: boolean;
  average: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const running = (v: (number | null)[]) => {
    let t = 0;
    return v.map((x) => (x === null ? null : (t += x)));
  };
  const shown = total ? running(values) : values;
  const prevShown = previous ? (total ? running(previous) : previous) : null;
  const known = values.filter((v): v is number => v !== null);
  const sum = known.reduce((a, b) => a + b, 0);
  const prevSum = previous ? previous.filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) : null;
  const avg = known.length ? sum / known.length : 0;
  const lower = label.toLowerCase();
  const i = picked !== null && picked < shown.length ? picked : null;
  const change = prevSum !== null && prevSum > 0 ? Math.round(((sum - prevSum) / prevSum) * 100) : null;

  return (
    <>
      <p className="stats-readout" aria-live="polite">
        {i !== null ? (
          <>
            <b>{shown[i] === null ? "No data" : fmt(shown[i])}</b> {total ? `${lower} by` : `${lower} on`} {bucketLabel(stats.series[i].day, stats.group)}
            {prevShown && prevShown[i] !== null && prevShown[i] !== undefined && <span className="fine"> (before: {fmt(prevShown[i])})</span>}
          </>
        ) : distinct ? (
          <><b>{fmt(Math.max(0, ...known))}</b> {lower} on the busiest {stats.group}</>
        ) : (
          <>
            <b>{fmt(sum)}</b> {lower}
            {prevSum !== null && (
              <span className="fine"> vs {fmt(prevSum)} before{change !== null ? ` (${change > 0 ? "up" : change < 0 ? "down" : "even"}${change ? ` ${Math.abs(change)}%` : ""})` : ""}</span>
            )}
          </>
        )}
      </p>
      <Plot values={shown} previous={prevShown} buckets={stats.series} group={stats.group} style={style}
        average={average && !total ? avg : null} picked={i} onPick={setPicked} label={label} />
      {(previous || (average && !total)) && (
        <ul className="stats-legend" aria-label="Key">
          <li><span className="key now" aria-hidden="true" />This period</li>
          {previous && <li><span className="key before" aria-hidden="true" />The {fmt(stats.days)} {stats.days === 1 ? "day" : "days"} before</li>}
          {average && !total && <li><span className="key avg" aria-hidden="true" />Average, {fmt(Math.round(avg * 10) / 10)}</li>}
        </ul>
      )}
      <details className="stats-table">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{stats.group === "day" ? "Day" : stats.group === "week" ? "Week of" : "Month"}</th>
              <th scope="col">{total ? `${label}, running total` : label}</th>
              {prevShown && <th scope="col">Before</th>}
            </tr>
          </thead>
          <tbody>
            {stats.series.map((b, k) => ({ b, k })).reverse().map(({ b, k }) => (
              <tr key={b.day}>
                <th scope="row">{stats.group === "month" ? bucketLabel(b.day, "month") : shortDay(b.day)}</th>
                <td>{shown[k] === null ? "No data" : fmt(shown[k])}</td>
                {prevShown && <td>{prevShown[k] === null || prevShown[k] === undefined ? "" : fmt(prevShown[k])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

/** One axis, thin marks, rounded bar tops, 2px gaps; a muted dashed line for the period before. */
function Plot({ values, previous, buckets, group, style, average, picked, onPick, label, small }: {
  values: (number | null)[];
  previous?: (number | null)[] | null;
  buckets: Bucket[];
  group: Group;
  style: Style;
  average?: number | null;
  picked?: number | null;
  onPick?: (i: number | null) => void;
  label?: string;
  small?: boolean;
}) {
  const top = useMemo(() => {
    const all = [...values, ...(previous ?? [])].filter((v): v is number => v !== null);
    const rawMax = Math.max(1, ...all);
    // A round top for the axis: 1, 2 or 5 times a power of ten.
    const p = 10 ** Math.floor(Math.log10(rawMax));
    return [1, 2, 5, 10].map((k) => k * p).find((t) => t >= rawMax) ?? rawMax;
  }, [values, previous]);

  const W = 320;
  const H = small ? 48 : 130;
  const left = small ? 0 : 30;
  const n = Math.max(1, values.length);
  const slot = (W - left) / n;
  const gap = Math.min(2, slot * 0.25);
  const y = (v: number) => H - (v / top) * (H - 4);
  const cx = (i: number) => left + i * slot + slot / 2;

  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${cx(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };

  const ticks = small ? [] : [0, top / 2, top];
  const first = buckets[0]?.day;
  const last = buckets[buckets.length - 1]?.day;
  const tickLabel = (iso: string) => (group === "month" ? bucketLabel(iso, "month") : shortDay(iso));
  const highest = Math.max(0, ...values.filter((v): v is number => v !== null));

  return (
    <svg viewBox={`0 0 ${W} ${H + (small ? 2 : 18)}`} className={`stats-svg${small ? " small" : ""}`}
      role={small ? undefined : "img"} aria-hidden={small ? true : undefined}
      aria-label={small ? undefined : `${label} per ${group}, ${values.length} in all, highest ${fmt(highest)}`}
      onMouseLeave={onPick ? () => onPick(null) : undefined}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W} y1={y(t) + 0.5} y2={y(t) + 0.5} className={t === 0 ? "stats-axis" : "stats-grid"} />
          <text x={left - 5} y={y(t) + 3} className="stats-tick" textAnchor="end">{compact.format(t)}</text>
        </g>
      ))}
      {small && <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} className="stats-axis" />}

      {style === "bars" && values.map((v, i) => {
        if (v === null || v <= 0) return null;
        const h = Math.max(2, H - y(v));
        const x = left + i * slot + gap / 2;
        const w = Math.max(1, slot - gap);
        const r = Math.min(4, w / 2, h);
        return (
          <path key={i} className={`stats-bar${picked === i ? " on" : ""}`}
            d={`M${x},${H} V${H - h + r} Q${x},${H - h} ${x + r},${H - h} H${x + w - r} Q${x + w},${H - h} ${x + w},${H - h + r} V${H} Z`} />
        );
      })}
      {style === "line" && <path d={path(values)} className="stats-line" />}
      {previous && <path d={path(previous)} className="stats-line before" />}
      {average !== null && average !== undefined && (
        <line x1={left} x2={W} y1={y(average)} y2={y(average)} className="stats-avg" />
      )}
      {picked !== null && picked !== undefined && !small && (
        <line x1={cx(picked)} x2={cx(picked)} y1="0" y2={H} className="stats-cross" />
      )}
      {style === "line" && picked !== null && picked !== undefined && values[picked] !== null && (
        <circle cx={cx(picked)} cy={y(values[picked]!)} r="4" className="stats-dot" />
      )}

      {onPick && values.map((_, i) => (
        // Hit area: the whole column, taller than the mark.
        <rect key={`hit${i}`} x={left + i * slot} y="0" width={slot} height={H} fill="transparent"
          onMouseEnter={() => onPick(i)} onClick={() => onPick(i)} />
      ))}

      {!small && first && (
        <>
          <text x={left} y={H + 14} className="stats-tick">{tickLabel(first)}</text>
          {last !== first && <text x={W} y={H + 14} className="stats-tick" textAnchor="end">{tickLabel(last)}</text>}
        </>
      )}
    </svg>
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
        <span>Don&apos;t count my visits on this device (our count and Vercel&apos;s)</span>
      </label>
    </section>
  );
}

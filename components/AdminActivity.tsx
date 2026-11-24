"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HEADS_UP_LABEL, type HeadsUpKind } from "@/lib/headsUps";
import { loadPlaces } from "@/lib/places";
import { roadsById, type RoadOnMap } from "@/lib/roadData";
import {
  FLAG_LABEL, getSupabase, PAVEMENT_LABEL, timeAgo, TRAFFIC_LABEL, WORTH_LABEL,
  type PavementCondition, type RoadFlag, type TrafficLevel, type Worth,
} from "@/lib/supabase";
import { useSiteAdmin } from "@/lib/useSiteAdmin";

/**
 * Site admin only (11.69): recent reviews and recent heads-ups, each in a box
 * that opens and closes (remembered on this device), at the bottom of the
 * notifications. Self-contained so it can be removed or grown into a stats
 * view later. Heads-ups never say who posted them, here as on the map.
 */
export default function AdminActivity() {
  const admin = useSiteAdmin();
  if (!admin) return null;
  return (
    <div className="admin-activity">
      <RecentReviews />
      <RecentHeadsUps />
    </div>
  );
}

const WEEK_MS = 7 * 86_400_000;

/** "just now", "5m ago", "3h ago", "2d ago", or "on 11/2/2026". */
function agoWords(iso: string) {
  const t = timeAgo(iso);
  if (t === "now") return "just now";
  return /^\d+[mhd]$/.test(t) ? `${t} ago` : `on ${t}`;
}

/** A box that remembers whether it was open, on this device. */
function Box({ id, summary, children }: { id: string; summary: React.ReactNode; children: React.ReactNode }) {
  const key = `sl-admin-open-${id}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(key) === "1");
    } catch {
      // No storage: start closed.
    }
  }, [key]);
  return (
    <details className="admin-queues admin-box" open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(now);
        try {
          localStorage.setItem(key, now ? "1" : "0");
        } catch {
          // No storage: nothing to remember.
        }
      }}>
      <summary>{summary}</summary>
      {open && children}
    </details>
  );
}

interface Review {
  road_id: string;
  worth: Worth | null;
  local_best: boolean;
  flags: RoadFlag[] | null;
  pavement: PavementCondition | null;
  traffic: TrafficLevel | null;
  vehicle: "car" | "motorcycle" | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  profiles: { display_name: string; username: string } | null;
}

function RecentReviews() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [roads, setRoads] = useState<Record<string, RoadOnMap>>({});

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      const since = new Date(Date.now() - WEEK_MS).toISOString();
      const [list, count] = await Promise.all([
        sb.from("road_ratings")
          .select("road_id, worth, local_best, flags, pavement, traffic, vehicle, note, created_at, updated_at, profiles(display_name, username)")
          .order("updated_at", { ascending: false })
          .limit(25),
        sb.from("road_ratings").select("road_id", { count: "exact", head: true }).gte("updated_at", since),
      ]);
      if (!live) return;
      const rs = (list.data as unknown as Review[] | null) ?? [];
      setReviews(rs);
      setWeek(count.count ?? 0);
      if (rs.length) {
        const found = await roadsById([...new Set(rs.map((r) => r.road_id))]);
        if (live) setRoads(found);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <Box id="reviews" summary={<>Site admin: recent reviews{week !== null && <> ({week} this week)</>}</>}>
      {reviews === null ? (
        <p className="fine">Loading...</p>
      ) : reviews.length === 0 ? (
        <p className="fine">No reviews yet.</p>
      ) : (
        <ul className="admin-feed">
          {reviews.map((r) => {
            const road = roads[r.road_id];
            const edited = new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60_000;
            const bits = [
              r.worth ? WORTH_LABEL[r.worth] : null,
              r.local_best ? "one of the best around here" : null,
              r.pavement ? `pavement: ${PAVEMENT_LABEL[r.pavement].toLowerCase()}` : null,
              r.traffic ? `traffic: ${TRAFFIC_LABEL[r.traffic].toLowerCase()}` : null,
              r.flags?.length ? `flagged: ${r.flags.map((f) => FLAG_LABEL[f].toLowerCase()).join(", ")}` : null,
            ].filter(Boolean);
            return (
              <li key={`${r.road_id}:${r.profiles?.username ?? ""}:${r.updated_at}`}>
                <p>
                  <Link href={`/road/${r.road_id}`}><b>{road?.name ?? "A road"}</b></Link>
                  {road?.near && <span className="fine"> near {road.near}{road.state ? `, ${road.state}` : ""}</span>}
                </p>
                {bits.length > 0 && <p className="admin-feed-what">{bits.join(" · ")}</p>}
                {r.note && <p className="admin-feed-note">&ldquo;{r.note}&rdquo;</p>}
                <p className="fine">
                  {r.profiles ? <Link href={`/u/${r.profiles.username}`}>{r.profiles.display_name}</Link> : "A member"}
                  {r.vehicle ? `, ${r.vehicle === "car" ? "car" : "motorcycle"}` : ""}
                  {" · "}{edited ? "edited " : ""}{agoWords(r.updated_at)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Box>
  );
}

interface AdminHeadsUp {
  id: string;
  kind: HeadsUpKind;
  lng: number;
  lat: number;
  note: string | null;
  created_at: string;
  expires_at: string;
  still_count: number;
  gone_count: number;
}

type PlaceRows = Awaited<ReturnType<typeof loadPlaces>>["places"];

/** The closest town within about 40 km, as "Town, ST" (places are kept on this device). */
function nearestTown(places: PlaceRows, lng: number, lat: number): string | null {
  const k = Math.cos((lat * Math.PI) / 180);
  let best: string | null = null;
  let bestD = (40 / 111) ** 2;
  for (const p of places) {
    const dx = (p[2] - lng) * k;
    const dy = p[3] - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = `${p[0]}, ${p[1]}`;
    }
  }
  return best;
}

function minutesWord(ms: number) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const hr = Math.round(min / 60);
  return `${hr} hr`;
}

function RecentHeadsUps() {
  const [items, setItems] = useState<AdminHeadsUp[] | null>(null);
  const [towns, setTowns] = useState<Record<string, string | null>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      const { data, error } = await sb.rpc("admin_recent_heads_ups", { p_limit: 30 });
      if (!live) return;
      if (error) {
        setFailed(true);
        setItems([]);
        return;
      }
      const hs = (data as AdminHeadsUp[] | null) ?? [];
      setItems(hs);
      if (!hs.length) return;
      const places = await loadPlaces().catch(() => null);
      if (!live || !places) return;
      setTowns(Object.fromEntries(hs.map((h) => [h.id, nearestTown(places.places, h.lng, h.lat)])));
    })();
    return () => {
      live = false;
    };
  }, []);

  const now = Date.now();
  const upNow = items?.filter((h) => new Date(h.expires_at).getTime() > now).length ?? null;

  return (
    <Box id="hazards" summary={<>Site admin: road hazards (heads-ups){upNow !== null && <> ({upNow} up now)</>}</>}>
      {items === null ? (
        <p className="fine">Loading...</p>
      ) : failed ? (
        <p className="fine warn">Couldn&apos;t load heads-ups.</p>
      ) : items.length === 0 ? (
        <p className="fine">No heads-ups in the last day.</p>
      ) : (
        <ul className="admin-feed">
          {items.map((h) => {
            const ends = new Date(h.expires_at).getTime();
            const isUp = ends > now;
            return (
              <li key={h.id}>
                <p>
                  <b>{HEADS_UP_LABEL[h.kind] ?? h.kind}</b>
                  {towns[h.id] && <span className="fine"> near {towns[h.id]}</span>}
                </p>
                {h.note && <p className="admin-feed-note">&ldquo;{h.note}&rdquo;</p>}
                <p className="fine">
                  <span className={isUp ? "admin-feed-live" : undefined}>
                    {isUp ? `Up now, ends in ${minutesWord(ends - now)}` : `Ended ${minutesWord(now - ends)} ago`}
                  </span>
                  {" · posted "}{minutesWord(now - new Date(h.created_at).getTime())} ago
                  {h.still_count > 0 && ` · still there ${h.still_count}`}
                  {h.gone_count > 0 && ` · gone ${h.gone_count}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="fine">Who posted a heads-up is never shown, here or on the map. Ended ones are deleted after a day.</p>
    </Box>
  );
}

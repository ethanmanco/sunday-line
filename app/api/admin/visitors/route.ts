import { createClient } from "@supabase/supabase-js";
import { supabaseRest } from "@/lib/supabase";

// Unique visitors from Vercel Web Analytics, for the site admin's stats page (11.68).
//
// Settings (Vercel project, server only):
//   VERCEL_ANALYTICS_TOKEN    a Vercel access token (secret; never sent to the browser)
//   VERCEL_ANALYTICS_PROJECT  the project name or id (default "sunday-line")
//   VERCEL_ANALYTICS_TEAM     the team id or slug, if the project belongs to a team
//   VERCEL_ANALYTICS_DAYS     how far back Vercel keeps data (default 30, the Hobby plan's month)

export const dynamic = "force-dynamic";

const API = "https://api.vercel.com/v1/query/web-analytics/visits";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS = new Set(["day", "week", "month"]);

interface Row {
  [key: string]: string | number | undefined;
  pageviews?: number;
  visitors?: number;
  timestamp?: string;
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function isSiteAdmin(auth: string | null): Promise<boolean> {
  if (!supabaseRest || !auth?.startsWith("Bearer ")) return false;
  const sb = createClient(supabaseRest.url, supabaseRest.key, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc("am_site_admin");
  return !error && data === true;
}

export async function GET(req: Request) {
  if (!(await isSiteAdmin(req.headers.get("authorization")))) return json({ error: "Not found" }, 404);

  const token = process.env.VERCEL_ANALYTICS_TOKEN?.trim();
  if (!token) return json({ configured: false });

  const q = new URL(req.url).searchParams;
  const keepDays = Math.max(1, Number(process.env.VERCEL_ANALYTICS_DAYS) || 30);
  const today = isoDay(new Date());
  const oldest = isoDay(new Date(Date.now() - (keepDays - 1) * 86_400_000));
  const until = DATE.test(q.get("until") ?? "") && q.get("until")! < today ? q.get("until")! : today;
  let since = DATE.test(q.get("since") ?? "") ? q.get("since")! : oldest;
  if (since < oldest) since = oldest;
  const group = GROUPS.has(q.get("group") ?? "") ? q.get("group")! : "day";
  if (since > until) return json({ configured: true, keepDays, since, until, visitors: 0, pageviews: 0, series: [], referrers: [], devices: [] });

  const base: Record<string, string> = {
    projectId: process.env.VERCEL_ANALYTICS_PROJECT?.trim() || "sunday-line",
    since,
    until,
  };
  const team = process.env.VERCEL_ANALYTICS_TEAM?.trim();
  if (team) base[team.startsWith("team_") ? "teamId" : "slug"] = team;

  async function get(kind: "count" | "aggregate", extra: Record<string, string> = {}) {
    const res = await fetch(`${API}/${kind}?${new URLSearchParams({ ...base, ...extra })}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Vercel answered ${res.status}`);
    return (await res.json()) as { data: Row | Row[] };
  }

  try {
    const [count, series, referrers, devices] = await Promise.all([
      get("count"),
      get("aggregate", { by: group, limit: "100" }),
      get("aggregate", { by: "referrerHostname", limit: "8" }),
      get("aggregate", { by: "deviceType", limit: "5" }),
    ]);
    const total = count.data as Row;
    const rows = (r: { data: Row | Row[] }) => (Array.isArray(r.data) ? r.data : []);
    const named = (r: { data: Row | Row[] }, key: string) =>
      rows(r).map((x) => ({ name: String(x[key] ?? "") || "Direct or unknown", visitors: Number(x.visitors ?? 0) }));
    return json({
      configured: true,
      keepDays,
      since,
      until,
      visitors: Number(total.visitors ?? 0),
      pageviews: Number(total.pageviews ?? 0),
      series: rows(series)
        .filter((x) => typeof x.timestamp === "string")
        .map((x) => ({ day: String(x.timestamp).slice(0, 10), visitors: Number(x.visitors ?? 0), pageviews: Number(x.pageviews ?? 0) })),
      referrers: named(referrers, "referrerHostname"),
      devices: named(devices, "deviceType"),
    });
  } catch (e) {
    return json({ configured: true, error: e instanceof Error ? e.message : "Vercel did not answer" }, 502);
  }
}

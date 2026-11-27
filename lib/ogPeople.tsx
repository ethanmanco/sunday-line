// Share previews for profiles and groups (11.95): the card iMessage, X, and
// the rest show when someone pastes a link.
//
// Everything here reads with the public key only, the same as a signed-out
// visitor, so a card can never show more than the page would. Private groups
// and unknown links get a plain card with no name on it. Pictures are fetched
// here and handed over as data, so a slow or missing one just drops out.

import { SITE_URL } from "./config";
import { supabaseRest, vehicleName, type Vehicle } from "./supabase";

const BG = "#101318";
const TEXT = "#e8ebef";
const DIM = "#9aa3ae";
const BAND = "linear-gradient(120deg, #2a1d33, #3a2414 60%, #3b3216)";
const MARK = "linear-gradient(135deg, #9a3290, #f27d3b 60%, #fbd44c)";
const USERNAME = /^[a-z0-9_]{3,30}$/;
const GROUP_ID = /^[A-Za-z0-9_-]{6,20}$/;

async function rest<T>(pathAndQuery: string): Promise<T | null> {
  if (!supabaseRest) return null;
  try {
    const res = await fetch(`${supabaseRest.url}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: supabaseRest.key, "Content-Type": "application/json" },
      next: { revalidate: 300 },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * A picture cropped to w x h as a JPEG data URL, or null if it can't be had
 * within a few seconds. Uploads are WebP, which the card renderer can't draw,
 * so sharp (it ships with Next.js) redraws them.
 */
async function dataUrl(url: string | null, w: number, h: number): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1048576) return null;
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(buf).resize(w, h, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } catch {
    return null;
  }
}

const BANNER_W = 1200, BANNER_H = 300, PIC = 204;

function publicFile(path: string | null): string | null {
  return path && supabaseRest ? `${supabaseRest.url}/storage/v1/object/public/profile-images/${path}` : null;
}

/** Group pictures are private files; the public key can sign them only for public groups. */
async function signedGroupFile(path: string | null): Promise<string | null> {
  if (!path || !supabaseRest) return null;
  try {
    const res = await fetch(`${supabaseRest.url}/storage/v1/object/sign/group-images/${path}`, {
      method: "POST",
      headers: { apikey: supabaseRest.key, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 120 }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const { signedURL } = (await res.json()) as { signedURL?: string };
    return signedURL ? `${supabaseRest.url}/storage/v1${signedURL}` : null;
  } catch {
    return null;
  }
}

export interface ProfileCardData {
  name: string;
  username: string;
  isPrivate: boolean;
  bio: string | null;
  avatar: string | null;
  banner: string | null;
  cars: string[];
}

export async function profileCardData(username: string): Promise<ProfileCardData | null> {
  if (!USERNAME.test(username)) return null;
  const rows = await rest<{
    id: string; username: string; display_name: string; bio: string | null; is_private: boolean;
    avatar_path: string | null; avatar_preset: string | null; banner_path: string | null;
  }[]>(`profiles?select=id,username,display_name,bio,is_private,avatar_path,avatar_preset,banner_path&username=eq.${username}`);
  const p = rows?.[0];
  if (!p) return null;
  const lib = p.avatar_preset?.match(/^lib:([a-z0-9-]{2,60})$/)?.[1];
  const avatarUrl = publicFile(p.avatar_path) ?? (lib ? `${SITE_URL}/avatars/library/${lib}.webp` : null);
  // The database hides a private profile's garage from the public key.
  const [avatar, banner, vehicles] = await Promise.all([
    dataUrl(avatarUrl, PIC, PIC),
    dataUrl(publicFile(p.banner_path), BANNER_W, BANNER_H),
    p.is_private ? Promise.resolve(null) : rest<Vehicle[]>(`vehicles?select=year,make,model&user_id=eq.${p.id}&order=sort,created_at`),
  ]);
  return {
    name: p.display_name, username: p.username, isPrivate: p.is_private,
    bio: p.is_private ? null : p.bio, avatar, banner, cars: (vehicles ?? []).map(vehicleName),
  };
}

export interface GroupCardData {
  name: string;
  area: string | null;
  description: string | null;
  members: number | null;
  avatar: string | null;
  banner: string | null;
}

export async function groupCardData(shortId: string): Promise<GroupCardData | null> {
  if (!GROUP_ID.test(shortId)) return null;
  const rows = await rest<{
    id: string; name: string; home_area: string | null; description: string | null; visibility: string;
    avatar_path: string | null; banner_path: string | null;
  }[]>(`groups?select=id,name,home_area,description,visibility,avatar_path,banner_path&short_id=eq.${shortId}`);
  const g = rows?.[0];
  if (!g || g.visibility !== "public") return null;
  const [members, avatar, banner] = await Promise.all([
    rest<number>(`rpc/group_member_count?p_group=${g.id}`),
    signedGroupFile(g.avatar_path).then((u) => dataUrl(u, PIC, PIC)),
    signedGroupFile(g.banner_path).then((u) => dataUrl(u, BANNER_W, BANNER_H)),
  ]);
  return { name: g.name, area: g.home_area, description: g.description, members: typeof members === "number" ? members : null, avatar, banner };
}

/**
 * The card as a JPEG: with photos in it a PNG runs past half a megabyte, and
 * some apps (WhatsApp) skip preview images over about 300 KB. Falls back to
 * the PNG if sharp won't load.
 */
export async function jpegCard(card: Response): Promise<Response> {
  const png = Buffer.from(await card.arrayBuffer());
  const headers = { "Cache-Control": "public, max-age=3600, s-maxage=3600" };
  try {
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpg), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  } catch {
    return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ display: "flex", width: 34, height: 19, background: "linear-gradient(90deg, #9a3290, #f27d3b 55%, #fbd44c)", borderRadius: 3 }} />
      <div style={{ fontFamily: "Display", fontSize: 28, letterSpacing: 4, color: TEXT }}>SUNDAY LINE</div>
    </div>
  );
}

/** Banner across the top, picture over its edge, name and a line or two below. */
function Card({ banner, picture, round, letter, title, sub, line }: {
  banner: string | null;
  picture: string | null;
  round: boolean;
  letter: string;
  title: string;
  sub: string;
  line: string | null;
}) {
  const radius = round ? 999 : 40;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: BG, color: TEXT, fontFamily: "Body" }}>
      <div style={{ display: "flex", width: 1200, height: 300, background: BAND }}>
        {banner && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img src={banner} width={1200} height={300} style={{ width: 1200, height: 300, objectFit: "cover" }} />
        )}
      </div>
      <div style={{ display: "flex", flex: 1, padding: "0 64px 44px", gap: 40 }}>
        <div style={{ display: "flex", width: 220, height: 220, marginTop: -110, borderRadius: radius, border: `8px solid ${BG}`, background: MARK, overflow: "hidden", alignItems: "center", justifyContent: "center", flex: "none" }}>
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={picture} width={204} height={204} style={{ width: 204, height: 204, objectFit: "cover" }} />
          ) : (
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 110, color: "#140b06" }}>{letter}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingTop: 22, minWidth: 0 }}>
          <div style={{ display: "flex", fontFamily: "Display", fontSize: title.length > 24 ? 60 : 76, lineHeight: 1 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 30, color: DIM, marginTop: 10 }}>{sub}</div>
          {line && <div style={{ display: "flex", fontSize: 30, color: TEXT, marginTop: 14 }}>{line}</div>}
        </div>
      </div>
      <div style={{ display: "flex", position: "absolute", right: 56, bottom: 40 }}>
        <Brand />
      </div>
    </div>
  );
}

export function ProfileCard({ p }: { p: ProfileCardData }) {
  const cars = p.cars.length ? `${p.cars[0]}${p.cars.length > 1 ? ` + ${p.cars.length - 1} more` : ""}` : null;
  return (
    <Card
      banner={p.banner} picture={p.avatar} round letter={p.name.trim()[0]?.toUpperCase() ?? "?"}
      title={clip(p.name, 34)}
      sub={`@${p.username}${p.isPrivate ? " · Private profile" : ""}`}
      line={p.isPrivate ? null : cars ?? (p.bio ? clip(p.bio, 60) : null)}
    />
  );
}

export function GroupCard({ g }: { g: GroupCardData }) {
  const sub = [g.area, "Car and bike group", g.members !== null ? `${g.members} ${g.members === 1 ? "member" : "members"}` : null].filter(Boolean).join(" · ");
  return (
    <Card
      banner={g.banner} picture={g.avatar} round={false} letter={g.name.trim()[0]?.toUpperCase() ?? "?"}
      title={clip(g.name, 34)} sub={sub} line={g.description ? clip(g.description, 60) : null}
    />
  );
}

/** For private groups and links that go nowhere: no name, nothing to leak. */
export function PlainCard({ what }: { what: "profile" | "group" }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BG, color: TEXT, fontFamily: "Body", padding: 64 }}>
      <Brand />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", fontFamily: "Display", fontSize: 84, lineHeight: 1 }}>{what === "group" ? "A group on Sunday Line" : "A profile on Sunday Line"}</div>
        <div style={{ display: "flex", fontSize: 32, color: DIM }}>Great driving roads, and the people who drive them.</div>
      </div>
      <div style={{ display: "flex", height: 12, borderRadius: 6, background: "linear-gradient(90deg, #4b2c86, #9a3290, #d4466a, #f27d3b, #fbd44c)" }} />
    </div>
  );
}

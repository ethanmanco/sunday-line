"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import VehicleCard from "./VehicleCard";
import ProfileSpots from "./ProfileSpots";
import { useAuth } from "@/components/AuthProvider";
import ProfileHeader, { type Counts } from "./ProfileHeader";
import PersonRow from "./PersonRow";
import {
  accountsEnabled, getSupabase, PROFILE_COLUMNS, rememberReturn, signedMediaUrls, sortPhotos,
  type FollowStatus, type Media, type Profile, type Vehicle, type VehiclePhoto,
} from "@/lib/supabase";

type Tab = "garage" | "photos" | "spots" | "followers" | "following";

export default function ProfileView({ username }: { username: string }) {
  const { ready, user, profile: me } = useAuth();
  const router = useRouter();
  const [vehiclePhotos, setVehiclePhotos] = useState<VehiclePhoto[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [follow, setFollow] = useState<FollowStatus | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("garage");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data: p } = await sb.from("profiles").select(PROFILE_COLUMNS).eq("username", username).maybeSingle();
    if (!p) {
      setMissing(true);
      return;
    }
    const person = p as Profile;
    setProfile(person);
    const [c, v, vp, m, f, b] = await Promise.all([
      sb.rpc("follow_counts", { person: person.id }).single(),
      sb.from("vehicles").select("*").eq("user_id", person.id).order("sort").order("created_at"),
      sb.from("vehicle_photos").select("*").eq("user_id", person.id),
      sb.from("profile_media").select("*").eq("user_id", person.id).order("sort").order("created_at", { ascending: false }),
      user
        ? sb.from("follows").select("status").eq("follower_id", user.id).eq("followee_id", person.id).maybeSingle()
        : Promise.resolve({ data: null }),
      user
        ? sb.from("blocks").select("blocked_id").eq("blocker_id", user.id).eq("blocked_id", person.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setCounts((c.data as Counts | null) ?? null);
    const vs = (v.data as Vehicle[] | null) ?? [];
    const ms = (m.data as Media[] | null) ?? [];
    const vps = (vp.data as VehiclePhoto[] | null) ?? [];
    setVehicles(vs);
    setVehiclePhotos(vps);
    setMedia(ms);
    setFollow(((f.data as { status: FollowStatus } | null)?.status) ?? null);
    setBlocked(Boolean(b.data));
    setUrls(await signedMediaUrls([...vps.map((x) => x.path), ...ms.map((x) => x.path)]));
  }, [username, user]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!accountsEnabled) {
    return <div className="page narrow"><h1>Profiles</h1><p>Accounts aren&apos;t switched on for this copy of the site yet.</p></div>;
  }
  if (missing) {
    return (
      <div className="page narrow">
        <h1>No one here</h1>
        <p>There&apos;s no profile called @{username}. <Link href="/">Back to the roads</Link></p>
      </div>
    );
  }
  if (!profile) return <div className="page narrow"><p>Loading...</p></div>;

  const isMe = user?.id === profile.id;
  const locked = profile.is_private && !isMe && follow !== "accepted";

  async function doFollow() {
    const sb = getSupabase();
    if (!sb || !profile) return;
    setBusy(true);
    setError(null);
    const { data, error } = await sb.from("follows").insert({ followee_id: profile.id }).select("status").single();
    setBusy(false);
    if (error) setError("Couldn't follow right now.");
    else {
      setFollow((data as { status: FollowStatus }).status);
      load();
    }
  }

  async function unfollow() {
    const sb = getSupabase();
    if (!sb || !profile || !user) return;
    if (follow === "accepted" && profile.is_private &&
      !window.confirm(`Unfollow @${profile.username}? Their profile is private, so you'd have to ask again to follow.`)) return;
    setBusy(true);
    await sb.from("follows").delete().eq("follower_id", user.id).eq("followee_id", profile.id);
    setBusy(false);
    setFollow(null);
    load();
  }

  async function message() {
    const sb = getSupabase();
    if (!sb || !profile) return;
    setBusy(true);
    setError(null);
    const { data, error } = await sb.rpc("start_direct", { p_user: profile.id });
    setBusy(false);
    if (error || !data) setError(`@${profile.username} isn't taking messages from you right now.`);
    else router.push(`/messages/${data as string}`);
  }

  async function block() {
    const sb = getSupabase();
    if (!sb || !profile) return;
    if (!window.confirm(`Block @${profile.username}? You'll stop following each other, and they won't be able to follow you or see your cars and photos. They aren't told.`)) return;
    setBusy(true);
    await sb.from("blocks").insert({ blocked_id: profile.id });
    setBusy(false);
    load();
  }

  async function unblock() {
    const sb = getSupabase();
    if (!sb || !profile || !user) return;
    setBusy(true);
    await sb.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", profile.id);
    setBusy(false);
    load();
  }

  let action: React.ReactNode = null;
  if (isMe) action = <Link href="/me" className="button ghost">Edit profile</Link>;
  else if (!user) {
    action = (
      <Link href="/signin" className="button" onClick={() => rememberReturn(`/u/${profile.username}`)}>Follow</Link>
    );
  } else if (!me) action = <Link href="/me" className="button">Set up your profile to follow</Link>;
  else if (blocked) action = <button type="button" className="button ghost" disabled={busy} onClick={unblock}>Unblock</button>;
  else if (follow === "accepted") {
    action = <button type="button" className="button ghost" disabled={busy} onClick={unfollow}>Following</button>;
  } else if (follow === "pending") {
    action = <button type="button" className="button ghost" disabled={busy} onClick={unfollow}>Requested</button>;
  } else action = <button type="button" className="button" disabled={busy} onClick={doFollow}>Follow</button>;
  const canMessage = user && me && !isMe && !blocked && profile.dm_policy !== "nobody";
  if (canMessage) {
    action = (
      <>
        {action}
        <button type="button" className="button ghost" disabled={busy} onClick={message}>Message</button>
      </>
    );
  }

  return (
    <div className="page profile">
      <ProfileHeader profile={profile} counts={counts}>{action}</ProfileHeader>
      {error && <p className="hint warn" role="alert">{error}</p>}
      {follow === "accepted" && !blocked && (
        <p className="fine">Tap Following to unfollow.</p>
      )}
      {follow === "pending" && (
        <p className="fine">Waiting for @{profile.username} to approve. Tap Requested to cancel.</p>
      )}

      {blocked ? (
        <p className="panel-note">You blocked @{profile.username}. They can&apos;t follow you or see your cars and photos.</p>
      ) : locked ? (
        <p className="panel-note">
          This profile is private.{" "}
          {follow === "pending"
            ? `Once @${profile.username} approves, you'll see their garage, photos, and who they follow.`
            : `${user && me ? "Follow to ask for access to" : "Approved followers see"} their garage, photos, and who they follow.`}
        </p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Profile sections">
            {([
              ["garage", `Garage (${vehicles.length})`],
              ["photos", `Photos (${media.length})`],
              ["spots", "Spots"],
              ["followers", "Followers"],
              ["following", "Following"],
            ] as [Tab, string][]).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === "garage" && <Garage vehicles={vehicles} photos={vehiclePhotos} urls={urls} isMe={isMe} />}
            {tab === "photos" && <Photos media={media} urls={urls} isMe={isMe} />}
            {tab === "spots" && <ProfileSpots personId={profile.id} isMe={isMe} />}
            {tab === "followers" && <FollowList personId={profile.id} direction="followers" />}
            {tab === "following" && <FollowList personId={profile.id} direction="following" />}
          </div>
        </>
      )}

      {user && me && !isMe && !blocked && (
        <p className="fine block-line">
          <button type="button" className="link" onClick={block} disabled={busy}>Block @{profile.username}</button>
        </p>
      )}
    </div>
  );
}

function Garage({ vehicles, photos, urls, isMe }: {
  vehicles: Vehicle[];
  photos: VehiclePhoto[];
  urls: Record<string, string>;
  isMe: boolean;
}) {
  if (!vehicles.length) {
    return <p className="fine">{isMe ? <>Nothing in your garage yet. <Link href="/me#garage">Add a vehicle</Link></> : "Nothing in the garage yet."}</p>;
  }
  return (
    <ul className="garage">
      {vehicles.map((v) => (
        <VehicleCard key={v.id} vehicle={v} photos={sortPhotos(photos.filter((p) => p.vehicle_id === v.id))} urls={urls} />
      ))}
    </ul>
  );
}

function Photos({ media, urls, isMe }: { media: Media[]; urls: Record<string, string>; isMe: boolean }) {
  if (!media.length) {
    return <p className="fine">{isMe ? <>No photos yet. <Link href="/me#photos">Add some</Link></> : "No photos yet."}</p>;
  }
  return (
    <ul className="gallery">
      {media.map((m) =>
        urls[m.path] ? (
          <li key={m.id}>
            <a href={urls[m.path]} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urls[m.path]} alt={m.caption ?? "Photo"} loading="lazy" />
            </a>
            {m.caption && <p className="fine">{m.caption}</p>}
          </li>
        ) : null,
      )}
    </ul>
  );
}

function FollowList({ personId, direction }: { personId: string; direction: "followers" | "following" }) {
  const [people, setPeople] = useState<Profile[] | null>(null);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    const q =
      direction === "followers"
        ? sb.from("follows").select(`person:profiles!follows_follower_id_fkey(${PROFILE_COLUMNS})`).eq("followee_id", personId)
        : sb.from("follows").select(`person:profiles!follows_followee_id_fkey(${PROFILE_COLUMNS})`).eq("follower_id", personId);
    q.eq("status", "accepted").order("created_at", { ascending: false }).limit(200).then(({ data }) => {
      setPeople(((data as unknown as { person: Profile | null }[]) ?? []).flatMap((r) => (r.person ? [r.person] : [])));
    });
  }, [personId, direction]);
  if (!people) return <p className="fine">Loading...</p>;
  if (!people.length) return <p className="fine">{direction === "followers" ? "No followers yet." : "Not following anyone yet."}</p>;
  return <ul className="people">{people.map((p) => <PersonRow key={p.id} person={p} />)}</ul>;
}

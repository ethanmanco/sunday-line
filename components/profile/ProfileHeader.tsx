import Avatar from "@/components/Avatar";
import { openPhoto } from "@/components/PhotoViewer";
import { publicImageUrl, type Profile } from "@/lib/supabase";

export interface Counts {
  followers: number;
  following: number;
}

export type FollowListName = "followers" | "following";

export default function ProfileHeader({ profile, counts, openList, listOpen, children }: {
  profile: Profile;
  counts: Counts | null;
  /** When set, the counts are buttons that open that list (11.93). */
  openList?: (which: FollowListName) => void;
  /** The list showing now, if any. */
  listOpen?: FollowListName | null;
  children?: React.ReactNode;
}) {
  const banner = publicImageUrl(profile.banner_path);
  const photo = publicImageUrl(profile.avatar_path);
  const name = profile.display_name;
  return (
    <header className="profile-head">
      {banner ? (
        <button type="button" className="banner banner-button" style={{ backgroundImage: `url("${banner}")` }}
          aria-label={`View ${name}'s banner`} onClick={() => openPhoto(banner, `${name}'s banner`)} />
      ) : (
        <div className="banner" />
      )}
      <div className="profile-id">
        {photo ? (
          <button type="button" className="avatar-button" aria-label={`View ${name}'s picture`}
            onClick={() => openPhoto(photo, `${name}'s picture`)}>
            <Avatar person={profile} size={96} className="big" />
          </button>
        ) : (
          <Avatar person={profile} size={96} className="big" />
        )}
        <div className="profile-actions">{children}</div>
      </div>
      <h1>{name}</h1>
      <p className="handle">
        @{profile.username}
        {profile.is_private && <span className="tag">Private</span>}
      </p>
      {profile.bio && <p className="bio">{profile.bio}</p>}
      {counts && (
        <p className="counts">
          {openList ? (
            <>
              <button type="button" className="count-link" aria-pressed={listOpen === "followers"} onClick={() => openList("followers")}>
                <b>{counts.followers}</b> {counts.followers === 1 ? "follower" : "followers"}
              </button>
              {" · "}
              <button type="button" className="count-link" aria-pressed={listOpen === "following"} onClick={() => openList("following")}>
                <b>{counts.following}</b> following
              </button>
            </>
          ) : (
            <>
              <b>{counts.followers}</b> {counts.followers === 1 ? "follower" : "followers"} · <b>{counts.following}</b> following
            </>
          )}
        </p>
      )}
    </header>
  );
}

import Avatar from "@/components/Avatar";
import { publicImageUrl, type Profile } from "@/lib/supabase";

export interface Counts {
  followers: number;
  following: number;
}

export default function ProfileHeader({ profile, counts, children }: {
  profile: Profile;
  counts: Counts | null;
  children?: React.ReactNode;
}) {
  const banner = publicImageUrl(profile.banner_path);
  return (
    <header className="profile-head">
      <div className="banner" style={banner ? { backgroundImage: `url("${banner}")` } : undefined} />
      <div className="profile-id">
        <Avatar person={profile} size={96} className="big" />
        <div className="profile-actions">{children}</div>
      </div>
      <h1>{profile.display_name}</h1>
      <p className="handle">
        @{profile.username}
        {profile.is_private && <span className="tag">Private</span>}
      </p>
      {profile.bio && <p className="bio">{profile.bio}</p>}
      {counts && (
        <p className="counts">
          <b>{counts.followers}</b> {counts.followers === 1 ? "follower" : "followers"} · <b>{counts.following}</b> following
        </p>
      )}
    </header>
  );
}

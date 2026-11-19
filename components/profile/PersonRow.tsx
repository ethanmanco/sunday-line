import Link from "next/link";
import Avatar from "@/components/Avatar";
import type { Profile } from "@/lib/supabase";

/** One person in a list: picture, name, @username, and optional buttons. */
export default function PersonRow({ person, note, children }: { person: Profile; note?: string | null; children?: React.ReactNode }) {
  return (
    <li className="person">
      <Link href={`/u/${person.username}`} className="person-link">
        <Avatar person={person} size={40} />
        <span>
          <b>{person.display_name}</b>
          <span className="fine handle-inline">@{person.username}</span>
          {note && <span className="fine handle-inline">{note}</span>}
        </span>
      </Link>
      {children && <span className="row">{children}</span>}
    </li>
  );
}

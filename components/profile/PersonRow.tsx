import Link from "next/link";
import Avatar from "@/components/Avatar";
import type { Profile } from "@/lib/supabase";

/** One person in a list: picture, name, @username, and optional buttons. */
export default function PersonRow({ person, note, as: Tag = "li", children }: {
  person: Profile;
  note?: string | null;
  /** "div" when the row sits inside a list item of its own (a group member with controls). */
  as?: "li" | "div";
  children?: React.ReactNode;
}) {
  return (
    <Tag className="person">
      <Link href={`/u/${person.username}`} className="person-link">
        <Avatar person={person} size={40} />
        <span>
          <b>{person.display_name}</b>
          <span className="fine handle-inline">@{person.username}</span>
          {note && <span className="fine handle-inline">{note}</span>}
        </span>
      </Link>
      {children && <span className="row">{children}</span>}
    </Tag>
  );
}

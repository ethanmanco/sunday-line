import type { Metadata } from "next";
import InviteView from "@/components/groups/InviteView";

// Generic title on purpose: the link itself is the key, so the preview never
// names the group, and the token isn't passed along to other sites.
export const metadata: Metadata = {
  title: "Group invite",
  description: "You've been invited to a group on Sunday Line.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteView token={token} />;
}

import type { Metadata } from "next";
import EventView from "@/components/events/EventView";

// Events are members-only, so the page title stays generic.
export const metadata: Metadata = { title: "Event", robots: { index: false, follow: false } };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventView eventId={id} />;
}

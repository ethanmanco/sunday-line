import { ImageResponse } from "next/og";
import { OG_SIZE, ogFonts } from "@/lib/ogImage";
import { GroupCard, groupCardData, jpegCard, PlainCard } from "@/lib/ogPeople";

export const size = OG_SIZE;
export const contentType = "image/jpeg";
export const alt = "Group preview from Sunday Line";

// Public groups only (the public key can't see private ones); anything else gets a card with no name.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [g, fonts] = await Promise.all([groupCardData(id), ogFonts()]);
  return jpegCard(new ImageResponse(g ? <GroupCard g={g} /> : <PlainCard what="group" />, { ...OG_SIZE, fonts }));
}

import { ImageResponse } from "next/og";
import { OG_SIZE, ogFonts } from "@/lib/ogImage";
import { jpegCard, PlainCard, ProfileCard, profileCardData } from "@/lib/ogPeople";

export const size = OG_SIZE;
export const contentType = "image/jpeg";
export const alt = "Profile preview from Sunday Line";

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [p, fonts] = await Promise.all([profileCardData(username.toLowerCase()), ogFonts()]);
  return jpegCard(new ImageResponse(p ? <ProfileCard p={p} /> : <PlainCard what="profile" />, { ...OG_SIZE, fonts }));
}

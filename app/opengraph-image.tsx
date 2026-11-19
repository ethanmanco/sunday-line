import { ImageResponse } from "next/og";
import { OG_SIZE, ogFonts, SiteCard } from "@/lib/ogImage";
import { loadIndex } from "@/lib/serverData";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Sunday Line: great driving roads across the United States";

export default async function Image() {
  const [index, fonts] = await Promise.all([loadIndex(), ogFonts()]);
  return new ImageResponse(<SiteCard count={index.roads} />, { ...OG_SIZE, fonts });
}

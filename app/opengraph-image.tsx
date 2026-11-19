import { ImageResponse } from "next/og";
import { OG_SIZE, ogFonts, SiteCard } from "@/lib/ogImage";
import { loadRoadData } from "@/lib/serverData";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Sunday Line: great local driving roads";

export default async function Image() {
  const [data, fonts] = await Promise.all([loadRoadData(), ogFonts()]);
  const count = data.roads.filter((r) => r.category === "drivers").length;
  return new ImageResponse(<SiteCard region={data.region} count={count} />, { ...OG_SIZE, fonts });
}

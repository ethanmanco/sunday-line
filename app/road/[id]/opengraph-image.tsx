import { ImageResponse } from "next/og";
import { OG_SIZE, ogFonts, RoadCard } from "@/lib/ogImage";
import { findRoad, loadRoadData } from "@/lib/serverData";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Road preview from Sunday Line";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [road, data, fonts] = await Promise.all([findRoad(id), loadRoadData(), ogFonts()]);
  if (!road) return new Response("Not found", { status: 404 });
  return new ImageResponse(<RoadCard road={road} region={data.region} />, { ...OG_SIZE, fonts });
}

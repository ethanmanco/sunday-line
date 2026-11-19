import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RoadsPanel from "@/components/RoadsPanel";
import { lengthText } from "@/lib/roads";
import { findRoad } from "@/lib/serverData";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const r = await findRoad(id);
  if (!r) return { title: "Road not found" };
  const title = `${r.name}${r.near ? ` near ${r.near}` : ""}`;
  const description = `Overall ${r.scores.overall}, Twisty ${r.scores.twisty}, Speed ${r.scores.speed}, Pavement ${r.scores.pavement}. ${lengthText(r, "imperial")}, ${r.speed.text}.`;
  return {
    title,
    description,
    alternates: { canonical: `/road/${r.id}` },
    openGraph: { title, description, url: `/road/${r.id}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function RoadPage({ params }: Params) {
  const { id } = await params;
  const road = await findRoad(id);
  if (!road) notFound();
  return <RoadsPanel initialRoadId={id} initialRoad={road} />;
}

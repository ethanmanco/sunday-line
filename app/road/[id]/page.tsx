import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Explorer from "@/components/Explorer";
import { lengthText } from "@/lib/roads";
import { findRoad, loadRoadData } from "@/lib/serverData";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const r = await findRoad(id);
  if (!r) return { title: "Road not found" };
  const { region } = await loadRoadData();
  const title = `${r.name}${r.near ? ` near ${r.near}` : ""}`;
  const description = `Overall ${r.scores.overall}, Twisty ${r.scores.twisty}, Speed ${r.scores.speed}, Pavement ${r.scores.pavement}. ${lengthText(r, region.units)}, ${r.speed.text}.`;
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
  if (!(await findRoad(id))) notFound();
  return <Explorer initialRoadId={id} />;
}

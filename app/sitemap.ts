import { readFileSync } from "node:fs";
import path from "node:path";
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// The sitemap (11.67): the main pages and the top-rated roads, all at the
// https address, so search engines list the right one.
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/groups`, changeFrequency: "weekly", priority: 0.5 },
  ];
  try {
    const top = JSON.parse(readFileSync(path.join(process.cwd(), "public", "data", "us", "top.json"), "utf8")) as { roads: { id: string }[] };
    for (const r of top.roads) pages.push({ url: `${SITE_URL}/road/${r.id}`, changeFrequency: "monthly", priority: 0.6 });
  } catch {
    // No road data in this build: the main pages are enough.
  }
  return pages;
}

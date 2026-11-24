import type { Metadata } from "next";
import RoadsPanel from "@/components/RoadsPanel";

// The one address search engines should list for the home page (11.67).
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  return <RoadsPanel />;
}

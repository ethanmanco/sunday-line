import type { Metadata } from "next";
import SpotsLibrary from "@/components/spots/SpotsLibrary";

export const metadata: Metadata = { title: "Your spots", robots: { index: false } };

export default function SpotsPage() {
  return <SpotsLibrary />;
}

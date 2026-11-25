import type { Metadata } from "next";
import DayRoute from "@/components/DayRoute";

export const metadata: Metadata = { title: "Day route" };

export default function RoutePage() {
  return <DayRoute />;
}

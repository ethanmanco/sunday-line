import MapShell from "@/components/MapShell";
import { homeSeed } from "@/lib/serverData";

/** Pages that sit on the shared map: the road list, roads, profiles, groups, and events. */
export default async function MapLayout({ children }: { children: React.ReactNode }) {
  return <MapShell seed={await homeSeed()}>{children}</MapShell>;
}

import MapShell from "@/components/MapShell";

/** Pages that sit on the shared map: the road list, roads, profiles, groups, and events. */
export default function MapLayout({ children }: { children: React.ReactNode }) {
  return <MapShell>{children}</MapShell>;
}

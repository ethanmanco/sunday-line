"use client";

import { useEffect } from "react";
import { useMapShell } from "./mapShell";
import type { Spot } from "./spots";

/**
 * A profile, group, or event page on the shared map: its spots replace the
 * usual layers while it's open, the panel is wider on big screens, and on
 * phones it opens halfway so the map shows above it.
 */
export function usePageOnMap(title: string | null, spots: Spot[] | null) {
  const shell = useMapShell();
  useEffect(() => {
    if (!shell) return;
    shell.setPanelWide(true);
    shell.setSheet("half");
    return () => {
      shell.setOverlay(null);
      shell.setPanelWide(false);
    };
    // On arrival and departure only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // "none" until loaded; then the IDs (an empty list is still a list).
  const key = spots ? `s:${spots.map((s) => s.id).join(",")}` : "none";
  useEffect(() => {
    if (!shell || !title || !spots) return;
    shell.setOverlay({ title, spots });
    // Spots are compared by their IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, key]);
  return shell;
}

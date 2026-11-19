import { decodePolyline } from "@/lib/polyline";
import { directionsLinks } from "@/lib/roads";
import { useEffect, useRef } from "react";
import { SpotMark } from "@/components/RoadList";
import { useMapShell } from "@/lib/mapShell";
import { lineMiles, PUBLIC_LABEL, spotLabel, type Spot } from "@/lib/spots";

/**
 * One spot in a list. Tapping the card shows it on the map (when onOpen is
 * given); actions are buttons passed in by the page.
 */
export default function SpotCard({ spot, groupName, showStatus = false, onOpen, children }: {
  spot: Spot;
  groupName?: string | null;
  showStatus?: boolean;
  onOpen?: () => void;
  children?: React.ReactNode;
}) {
  const shell = useMapShell();
  const selected = shell?.selectedSpotId === spot.id;
  const li = useRef<HTMLLIElement>(null);
  // Picked on the map: bring its card into view.
  useEffect(() => {
    if (selected) li.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);
  const miles = spot.kind === "road" && spot.line ? lineMiles(decodePolyline(spot.line)) : null;
  const go = directionsLinks([spot.lng, spot.lat]);
  const summary = (
    <>
      <SpotMark spot={spot} scoreKey="overall" />
      <span className="spot-top">
        <b>{spot.name}</b>
        <span className="fine">
          {[spotLabel(spot), miles !== null ? `${miles.toFixed(1)} mi` : null, groupName ? `in ${groupName}` : null].filter(Boolean).join(" · ")}
        </span>
        {spot.description && <span className="spot-desc">{spot.description}</span>}
      </span>
    </>
  );
  return (
    <li ref={li} className={`spot-card${selected ? " is-selected" : ""}`} id={`spot-${spot.id}`}>
      {onOpen ? (
        <button type="button" className="spot-open" onClick={onOpen} aria-label={`${spot.name}: show on the map`}>{summary}</button>
      ) : (
        <div className="spot-open static">{summary}</div>
      )}
      {showStatus && (spot.group_status === "proposed" || spot.public_status !== "none") && (
        <p className="fine spot-status">
          {spot.group_status === "proposed" && <span className="tag">Waiting for the group</span>}{" "}
          {spot.public_status !== "none" && (
            <span className={`tag${spot.public_status === "approved" ? " good" : ""}`}>{PUBLIC_LABEL[spot.public_status]}</span>
          )}
          {spot.public_note && (spot.public_status === "pending" || spot.public_status === "rejected") && (
            <span> {spot.public_status === "pending" ? "Needs a look because: " : "Note: "}{spot.public_note}</span>
          )}
        </p>
      )}
      <div className="spot-actions">
        <details className="directions">
          <summary className="chip">Directions</summary>
          <div className="directions-menu">
            {go.map((l) => (
              <a key={l.label} className="chip" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
            ))}
          </div>
        </details>
        {children}
      </div>
    </li>
  );
}

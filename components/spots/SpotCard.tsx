import { decodePolyline } from "@/lib/polyline";
import { directionsLinks } from "@/lib/roads";
import { lineMiles, PUBLIC_LABEL, spotLabel, type Spot } from "@/lib/spots";

/** One spot in a list: what it is, where, and buttons passed in by the page. */
export default function SpotCard({ spot, groupName, showStatus = false, children }: {
  spot: Spot;
  groupName?: string | null;
  showStatus?: boolean;
  children?: React.ReactNode;
}) {
  const miles = spot.kind === "road" && spot.line ? lineMiles(decodePolyline(spot.line)) : null;
  const go = directionsLinks([spot.lng, spot.lat]);
  return (
    <li className="spot-card" id={`spot-${spot.id}`}>
      <div className="spot-top">
        <b>{spot.name}</b>
        <span className="fine">
          {[spotLabel(spot), miles !== null ? `${miles.toFixed(1)} mi` : null, groupName ? `in ${groupName}` : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      {spot.description && <p className="spot-desc">{spot.description}</p>}
      {showStatus && (
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
      <p className="fine spot-go">
        {spot.kind === "road" ? "Directions to the start: " : "Directions: "}
        {go.map((l, i) => (
          <span key={l.label}>
            {i > 0 && " · "}
            <a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
          </span>
        ))}
      </p>
      {children && <p className="row spot-actions">{children}</p>}
    </li>
  );
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodePolyline } from "./polyline";
import { lengthText, scoreColor, scoreInk, speedShort, STATUS_LABEL } from "./roads";
import type { RegionInfo, Road } from "./types";

export const OG_SIZE = { width: 1200, height: 630 };

export async function ogFonts() {
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [display, body] = await Promise.all([
    readFile(path.join(dir, "BarlowCondensed-Bold.ttf")),
    readFile(path.join(dir, "Barlow-Medium.ttf")),
  ]);
  return [
    { name: "Display", data: display, weight: 700 as const, style: "normal" as const },
    { name: "Body", data: body, weight: 500 as const, style: "normal" as const },
  ];
}

/** Fit a road's line into a box, keeping its shape (equirectangular, scaled by latitude). */
function linePath(coords: [number, number][], w: number, h: number, pad: number): string {
  const lat0 = coords.reduce((a, c) => a + c[1], 0) / coords.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = coords.map((c) => c[0] * k);
  const ys = coords.map((c) => -c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((w - 2 * pad) / Math.max(maxX - minX, 1e-9), (h - 2 * pad) / Math.max(maxY - minY, 1e-9));
  const ox = (w - (maxX - minX) * s) / 2;
  const oy = (h - (maxY - minY) * s) / 2;
  return xs.map((x, i) => `${i ? "L" : "M"}${(ox + (x - minX) * s).toFixed(1)} ${(oy + (ys[i] - minY) * s).toFixed(1)}`).join(" ");
}

const BG = "#101318";
const PANEL = "#171b22";
const LINE = "#272d37";
const TEXT = "#e8ebef";
const DIM = "#9aa3ae";

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", width: 40, height: 22, background: "linear-gradient(90deg, #9a3290, #f27d3b 55%, #fbd44c)", borderRadius: 3 }} />
      <div style={{ fontFamily: "Display", fontSize: 34, letterSpacing: 5, color: TEXT }}>SUNDAY LINE</div>
    </div>
  );
}

export function RoadCard({ road: r }: { road: Road }) {
  const coords = decodePolyline(r.line);
  const d = linePath(coords, 470, 470, 40);
  const color = scoreColor(r.scores.overall);
  const stats: [string, number][] = [
    ["Twisty", r.scores.twisty],
    ["Speed", r.scores.speed],
    ["Pavement", r.scores.pavement],
  ];
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: BG, color: TEXT, fontFamily: "Body", padding: 56, gap: 48 }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
        <Brand />
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 104, height: 104, borderRadius: 22, background: color, color: scoreInk(r.scores.overall), fontFamily: "Display", fontSize: 64 }}>
              {String(r.scores.overall)}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontFamily: "Display", fontSize: r.name.length > 26 ? 50 : 62, lineHeight: 1.02 }}>{r.name}</div>
              <div style={{ display: "flex", fontSize: 26, color: DIM, marginTop: 6 }}>
                {[r.near && `Near ${r.near}`, r.state].filter(Boolean).join(", ")}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {stats.map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: "12px 20px", minWidth: 150 }}>
                <div style={{ display: "flex", fontSize: 20, color: DIM }}>{k}</div>
                <div style={{ display: "flex", fontFamily: "Display", fontSize: 44, color: scoreColor(v) }}>{String(v ?? "")}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: TEXT }}>
            {`${lengthText(r, "imperial")} · ${speedShort(r)} · ${STATUS_LABEL[r.status]}`}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 18, color: DIM }}>Road data © OpenStreetMap contributors</div>
      </div>
      <div style={{ display: "flex", width: 470, height: 518, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
        <svg width="470" height="470" viewBox="0 0 470 470">
          <path d={d} fill="none" stroke="#08090b" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export function SiteCard({ count }: { count: number }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BG, color: TEXT, fontFamily: "Body", padding: 64 }}>
      <Brand />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontFamily: "Display", fontSize: 92, lineHeight: 1 }}>Great driving roads</div>
        <div style={{ fontSize: 32, color: DIM }}>
          {`${count.toLocaleString("en-US")} roads across the United States, rated against real race tracks at legal speeds.`}
        </div>
      </div>
      <div style={{ display: "flex", height: 12, borderRadius: 6, background: "linear-gradient(90deg, #4b2c86, #9a3290, #d4466a, #f27d3b, #fbd44c)" }} />
    </div>
  );
}

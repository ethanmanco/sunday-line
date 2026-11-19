// Profile pictures: an uploaded photo, one of the preset vehicle drawings, or
// the first letter of the name. The drawings are original side views by body
// style. No brand logos (those are trademarks).

import { publicImageUrl } from "@/lib/supabase";

type Shape = {
  label: string;
  kind: "car" | "bike";
  body: string[];
  window?: string;
  lines?: string[];
  wheels: [number, number];
  r: number;
  y: number;
};

export const SHAPES: Record<string, Shape> = {
  roadster: {
    label: "Roadster", kind: "car",
    body: ["M5 41 L5 36 Q6 33 12 32 L25 31 L29 26 L31 26 L30 31 L52 31 Q58 32 59 36 L59 41 Z"],
    wheels: [16, 48], r: 6, y: 42,
  },
  hot_hatch: {
    label: "Hot hatch", kind: "car",
    body: ["M7 41 L7 30 L12 21 L34 20 Q38 21 44 28 L54 30 Q58 31 58 35 L58 41 Z"],
    window: "M14 28 L17 23 L32 22.5 L39 28 Z",
    wheels: [17, 48], r: 6, y: 42,
  },
  muscle: {
    label: "Muscle car", kind: "car",
    body: ["M3 41 L3 34 L10 32 L20 31 L28 24 L42 24 L48 31 L59 32 Q61 33 61 36 L61 41 Z"],
    window: "M24 30 L30 25.5 L41 25.5 L45 30 Z",
    wheels: [14, 50], r: 6.5, y: 42,
  },
  jdm_coupe: {
    label: "Tuner coupe", kind: "car",
    body: [
      "M4 41 L4 34 L14 32 L22 31 L30 25 L41 25 L49 30 L60 32 L60 41 Z",
      "M3 27 L14 27 L14 29 L10 29 L10 32 L8 32 L8 29 L3 29 Z",
    ],
    window: "M26 30.5 L31 26.5 L40 26.5 L45 30.5 Z",
    wheels: [15, 50], r: 6, y: 42,
  },
  truck: {
    label: "Truck", kind: "car",
    body: ["M3 41 L3 29 L29 29 L29 19 L43 19 L50 28 L60 30 L60 41 Z"],
    window: "M32 27 L32 21.5 L42 21.5 L47 27 Z",
    wheels: [14, 50], r: 7, y: 42,
  },
  sport_bike: {
    label: "Sport bike", kind: "bike",
    body: ["M20 37 L26 27 L38 25 L47 19 L52 22 L49 31 L40 36 Z", "M13 27 L28 25 L26 29 Z"],
    lines: ["M14 40 L30 33", "M49 31 L50 40"],
    wheels: [14, 50], r: 8, y: 40,
  },
  cruiser: {
    label: "Cruiser", kind: "bike",
    body: [
      "M24 28 Q31 21 38 27 L36 30 L25 30 Z",
      "M13 30 Q19 25 25 29 L25 31 L13 32 Z",
      "M26 31 L36 31 L36 38 L27 38 Z",
    ],
    lines: ["M40 21 L52 40", "M37 19 L43 21", "M12 40 L27 36"],
    wheels: [12, 52], r: 8.5, y: 40,
  },
  adventure: {
    label: "Adventure bike", kind: "bike",
    body: [
      "M20 32 L26 26 L40 25 L44 17 L49 18 L47 28 L38 33 L26 34 Z",
      "M47 25 L55 28 L48 29 Z",
      "M7 23 L18 23 L18 31 L7 31 Z",
    ],
    lines: ["M47 28 L50 39", "M15 39 L30 33"],
    wheels: [15, 50], r: 8.5, y: 39,
  },
};

export const COLORS: Record<string, string> = {
  red: "#e5484d",
  orange: "#f27d3b",
  yellow: "#fbd44c",
  green: "#46a758",
  teal: "#12a594",
  blue: "#3e8ed0",
  purple: "#8e4ec6",
  white: "#e8ebef",
  gray: "#8b939e",
};

export function parsePreset(preset: string | null): { shape: Shape; color: string } | null {
  if (!preset) return null;
  const [s, c] = preset.split("-");
  const shape = SHAPES[s];
  const color = COLORS[c];
  return shape && color ? { shape, color } : null;
}

export function PresetDrawing({ preset, title }: { preset: string; title?: string }) {
  const p = parsePreset(preset);
  if (!p) return null;
  const { shape, color } = p;
  return (
    <svg viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="64" height="64" fill="#151920" />
      <rect width="64" height="64" fill={color} opacity="0.2" />
      <ellipse cx="32" cy={shape.y + shape.r - 0.5} rx="27" ry="2" fill="#000" opacity="0.35" />
      {shape.lines?.map((d) => (
        <path key={d} d={d} stroke={color} strokeWidth="3" strokeLinecap="round" fill="none" />
      ))}
      {shape.body.map((d) => <path key={d} d={d} fill={color} />)}
      {shape.window && <path d={shape.window} fill="#0b0d11" opacity="0.75" />}
      {shape.wheels.map((x) =>
        shape.kind === "car" ? (
          <g key={x}>
            <circle cx={x} cy={shape.y} r={shape.r} fill="#0b0d11" />
            <circle cx={x} cy={shape.y} r={shape.r * 0.5} fill="none" stroke="#c9ced6" strokeWidth="1.5" />
          </g>
        ) : (
          <g key={x}>
            <circle cx={x} cy={shape.y} r={shape.r - 1.5} fill="none" stroke="#0b0d11" strokeWidth="3.5" />
            <circle cx={x} cy={shape.y} r={shape.r - 4} fill="none" stroke="#c9ced6" strokeWidth="1" />
            <circle cx={x} cy={shape.y} r="1.5" fill="#c9ced6" />
          </g>
        ),
      )}
    </svg>
  );
}

interface AvatarProps {
  person: { display_name: string; avatar_path: string | null; avatar_preset: string | null };
  size?: number;
  className?: string;
}

/** Decorative: the name is always shown next to it, so screen readers skip it. */
export default function Avatar({ person, size = 40, className = "" }: AvatarProps) {
  const url = publicImageUrl(person.avatar_path);
  const style = { width: size, height: size };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`avatar ${className}`} style={style} width={size} height={size} />;
  }
  // A photo from the car and bike library (11.28).
  const lib = person.avatar_preset?.match(/^lib:([a-z0-9-]{2,60})$/)?.[1];
  if (lib) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/avatars/library/${lib}.webp`} alt="" className={`avatar ${className}`} style={style} width={size} height={size} />;
  }
  if (parsePreset(person.avatar_preset)) {
    return (
      <span className={`avatar ${className}`} style={style} aria-hidden="true">
        <PresetDrawing preset={person.avatar_preset!} />
      </span>
    );
  }
  return (
    <span className={`avatar letter ${className}`} style={{ ...style, fontSize: size * 0.45 }} aria-hidden="true">
      {(person.display_name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export type RoadCategory = "drivers" | "gravel" | "unsure" | "other";

export interface Scores {
  overall: number;
  twisty: number;
  speed: number;
  flow: number;
  elevation: number;
  scenic: number;
  surface: number;
  quiet: number;
}

export interface Road {
  id: string;
  name: string;
  ref: string | null;
  near: string | null;
  state: string | null;
  status: "candidate" | "community_submitted" | "verified" | "flagged" | "retired";
  category: RoadCategory;
  excluded: string[];
  checked: string | null;
  length_m: number;
  home_mi: number;
  scores: Scores;
  speed: { min: number | null; max: number | null; units: string; source: string; text: string; note: string | null };
  surface: { text: string; paved: boolean; gravel: boolean };
  elevation: { climb_ft: number | null; descent_ft: number | null; min_ft: number | null; max_ft: number | null; profile_ft: number[] };
  scenery: { forest: number; water: number; wetland: number; byway: string | null; tags: string[] };
  stops: { junctions: number; stops: number; signals: number };
  start: [number, number];
  end: [number, number];
  bbox: [number, number, number, number];
  line: string;
  osm_way_ids: number[];
}

export interface RegionInfo {
  slug: string;
  name: string;
  units: "imperial" | "metric";
  bbox: [number, number, number, number];
  home: [number, number];
  home_name: string;
  area: string;
  local_radius_mi: number;
}

export interface RoadData {
  region: RegionInfo;
  scoring_version: string | null;
  generated: string;
  license: string;
  roads: Road[];
}

/** Road with its decoded line, ready for the map. */
export interface LoadedRoad extends Road {
  coords: [number, number][];
}

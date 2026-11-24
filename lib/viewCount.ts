/**
 * The anonymous page view counter (11.66). Only the kind of page is counted
 * (and the road, on road pages): never ids, usernames, invite tokens, or
 * anything about the visitor.
 */

export type PageKind =
  | "map" | "road" | "group" | "groups" | "event" | "profile" | "people" | "messages"
  | "notifications" | "spots" | "about" | "me" | "join" | "signin" | "other";

export interface CountedPage {
  page: PageKind;
  road?: string;
}

const ROAD_ID = /^[a-f0-9]{12}$/;

/** What to count for a path, or null for pages that aren't counted (the admin pages). */
export function pageForPath(path: string): CountedPage | null {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const first = parts[0] ?? "";
  switch (first) {
    case "":
      return { page: "map" };
    case "road": {
      const id = parts[1] ?? "";
      return ROAD_ID.test(id) ? { page: "road", road: id } : { page: "road" };
    }
    case "g":
      return { page: "group" };
    case "groups":
      return { page: "groups" };
    case "e":
      return { page: "event" };
    case "u":
      return { page: "profile" };
    case "people":
    case "messages":
    case "notifications":
    case "spots":
    case "about":
    case "me":
      return { page: first };
    case "j":
      return { page: "join" };
    case "signin":
    case "auth":
      return { page: "signin" };
    case "admin":
      return null;
    default:
      return { page: "other" };
  }
}

export const NO_COUNT_KEY = "sl-no-count";

/** Global Privacy Control, Do Not Track, or "don't count this device" turn the counter off. */
export function countingAllowed(): boolean {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.globalPrivacyControl === true || nav.doNotTrack === "1") return false;
    return localStorage.getItem(NO_COUNT_KEY) !== "1";
  } catch {
    return false;
  }
}

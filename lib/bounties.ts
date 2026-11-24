import type { Road } from "./types";

/**
 * Bounties (11.78): roads whose surface or access needs a check. A check the
 * site admin confirms pays everyone who flagged it rep: a fifth of the road's
 * Overall score for a bounty (at least 5), 5 for any other road. The database
 * caps it at 40 and pays only accounts a week old, at most 50 points a day.
 */
export const BASE_POINTS = 5;

export function isBounty(r: Pick<Road, "category">): boolean {
  return r.category === "unsure";
}

export function bountyPoints(r: Pick<Road, "category" | "scores">): number {
  return isBounty(r) ? Math.min(40, Math.max(BASE_POINTS, Math.round(r.scores.overall / 5))) : BASE_POINTS;
}

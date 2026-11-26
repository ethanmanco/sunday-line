/**
 * Slurs can't be usernames (11.92). Curse words are fine.
 *
 * Kept in step with private.username_has_slur() in
 * supabase/migrations/20261219000000_username_slurs.sql, which is what really
 * enforces it; this copy only lets the form say so while you type.
 *
 * Number swaps count as letters (n1gg3r), repeated letters still match, and
 * underscores don't split a word. Short words that turn up inside ordinary ones
 * ("spicy", "raccoon", "Montenegro") only count on their own or set off by
 * underscores.
 */

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/** Anywhere in the name, underscores removed. */
const ANYWHERE = new RegExp(
  "(n+i+gg+(e+r+|a+|u+h+)|f+a+g+(o|e|i)+t+|t+r+a+n+n+(y+|i+e+)|w+e+t+b+a+c+k+|b+e+a+n+e+r+|r+a+g+h+e+a+d+|t+o+w+e+l+h+e+a+d+)",
);

/** A whole word: the full name, or a part between underscores. */
const WORD = new RegExp(
  "^(f+a+g+s?|n+i+g+s?|s+p+i+c+k?s?|k+i+k+e+s?|c+o+o+n+s?|g+o+o+k+s?|c+h+i+n+k+s?|d+y+k+e+s?|r+e+t+a+r+d+(e+d+|s)?|p+a+k+i+s?|j+a+p+s?|w+o+p+s?|n+e+g+r+o+e?s?)$",
);

/** True when the username has a slur in it. Expects the cleaned form (a-z, 0-9, _). */
export function usernameHasSlur(name: string): boolean {
  const s = name.toLowerCase().replace(/[0-9]/g, (d) => LEET[d] ?? d);
  if (ANYWHERE.test(s.replace(/_/g, ""))) return true;
  return s.split("_").some((part) => WORD.test(part.replace(/[0-9]/g, "")));
}

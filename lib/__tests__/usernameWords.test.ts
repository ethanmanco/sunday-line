import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { usernameHasSlur } from "../usernameWords";

const cases = JSON.parse(readFileSync(join(__dirname, "fixtures", "username-slurs.json"), "utf8")) as {
  blocked: string[];
  allowed: string[];
};

describe("usernameHasSlur (11.92)", () => {
  it.each(cases.blocked)("blocks %s", (name) => expect(usernameHasSlur(name)).toBe(true));
  it.each(cases.allowed)("allows %s", (name) => expect(usernameHasSlur(name)).toBe(false));

  it("runs the same cases as the database test", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "tests", "database", "username_slurs.test.sql"), "utf8");
    for (const name of [...cases.blocked, ...cases.allowed]) expect(sql).toContain(`'${name}'`);
  });
});

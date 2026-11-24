import { describe, expect, it } from "vitest";
import { pageForPath } from "@/lib/viewCount";

describe("pageForPath", () => {
  it("counts the kind of page only", () => {
    expect(pageForPath("/")).toEqual({ page: "map" });
    expect(pageForPath("/?spot=abc")).toEqual({ page: "map" });
    expect(pageForPath("/g/xyz123")).toEqual({ page: "group" });
    expect(pageForPath("/u/someone")).toEqual({ page: "profile" });
    expect(pageForPath("/e/1234")).toEqual({ page: "event" });
    expect(pageForPath("/messages/abc")).toEqual({ page: "messages" });
    expect(pageForPath("/groups/new")).toEqual({ page: "groups" });
    expect(pageForPath("/auth/confirm")).toEqual({ page: "signin" });
    expect(pageForPath("/nowhere")).toEqual({ page: "other" });
  });

  it("never keeps invite tokens", () => {
    expect(pageForPath("/j/secret-token-value")).toEqual({ page: "join" });
  });

  it("counts the road on road pages, only when the id looks like one", () => {
    expect(pageForPath("/road/0123456789ab")).toEqual({ page: "road", road: "0123456789ab" });
    expect(pageForPath("/road/not-a-road")).toEqual({ page: "road" });
  });

  it("does not count the admin pages", () => {
    expect(pageForPath("/admin/stats")).toBeNull();
    expect(pageForPath("/admin/roads")).toBeNull();
  });
});

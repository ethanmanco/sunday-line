import { describe, expect, it } from "vitest";
import { analyticsUrl, pageForPath } from "../viewCount";

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

describe("analyticsUrl", () => {
  it("drops ids, queries and the #part", () => {
    expect(analyticsUrl("https://sundayline.app/?spot=abc#x")).toBe("https://sundayline.app/");
    expect(analyticsUrl("https://sundayline.app/g/xyz123")).toBe("https://sundayline.app/g/[id]");
    expect(analyticsUrl("https://sundayline.app/messages/abc-def")).toBe("https://sundayline.app/messages");
    expect(analyticsUrl("https://sundayline.app/u/someone")).toBe("https://sundayline.app/u/[username]");
    expect(analyticsUrl("https://sundayline.app/j/secret-token-value?x=1")).toBe("https://sundayline.app/j/[invite]");
  });

  it("keeps public road ids", () => {
    expect(analyticsUrl("https://sundayline.app/road/0123456789ab?from=share")).toBe("https://sundayline.app/road/0123456789ab");
  });

  it("sends nothing for the admin pages or bad addresses", () => {
    expect(analyticsUrl("https://sundayline.app/admin/stats")).toBeNull();
    expect(analyticsUrl("not a url")).toBeNull();
  });
});

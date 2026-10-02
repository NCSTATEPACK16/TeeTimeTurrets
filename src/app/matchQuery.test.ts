import { describe, expect, it } from "vitest";
import { matchSecondsFromQuery } from "./matchQuery";

describe("matchSecondsFromQuery", () => {
  it("reads ?match=60 as exactly 60 seconds", () => {
    expect(matchSecondsFromQuery("?match=60")).toBe(60);
  });

  it("clamps to 15 and 180 at exactly those bounds", () => {
    expect(matchSecondsFromQuery("?match=1")).toBe(15);
    expect(matchSecondsFromQuery("?match=999")).toBe(180);
  });

  it("leaves the default alone when the query is missing, empty or not a number", () => {
    expect(matchSecondsFromQuery("")).toBeUndefined();
    expect(matchSecondsFromQuery("?perf")).toBeUndefined();
    expect(matchSecondsFromQuery("?match=")).toBeUndefined();
    expect(matchSecondsFromQuery("?match=abc")).toBeUndefined();
  });
});

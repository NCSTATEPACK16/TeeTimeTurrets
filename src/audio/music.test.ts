import { describe, expect, it } from "vitest";
import { musicIntensity } from "./music";

describe("music intensity", () => {
  it("is silent off the clock, patrols calm, heats with kills and peaks in the final 30", () => {
    expect(musicIntensity({ recentKills: 5, remaining: 10, live: false })).toBe(0);
    const calm = musicIntensity({ recentKills: 0, remaining: 120, live: true });
    const hot = musicIntensity({ recentKills: 3, remaining: 120, live: true });
    expect(calm).toBeGreaterThan(0);
    expect(calm).toBeLessThan(0.4); // below the snare-and-bass layer
    expect(hot).toBeGreaterThanOrEqual(0.75); // the brass layer comes in
    expect(musicIntensity({ recentKills: 0, remaining: 30, live: true })).toBe(1);
  });
});

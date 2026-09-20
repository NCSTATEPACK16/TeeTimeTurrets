import { describe, expect, it } from "vitest";
import {
  BANNER_DWELL_S,
  BANNER_FADE_S,
  BannerFeed,
  createBannerView,
} from "./bannerFeed";
import type { BannerSource } from "./bannerFeed";

const QUIET: BannerSource = {
  holedOut: false,
  lastShotInWater: false,
  lastShotOutOfBounds: false,
  playerDead: false,
  playerKills: 0,
};

function view(feed: BannerFeed) {
  const out = createBannerView();
  feed.view(out);
  return out;
}

describe("BannerFeed", () => {
  it("shows nothing at rest", () => {
    const feed = new BannerFeed();
    feed.update(QUIET, 1 / 60);
    expect(view(feed).visible).toBe(false);
  });

  it("fires on the rising edge of an event, then holds at full for the dwell", () => {
    const feed = new BannerFeed();
    feed.update(QUIET, 1 / 60);
    feed.update({ ...QUIET, lastShotInWater: true }, 1 / 60);

    const v = view(feed);
    expect(v.visible).toBe(true);
    expect(v.headline).toBe("WATER HAZARD");
    expect(v.consequence).toBe("PLUS ONE STROKE");
    expect(v.opacity).toBe(1);
  });

  it("does not re-fire while the flag stays true -- an event is an edge", () => {
    const feed = new BannerFeed();
    feed.update({ ...QUIET, lastShotInWater: true }, 1 / 60); // baseline call captures true, no fire
    // The first update baselines; drive an actual edge from false -> true.
    const feed2 = new BannerFeed();
    feed2.update(QUIET, 1 / 60);
    feed2.update({ ...QUIET, lastShotInWater: true }, 1 / 60);
    // Hold the flag true and let it dwell down past a full banner lifetime.
    let ticks = 0;
    for (let t = 0; t < BANNER_DWELL_S + BANNER_FADE_S + 1; t += 1 / 60) {
      feed2.update({ ...QUIET, lastShotInWater: true }, 1 / 60);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(0);
    // It fired once and then expired; a held flag never re-fires.
    expect(view(feed2).visible).toBe(false);
    // And the first feed never fired at all, because true was its baseline.
    expect(view(feed).visible).toBe(false);
  });

  it("dwells at full opacity, then fades to zero and disappears", () => {
    const feed = new BannerFeed();
    feed.update(QUIET, 0);
    feed.update({ ...QUIET, playerDead: true }, 0); // fire at t=0

    expect(view(feed).opacity).toBe(1);

    // Advance to just before the fade begins: still full.
    feed.update(QUIET, BANNER_DWELL_S - 0.01);
    expect(view(feed).opacity).toBeCloseTo(1, 5);

    // Into the fade: opacity between 0 and 1.
    feed.update(QUIET, 0.3);
    const mid = view(feed);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);

    // Past the end: gone.
    feed.update(QUIET, BANNER_FADE_S);
    expect(view(feed).visible).toBe(false);
  });

  it("lets the higher-priority event win when two land on the same tick", () => {
    const feed = new BannerFeed();
    feed.update(QUIET, 1 / 60);
    // Water and a kill on the same tick: the kill outranks the hazard.
    feed.update({ ...QUIET, lastShotInWater: true, playerKills: 1 }, 1 / 60);
    expect(view(feed).headline).toBe("ENEMY DOWN");
  });

  it("does not replay history when wired up with an event already true", () => {
    const feed = new BannerFeed();
    // First-ever update already has the player dead and a kill on the board.
    feed.update({ ...QUIET, playerDead: true, playerKills: 3 }, 1 / 60);
    expect(view(feed).visible).toBe(false);
  });
});

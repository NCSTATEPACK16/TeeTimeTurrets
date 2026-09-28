import { describe, expect, it } from "vitest";
import { SIGHT_INTERVAL_MS, SIGHT_RANGE_M, Sightlines } from "./sightlines";
import type { SightQuery } from "./sightlines";

/** Flat ground at 0 that counts how often it is asked, with an optional wall along x = wallX. */
function countingGround(wallX = Infinity): { heightAt(x: number, z: number): number; calls: number } {
  return {
    calls: 0,
    heightAt(x: number) {
      this.calls++;
      return Math.abs(x - wallX) < 1 ? 100 : 0;
    },
  };
}

function query(overrides: Partial<SightQuery> = {}): SightQuery {
  return {
    enemy: true,
    onScreen: true,
    fromX: 0,
    fromY: 2,
    fromZ: 0,
    toX: 100,
    toY: 2,
    toZ: 0,
    ...overrides,
  };
}

/** Runs `frames` frames of 60 Hz, asking about `plates` plates each frame, and returns the calls per frame. */
function run(
  sight: Sightlines,
  ground: { heightAt(x: number, z: number): number; calls: number },
  plates: number,
  frames: number,
  q: (plate: number) => SightQuery = () => query(),
): number[] {
  const perFrame: number[] = [];
  for (let f = 0; f < frames; f++) {
    const before = ground.calls;
    const now = f * (1000 / 60);
    for (let p = 0; p < plates; p++) sight.canSee(p, q(p), ground, now);
    perFrame.push(ground.calls - before);
  }
  return perFrame;
}

describe("Sightlines", () => {
  it(`walks each enemy's sight line about ${1000 / SIGHT_INTERVAL_MS} times a second, not every frame`, () => {
    const ground = countingGround();
    const sight = new Sightlines(4);
    const perFrame = run(sight, ground, 4, 60);
    // One walk is 49 samples (100 m at 2 m steps, endpoints skipped).
    const walks = perFrame.reduce((a, b) => a + b, 0) / 49;
    expect(walks).toBeGreaterThanOrEqual(4 * 9);
    expect(walks).toBeLessThanOrEqual(4 * 11);
  });

  /**
   * The first frame walks every plate, because a plate that has never been walked has no answer and
   * would otherwise stay blank for up to an interval. From then on each has its own slot.
   */
  it("staggers the plates so no frame after the first walks more than one sight line", () => {
    const ground = countingGround();
    const sight = new Sightlines(4);
    const perFrame = run(sight, ground, 4, 120);
    expect(perFrame[0]).toBe(4 * 49);
    expect(Math.max(...perFrame.slice(1))).toBeLessThanOrEqual(49);
  });

  /** Mid-interval the answer is the last walk's, even if the ground between has changed. */
  it("holds the last answer until the plate's next slot", () => {
    const walled = countingGround(50);
    const open = countingGround();
    const sight = new Sightlines(1);
    expect(sight.canSee(0, query(), walled, 0)).toBe(false);
    expect(sight.canSee(0, query(), open, SIGHT_INTERVAL_MS / 2)).toBe(false);
    expect(open.calls).toBe(0);
    expect(sight.canSee(0, query(), open, SIGHT_INTERVAL_MS)).toBe(true);
  });

  it("walks nothing for a plate that is off screen, and reports it unseen", () => {
    const ground = countingGround();
    const sight = new Sightlines(1);
    const seen = run(sight, ground, 1, 60, () => query({ onScreen: false }));
    expect(ground.calls).toBe(0);
    expect(seen).toBeDefined();
    expect(sight.canSee(0, query({ onScreen: false }), ground, 2000)).toBe(false);
  });

  it(`walks nothing past ${SIGHT_RANGE_M} m, and reports the cart unseen`, () => {
    const ground = countingGround();
    const sight = new Sightlines(1);
    const far = query({ toX: SIGHT_RANGE_M + 1 });
    run(sight, ground, 1, 60, () => far);
    expect(ground.calls).toBe(0);
    expect(sight.canSee(0, far, ground, 2000)).toBe(false);
    // Just inside, the same ground is walked and clear.
    expect(sight.canSee(0, query({ toX: SIGHT_RANGE_M - 1 }), ground, 3000)).toBe(true);
    expect(ground.calls).toBeGreaterThan(0);
  });

  it("walks nothing for an ally, which is always seen", () => {
    const ground = countingGround(50);
    const sight = new Sightlines(1);
    expect(sight.canSee(0, query({ enemy: false }), ground, 0)).toBe(true);
    expect(ground.calls).toBe(0);
  });

  /** A plate that comes back on screen must not show a stale answer for up to an interval. */
  it("walks at once when a plate comes back on screen after its interval has passed", () => {
    const ground = countingGround(50);
    const sight = new Sightlines(1);
    expect(sight.canSee(0, query(), ground, 0)).toBe(false);
    sight.canSee(0, query({ onScreen: false }), ground, 50);
    const before = ground.calls;
    sight.canSee(0, query(), ground, 50 + SIGHT_INTERVAL_MS);
    expect(ground.calls).toBeGreaterThan(before);
  });

  it("answers from the ground: a wall between the carts blocks, open ground does not", () => {
    const sight = new Sightlines(2);
    expect(sight.canSee(0, query(), countingGround(50), 0)).toBe(false);
    expect(sight.canSee(1, query(), countingGround(), 0)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import {
  DECK_HALF_WIDTH,
  DECK_SHOULDER_RUN,
  causewayInfluence,
  deriveCrossings,
} from "./crossing";
import type { Crossing } from "./crossing";

/**
 * Crossings are derived **after a hole validates and are not reachable from `validateHole`**
 * (spec D9). That is the whole claim: routing must stay bit-for-bit identical, so a crossing may
 * never change whether a hole is accepted, and the eighteen holes keep the shape they have.
 *
 * Pure functions of a `HoleSpec` -- no terrain, no Rapier, no seed.
 */

/** A pond straddling the corridor about a third of the way down, the shape holes 2, 13 and 15 have. */
const CARRY: HoleSpec["water"] = [
  {
    points: [
      { x: -20, z: -40 },
      { x: 4, z: -40 },
      { x: 4, z: 40 },
      { x: -20, z: 40 },
    ],
  },
];

function spec(overrides: Partial<HoleSpec> = {}): HoleSpec {
  return { ...fixedHoleSpec(), ...overrides };
}

describe("deriveCrossings", () => {
  it("yields nothing on a hole with no water, which is the common case", () => {
    // Ten of the eighteen briefs have no water at all, so the no-op path is the one that runs most.
    expect(deriveCrossings(spec())).toEqual([]);
  });

  it("yields nothing when water sits beside the corridor rather than across it", () => {
    const beside: HoleSpec["water"] = [
      {
        points: [
          { x: -10, z: 45 },
          { x: 14, z: 45 },
          { x: 14, z: 70 },
          { x: -10, z: 70 },
        ],
      },
    ];
    expect(deriveCrossings(spec({ water: beside }))).toEqual([]);
  });

  it("spans a pond the centreline crosses with exactly one deck", () => {
    const crossings = deriveCrossings(spec({ water: CARRY }));
    expect(crossings).toHaveLength(1);

    const deck = crossings[0]!;
    // The deck runs across the water, so its span must be at least the water it covers.
    const span = Math.hypot(deck.bx - deck.ax, deck.bz - deck.az);
    expect(span).toBeGreaterThan(24);
  });

  it("lands both deck ends on dry ground, not in the pond it spans", () => {
    // A deck that stopped at the waterline would be a ramp into the pond. Both ends have to reach
    // the bank, which is what makes it drivable at all.
    const crossings = deriveCrossings(spec({ water: CARRY }));
    const deck = crossings[0]!;
    const inside = (x: number, z: number): boolean => x > -20 && x < 4 && z > -40 && z < 40;
    expect(inside(deck.ax, deck.az)).toBe(false);
    expect(inside(deck.bx, deck.bz)).toBe(false);
  });

  it("follows the centreline, so a moved dog-leg moves the deck", () => {
    // The tie to `spec.control`, and what stops this being a straight line between two fixed
    // points that happens to cross the same pond.
    const straight = deriveCrossings(spec({ water: CARRY }))[0]!;
    const swung = deriveCrossings(
      spec({ water: CARRY, control: [{ x: -45, z: 0 }, { x: 0, z: 34 }, { x: 45, z: 8 }] }),
    )[0]!;
    expect(Math.hypot(swung.az - straight.az, swung.bz - straight.bz)).toBeGreaterThan(4);
  });

  it("bridges each of two separate ponds on its own", () => {
    const twin: HoleSpec["water"] = [
      { points: [{ x: -26, z: -20 }, { x: -16, z: -20 }, { x: -16, z: 20 }, { x: -26, z: 20 }] },
      { points: [{ x: 10, z: -20 }, { x: 22, z: -20 }, { x: 22, z: 20 }, { x: 10, z: 20 }] },
    ];
    expect(deriveCrossings(spec({ water: twin }))).toHaveLength(2);
  });

  it("is deterministic and takes no seed", () => {
    // Spec D9: derived, never drawn. A crossing that moved with the seed would be a second thing
    // the course generator has to agree with a server about.
    const a = deriveCrossings(spec({ water: CARRY }));
    const b = deriveCrossings(spec({ water: CARRY, seed: fixedHoleSpec().seed ^ 0x9e3779b9 }));
    expect(b).toEqual(a);
  });
});

describe("causewayInfluence", () => {
  /** A point `offset` metres square across the deck from its midpoint. Derived from the deck's own
   *  direction rather than assumed to be an axis -- the deck follows the centreline, not the grid. */
  function across(deck: Crossing, offset: number): { x: number; z: number } {
    const dx = deck.bx - deck.ax;
    const dz = deck.bz - deck.az;
    const length = Math.hypot(dx, dz);
    return {
      x: (deck.ax + deck.bx) / 2 - (dz / length) * offset,
      z: (deck.az + deck.bz) / 2 + (dx / length) * offset,
    };
  }

  it("is full on the deck centreline and gone past the shoulder", () => {
    const deck = deriveCrossings(spec({ water: CARRY }))[0]!;
    const on = across(deck, 0);
    const edge = across(deck, DECK_HALF_WIDTH * 0.5);
    const past = across(deck, DECK_HALF_WIDTH + DECK_SHOULDER_RUN + 1);

    expect(causewayInfluence([deck], on.x, on.z)).toBe(1);
    expect(causewayInfluence([deck], edge.x, edge.z)).toBe(1);
    expect(causewayInfluence([deck], past.x, past.z)).toBe(0);
  });

  it("ramps down the shoulder rather than dropping off it", () => {
    // Spec §7: the shoulder/pond junction is the most likely place for the cart to catch or the
    // ball to trip, so a long gentle run beats a short tidy one. A step here would be an edge the
    // 1 m cell cannot express without a seam the ball trips over.
    const deck = deriveCrossings(spec({ water: CARRY }))[0]!;

    let previous = 1;
    for (let step = 0; step <= 10; step++) {
      const point = across(deck, DECK_HALF_WIDTH + (DECK_SHOULDER_RUN * step) / 10);
      const value = causewayInfluence([deck], point.x, point.z);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      expect(value).toBeGreaterThanOrEqual(0);
      previous = value;
    }
    expect(previous).toBeLessThan(0.02);
  });

  it("is zero everywhere on a hole with no crossings", () => {
    expect(causewayInfluence([], 0, 0)).toBe(0);
    expect(causewayInfluence([], 45, 8)).toBe(0);
  });

  it("does not reach beyond the deck's ends", () => {
    // A causeway that kept going past its own abutment would raise ground the length of the hole.
    const deck = deriveCrossings(spec({ water: CARRY }))[0]!;
    const dx = deck.bx - deck.ax;
    const dz = deck.bz - deck.az;
    const length = Math.hypot(dx, dz);
    const beyond = DECK_HALF_WIDTH + DECK_SHOULDER_RUN + 2;
    expect(causewayInfluence([deck], deck.bx + (dx / length) * beyond, deck.bz + (dz / length) * beyond)).toBe(0);
  });
});

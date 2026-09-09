import { describe, expect, it } from "vitest";
import {
  COARSE_RANGE_M,
  ENEMY_FADE_S,
  EXACT_RANGE_M,
  createPlateStateScratch,
  derivePlateState,
  formatPlateDistance,
} from "./plateState";
import type { PlateSource, PlateState } from "./plateState";

/** derivePlateState writes into a caller-owned scratch object rather than allocating (see its
 *  docstring); tests want a fresh return value each call, so this wraps that. */
function derive(source: PlateSource): PlateState {
  const out = createPlateStateScratch();
  derivePlateState(source, out);
  return out;
}

function source(overrides: Partial<PlateSource> = {}): PlateSource {
  return {
    team: "ally",
    distanceM: 50,
    healthFraction: 1,
    onScreen: true,
    hasLineOfSight: true,
    secondsSinceLastSeen: 0,
    ...overrides,
  };
}

describe("distance tiers", () => {
  it("reports exact whole metres inside the exact range", () => {
    expect(formatPlateDistance(87)).toBe("87 m");
    expect(formatPlateDistance(3)).toBe("3 m");
    // Rounds rather than truncates: 86.7 m is nearer 87 than 86.
    expect(formatPlateDistance(86.7)).toBe("87 m");
  });

  it("rounds to the coarse step and marks it approximate beyond the exact range", () => {
    // 168 / 25 = 6.72, which rounds to 7 steps.
    expect(formatPlateDistance(168)).toBe("~175 m");
    // 212 / 25 = 8.48, which rounds to 8 steps.
    expect(formatPlateDistance(212)).toBe("~200 m");
    expect(formatPlateDistance(287)).toBe("~275 m");
  });

  it("drops the number entirely past the coarse range", () => {
    // Paired with a value inside the range, so this cannot pass against an implementation that
    // simply returns "" for everything -- the defect TEST-AND-SPEC-PITFALLS section 1 is about.
    expect(formatPlateDistance(COARSE_RANGE_M - 0.5)).not.toBe("");
    expect(formatPlateDistance(COARSE_RANGE_M + 0.5)).toBe("");
    expect(formatPlateDistance(410)).toBe("");
  });

  it("puts each boundary in exactly one tier", () => {
    // Just under the exact range is exact; the boundary itself is already approximate.
    expect(formatPlateDistance(EXACT_RANGE_M - 0.5)).toBe("100 m");
    expect(formatPlateDistance(EXACT_RANGE_M)).toBe("~100 m");
    // The coarse range is the last distance that still carries a number.
    expect(formatPlateDistance(COARSE_RANGE_M)).toBe("~300 m");
  });
});

describe("ally visibility", () => {
  it("shows an ally through terrain: you always know where your team is", () => {
    const state = derive(source({ team: "ally", hasLineOfSight: false, secondsSinceLastSeen: 99 }));
    expect(state.visible).toBe(true);
    expect(state.opacity).toBe(1);
  });

  it("hides an ally that is off screen rather than clamping it to an edge", () => {
    // The on-screen control makes `onScreen` the only thing that can explain the difference.
    expect(derive(source({ team: "ally", onScreen: true })).visible).toBe(true);
    expect(derive(source({ team: "ally", onScreen: false })).visible).toBe(false);
  });
});

describe("enemy visibility", () => {
  it("shows an enemy in line of sight at full opacity", () => {
    const state = derive(source({ team: "enemy", hasLineOfSight: true }));
    expect(state.visible).toBe(true);
    expect(state.opacity).toBe(1);
  });

  it("fades an enemy out over the fade window once sight breaks", () => {
    const half = derive(
      source({ team: "enemy", hasLineOfSight: false, secondsSinceLastSeen: ENEMY_FADE_S / 2 }),
    );
    expect(half.visible).toBe(true);
    expect(half.opacity).toBeCloseTo(0.5, 5);
  });

  it("hides an enemy once the fade window has elapsed", () => {
    const base = { team: "enemy", hasLineOfSight: false } as const;
    // Straddling the boundary: only the elapsed time differs between these two.
    const lingering = derive(source({ ...base, secondsSinceLastSeen: ENEMY_FADE_S - 0.01 }));
    const gone = derive(source({ ...base, secondsSinceLastSeen: ENEMY_FADE_S + 0.01 }));
    expect(lingering.visible).toBe(true);
    expect(gone.visible).toBe(false);
  });

  it("hides an off-screen enemy even while sight is held", () => {
    const base = { team: "enemy", hasLineOfSight: true } as const;
    expect(derive(source({ ...base, onScreen: true })).visible).toBe(true);
    expect(derive(source({ ...base, onScreen: false })).visible).toBe(false);
  });
});

describe("passthrough fields", () => {
  it("carries team and health through to the plate", () => {
    const state = derive(source({ team: "enemy", healthFraction: 0.42 }));
    expect(state.team).toBe("enemy");
    expect(state.healthFraction).toBeCloseTo(0.42, 5);
  });

  it("clamps a health fraction that arrives outside 0..1", () => {
    expect(derive(source({ healthFraction: 1.4 })).healthFraction).toBe(1);
    expect(derive(source({ healthFraction: -0.2 })).healthFraction).toBe(0);
  });

  it("applies the same tiering as formatPlateDistance", () => {
    expect(derive(source({ distanceM: 87 })).distanceText).toBe("87 m");
    expect(derive(source({ distanceM: 410 })).distanceText).toBe("");
  });
});

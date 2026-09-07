import { describe, expect, it } from "vitest";
import { COVER_CORRIDOR } from "./briefs";
import type { HoleBrief } from "./briefs";
import { DRIVER_CARRY_M, REFERENCE_CARRY_M, defaultGreen } from "./course";
import type { Vec2 } from "./course";
import { pointInEllipse, pointInPolygon } from "./hazards";
import { corridorFor, placeBunkers, placeWater } from "./placement";
import type { Routing } from "./placement";
import { mulberry32 } from "./rng";
import { BLEND_WIDTH, WOODS_WEIGHT, inverseSmoothstep01 } from "./terrain";
import { createSpline } from "./spline";

/**
 * A straight par 4 running due east, 150 m tee to cup in a 220 m field.
 *
 * Straight and axis-aligned on purpose: "left of the line" is then just "+z or -z", so a test can
 * state where a bunker should be without reimplementing the normal maths it is checking.
 */
function routing(overrides: Partial<Routing> = {}): Routing {
  const tee: Vec2 = { x: -75, z: 0 };
  const cup: Vec2 = { x: 75, z: 0 };
  const control = [tee, { x: 0, z: 0 }, cup];
  return {
    spline: createSpline(control),
    tee,
    cup,
    fieldSize: 220,
    corridor: [15, 15, 15],
    green: defaultGreen(cup),
    water: [],
    ...overrides,
  };
}

/** A dog-leg whose apex bulges to the left (+z) of the tee-to-cup line. */
function doglegRouting(): Routing {
  const tee: Vec2 = { x: -75, z: 0 };
  const cup: Vec2 = { x: 75, z: 0 };
  const control = [tee, { x: 0, z: 40 }, cup];
  return {
    spline: createSpline(control),
    tee,
    cup,
    fieldSize: 220,
    corridor: [15, 15, 15],
    green: defaultGreen(cup),
    water: [],
  };
}

function brief(overrides: Partial<HoleBrief> = {}): HoleBrief {
  return {
    number: 1,
    parTarget: 4,
    archetype: "straightaway",
    dogleg: { dir: "none", severity: 0 },
    biome: "parkland",
    corridor: COVER_CORRIDOR.moderate,
    cover: "moderate",
    hazards: { bunkers: { count: 0, placement: [] }, water: null },
    signature: false,
    note: "",
    ...overrides,
  };
}

const rng = () => mulberry32(0xc0ffee);

/** Signed offset from the straight tee-to-cup line: positive is left (+z) on these fixtures. */
function sideOf(p: { x: number; z: number }): number {
  return p.z;
}

describe("corridorFor", () => {
  it("spreads the brief's three half-widths over the control points", () => {
    expect(corridorFor(brief({ corridor: COVER_CORRIDOR.dense }), 3)).toEqual([11, 10, 12]);
  });

  it("keeps the tee and green values at the ends however many control points there are", () => {
    const widths = corridorFor(brief({ corridor: COVER_CORRIDOR.open }), 5);
    expect(widths).toHaveLength(5);
    expect(widths[0]).toBe(19);
    expect(widths[widths.length - 1]).toBe(19);
    expect(widths.slice(1, -1).every((w) => w === 18)).toBe(true);
  });
});

describe("placeBunkers", () => {
  it("places exactly as many bunkers as the brief declares", () => {
    const b = brief({
      hazards: {
        bunkers: { count: 3, placement: ["carry", "greenside-left", "greenside-right"] },
        water: null,
      },
    });
    expect(placeBunkers(b, routing(), rng())).toHaveLength(3);
  });

  it("puts a greenside-left bunker left of the line and beside the green", () => {
    const b = brief({
      hazards: { bunkers: { count: 1, placement: ["greenside-left"] }, water: null },
    });
    const [bunker] = placeBunkers(b, routing(), rng());
    expect(sideOf(bunker!)).toBeGreaterThan(0);
    expect(Math.hypot(bunker!.x - 75, bunker!.z)).toBeLessThan(30);
  });

  it("puts a greenside-right bunker on the opposite side of the same green", () => {
    const left = placeBunkers(
      brief({ hazards: { bunkers: { count: 1, placement: ["greenside-left"] }, water: null } }),
      routing(),
      rng(),
    )[0]!;
    const right = placeBunkers(
      brief({ hazards: { bunkers: { count: 1, placement: ["greenside-right"] }, water: null } }),
      routing(),
      rng(),
    )[0]!;
    expect(sideOf(right)).toBeLessThan(0);
    expect(Math.sign(sideOf(left))).not.toBe(Math.sign(sideOf(right)));
  });

  it("puts a landing-zone bunker where a drive finishes, not at the tee or the green", () => {
    const b = brief({
      hazards: { bunkers: { count: 1, placement: ["landing-zone"] }, water: null },
    });
    const [bunker] = placeBunkers(b, routing(), rng());
    // The corridor is straight and 150 m long, so distance from the tee along it is just dx.
    const along = bunker!.x - -75;
    expect(along).toBeGreaterThan(REFERENCE_CARRY_M - 35);
    expect(along).toBeLessThan(REFERENCE_CARRY_M + 35);
  });

  it("puts a carry bunker short of where a drive finishes", () => {
    const carry = placeBunkers(
      brief({ hazards: { bunkers: { count: 1, placement: ["carry"] }, water: null } }),
      routing(),
      rng(),
    )[0]!;
    const landing = placeBunkers(
      brief({ hazards: { bunkers: { count: 1, placement: ["landing-zone"] }, water: null } }),
      routing(),
      rng(),
    )[0]!;
    expect(carry.x).toBeLessThan(landing.x);
  });

  it("puts a fairway-elbow bunker on the inside of the turn", () => {
    // The apex bulges to +z, so the corner a player would cut -- and the bunker that prices
    // cutting it -- is on the -z side. Placing it outside the turn guards nothing.
    const b = brief({
      dogleg: { dir: "left", severity: 0.6 },
      archetype: "dogleg",
      hazards: { bunkers: { count: 1, placement: ["fairway-elbow"] }, water: null },
    });
    const r = doglegRouting();
    const [bunker] = placeBunkers(b, r, rng());

    // Stated against the centreline rather than a fixed z. The apex sits at z=40, so "inside the
    // turn" means between the straight tee-to-cup line and the curve -- which is a different
    // number at every t, and a hard-coded threshold only ever encodes one particular offset.
    const at = r.spline.nearest(bunker!.x, bunker!.z);
    const onLine = r.spline.pointAt(at.t);
    expect(sideOf(bunker!)).toBeLessThan(sideOf(onLine));
    expect(sideOf(bunker!)).toBeGreaterThan(0);
  });

  it("never puts a bunker on the cup", () => {
    const every: HoleBrief = brief({
      hazards: {
        bunkers: {
          count: 5,
          placement: [
            "greenside-left",
            "greenside-right",
            "fairway-elbow",
            "landing-zone",
            "carry",
          ],
        },
        water: null,
      },
    });
    const r = routing();
    for (const bunker of placeBunkers(every, r, rng())) {
      expect(pointInEllipse(r.cup.x, r.cup.z, bunker)).toBe(false);
    }
  });

  it("keeps every bunker inside the field", () => {
    const every = brief({
      hazards: {
        bunkers: {
          count: 5,
          placement: [
            "greenside-left",
            "greenside-right",
            "fairway-elbow",
            "landing-zone",
            "carry",
          ],
        },
        water: null,
      },
    });
    const r = routing();
    const limit = r.fieldSize / 2;
    for (const b of placeBunkers(every, r, rng())) {
      expect(Math.abs(b.x) + Math.max(b.radiusX, b.radiusZ)).toBeLessThan(limit);
      expect(Math.abs(b.z) + Math.max(b.radiusX, b.radiusZ)).toBeLessThan(limit);
    }
  });

  it("keeps every bunker's far rim inside the tree line", () => {
    // The unit-level half of course.test.ts's "never puts sand in the woods". Stated as a
    // distance here because that is what placement controls; stated as a corridor weight there
    // because that is what a player sees.
    const every = brief({
      hazards: {
        bunkers: {
          count: 5,
          placement: [
            "greenside-left",
            "greenside-right",
            "fairway-elbow",
            "landing-zone",
            "carry",
          ],
        },
        water: null,
      },
    });
    for (let seed = 1; seed <= 30; seed += 1) {
      const r = routing();
      for (const b of placeBunkers(every, r, mulberry32(seed))) {
        const near = r.spline.nearest(b.x, b.z);
        const half = r.corridor[0]!;
        const woods = half + BLEND_WIDTH * inverseSmoothstep01(WOODS_WEIGHT);
        expect(near.distance + b.radiusZ, `seed ${seed}`).toBeLessThanOrEqual(woods);
      }
    }
  });

  it("is deterministic for a seed and differs between seeds", () => {
    const b = brief({
      hazards: { bunkers: { count: 2, placement: ["landing-zone", "carry"] }, water: null },
    });
    const r = routing();
    expect(placeBunkers(b, r, mulberry32(7))).toEqual(placeBunkers(b, r, mulberry32(7)));
    expect(placeBunkers(b, r, mulberry32(7))).not.toEqual(placeBunkers(b, r, mulberry32(8)));
  });

  it("places nothing when the brief asks for nothing", () => {
    expect(placeBunkers(brief(), routing(), rng())).toEqual([]);
  });
});

/** True if any centreline sample lies inside one of the polygons. */
function centrelineCrosses(r: Routing, polys: readonly { points: readonly Vec2[] }[]): boolean {
  for (let t = 0; t <= 1; t += 0.002) {
    const p = r.spline.pointAt(t);
    if (polys.some((poly) => pointInPolygon(p.x, p.z, poly))) return true;
  }
  return false;
}

describe("placeWater", () => {
  it("places nothing when the brief asks for nothing", () => {
    expect(placeWater(brief(), routing(), rng())).toEqual([]);
  });

  it("puts a crossing across the line of play", () => {
    const b = brief({
      archetype: "forced-carry",
      hazards: { bunkers: { count: 0, placement: [] }, water: { form: "crossing" } },
    });
    const r = routing();
    expect(centrelineCrosses(r, placeWater(b, r, rng()))).toBe(true);
  });

  it("keeps a crossing inside the driver's carry, so the hole is playable", () => {
    // The constraint that makes holes 2 and 15 buildable rather than merely legal-looking:
    // validateHole check 6 rejects a wet run longer than this, so placement must not create one.
    const b = brief({
      archetype: "forced-carry",
      hazards: { bunkers: { count: 0, placement: [] }, water: { form: "crossing" } },
    });
    for (let seed = 1; seed <= 40; seed += 1) {
      const r = routing();
      const polys = placeWater(b, r, mulberry32(seed));
      let wet = 0;
      let previous = r.spline.pointAt(0);
      for (let t = 0.002; t <= 1; t += 0.002) {
        const p = r.spline.pointAt(t);
        if (polys.some((poly) => pointInPolygon(p.x, p.z, poly))) {
          wet += Math.hypot(p.x - previous.x, p.z - previous.z);
        }
        previous = p;
      }
      expect(wet, `seed ${seed}`).toBeLessThan(DRIVER_CARRY_M);
      expect(wet, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it("puts lateral water beside the line rather than across it", () => {
    const b = brief({
      hazards: { bunkers: { count: 0, placement: [] }, water: { form: "lateral-right" } },
    });
    const r = routing();
    const polys = placeWater(b, r, rng());
    expect(polys.length).toBeGreaterThan(0);
    expect(centrelineCrosses(r, polys)).toBe(false);
  });

  it("puts lateral-right water on the right and lateral-left on the left", () => {
    const r = routing();
    const right = placeWater(
      brief({
        hazards: { bunkers: { count: 0, placement: [] }, water: { form: "lateral-right" } },
      }),
      r,
      rng(),
    );
    const left = placeWater(
      brief({ hazards: { bunkers: { count: 0, placement: [] }, water: { form: "lateral-left" } } }),
      r,
      rng(),
    );
    const meanZ = (polys: readonly { points: readonly Vec2[] }[]) => {
      const pts = polys.flatMap((p) => [...p.points]);
      return pts.reduce((a, p) => a + p.z, 0) / pts.length;
    };
    expect(meanZ(left)).toBeGreaterThan(0);
    expect(meanZ(right)).toBeLessThan(0);
  });

  it("rings an island green with water while leaving the cup itself dry ground", () => {
    const b = brief({
      parTarget: 3,
      archetype: "island-green",
      hazards: { bunkers: { count: 0, placement: [] }, water: { form: "island" } },
    });
    const r = routing();
    const polys = placeWater(b, r, rng());

    // A ring just outside the green is wet all the way round -- that is what "no bail-out" means.
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const x = r.cup.x + Math.cos(a) * 16;
      const z = r.cup.z + Math.sin(a) * 16;
      expect(polys.some((poly) => pointInPolygon(x, z, poly)), `angle ${a.toFixed(2)}`).toBe(true);
    }
  });

  it("keeps every water polygon inside the field", () => {
    const forms = ["crossing", "lateral-left", "lateral-right", "inside-elbow", "island"] as const;
    for (const form of forms) {
      const r = doglegRouting();
      const polys = placeWater(
        brief({ hazards: { bunkers: { count: 0, placement: [] }, water: { form } } }),
        r,
        rng(),
      );
      const limit = r.fieldSize / 2;
      for (const poly of polys) {
        for (const p of poly.points) {
          expect(Math.abs(p.x), `${form} x`).toBeLessThanOrEqual(limit);
          expect(Math.abs(p.z), `${form} z`).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it("never drowns the tee, and never drowns the cup except by design", () => {
    const forms = ["crossing", "lateral-left", "lateral-right", "inside-elbow", "island"] as const;
    for (const form of forms) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const r = doglegRouting();
        const polys = placeWater(
          brief({ hazards: { bunkers: { count: 0, placement: [] }, water: { form } } }),
          r,
          mulberry32(seed),
        );
        expect(polys.some((p) => pointInPolygon(r.tee.x, r.tee.z, p)), `${form} tee`).toBe(false);

        // The island is the deliberate exception, and the reason `isWaterAt` exists. Polygons
        // here have no holes, so the moat is drawn solid *through* the cup and the green is
        // punched back out of it by classification order. Geometrically the cup is inside the
        // polygon; as a surface it is green. A validator that tested the raw polygon would
        // reject hole 13 -- see `isWaterAt` in course.ts.
        const drowned = polys.some((p) => pointInPolygon(r.cup.x, r.cup.z, p));
        expect(drowned, `${form} cup`).toBe(form === "island");
      }
    }
  });
});

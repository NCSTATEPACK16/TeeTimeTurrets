import { describe, expect, it } from "vitest";
import { AUTHORED_HOLES, authoredCourse } from "./authoredCourse";
import { briefForHole } from "./briefs";
import { isWaterAt, pointInEllipse, pointInPolygon } from "./hazards";
import { createSpline } from "./spline";
import { toYards } from "./units";

/** The card, restated here on purpose: a test that read it from the module under test would agree
 *  with any typo. These eighteen numbers came off the scorecard by hand. */
const CARD: readonly { par: number; yards: number }[] = [
  { par: 5, yards: 508 }, { par: 4, yards: 381 }, { par: 4, yards: 381 },
  { par: 3, yards: 180 }, { par: 4, yards: 342 }, { par: 3, yards: 171 },
  { par: 4, yards: 393 }, { par: 5, yards: 458 }, { par: 4, yards: 405 },
  { par: 3, yards: 178 }, { par: 4, yards: 320 }, { par: 4, yards: 368 },
  { par: 4, yards: 322 }, { par: 5, yards: 450 }, { par: 4, yards: 380 },
  { par: 4, yards: 371 }, { par: 3, yards: 147 }, { par: 5, yards: 460 },
];

describe("the authored card", () => {
  it("has eighteen holes in order", () => {
    expect(AUTHORED_HOLES).toHaveLength(18);
    expect(AUTHORED_HOLES.map((h) => h.index)).toEqual([...Array(18).keys()]);
  });

  it("matches the scorecard hole for hole", () => {
    for (let i = 0; i < 18; i++) {
      expect(AUTHORED_HOLES[i]!.par, `hole ${i + 1} par`).toBe(CARD[i]!.par);
      expect(AUTHORED_HOLES[i]!.whiteYards, `hole ${i + 1} yardage`).toBe(CARD[i]!.yards);
    }
  });

  it("totals par 72 and 6,215 yards, nine by nine", () => {
    const sum = (from: number, to: number, pick: (h: (typeof AUTHORED_HOLES)[number]) => number) =>
      AUTHORED_HOLES.slice(from, to).reduce((a, h) => a + pick(h), 0);

    expect(sum(0, 9, (h) => h.par)).toBe(36);
    expect(sum(9, 18, (h) => h.par)).toBe(36);
    expect(sum(0, 18, (h) => h.par)).toBe(72);
    expect(sum(0, 9, (h) => h.whiteYards)).toBe(3219);
    expect(sum(9, 18, (h) => h.whiteYards)).toBe(2996);
    expect(sum(0, 18, (h) => h.whiteYards)).toBe(6215);
  });

  it("builds a corridor whose arc length is the yardage on the card", () => {
    // The assertion that catches a control point traced into the wrong place. A dog-leg's played
    // route is longer than its tee-to-cup line, so this measures the SPLINE, not the straight
    // line -- comparing tee to cup would pass on a hole bent the wrong way by fifty yards.
    for (const hole of AUTHORED_HOLES) {
      const spline = createSpline(hole.control);
      const yards = toYards(spline.length);
      expect(yards, `hole ${hole.index + 1} played length`).toBeCloseTo(hole.whiteYards, -0.7);
    }
  });

  it("starts each corridor at the tee and finishes it at the cup", () => {
    for (const hole of AUTHORED_HOLES) {
      const first = hole.control[0]!;
      const last = hole.control[hole.control.length - 1]!;
      expect(first, `hole ${hole.index + 1} first control`).toEqual(hole.tee);
      expect(last, `hole ${hole.index + 1} last control`).toEqual(hole.cup);
    }
  });

  it("produces a Course whose specs carry the authored geometry", () => {
    const course = authoredCourse(2026);
    expect(course.holes).toHaveLength(18);
    for (let i = 0; i < 18; i++) {
      expect(course.holes[i]!.par).toBe(CARD[i]!.par);
      expect(course.holes[i]!.control).toEqual(AUTHORED_HOLES[i]!.control);
    }
  });

  it("is still reproducible from a seed below the routing", () => {
    // The routing is authored; the terrain, greens and bunkers under it are not. Same seed, same
    // course; different seed, same routing and different detail.
    const a = authoredCourse(2026);
    const b = authoredCourse(2026);
    const c = authoredCourse(2027);
    expect(a.holes.map((h) => h.green)).toEqual(b.holes.map((h) => h.green));
    expect(a.holes.map((h) => h.control)).toEqual(c.holes.map((h) => h.control));
    expect(a.holes.map((h) => h.bunkers)).not.toEqual(c.holes.map((h) => h.bunkers));
  });

  it("never leaves a cup inside a water polygon", () => {
    /**
     * The repository owner's added requirement: "Goal is to make the course playable and we
     * cannot have a hole in the water." The previous routing put hole 17's cup inside hole 9's
     * pond, which broke `courseWorld.test.ts`'s "puts green under every cup".
     *
     * **Point-in-polygon, not `isWaterAt`.** `isWaterAt` returns false at every cup by
     * construction -- the green is centred on the cup and green beats water in that function --
     * so asserting through it would be an assertion nothing could ever fail. This asks the
     * geometry directly.
     *
     * **Scope, stated honestly.** Water polygons live in each hole's own local frame, and there
     * is no course frame to compare them in until Task 3 authors the placements. So this checks
     * every cup against *its own* hole's water. The cross-hole check -- the one that would have
     * caught hole 17 in hole 9's pond -- belongs to Task 3, where the offsets exist.
     */
    const course = authoredCourse(2026);
    let polygonsChecked = 0;
    let holesChecked = 0;
    let islandGreens = 0;

    for (const hole of course.holes) {
      const brief = briefForHole((hole.index % 18) + 1);
      const wantsWater = brief.hazards.water !== null;
      // Guard the guard: a loop over an empty list satisfies every assertion inside it, so prove
      // the hazards the briefs ask for were actually placed before trusting what this reports.
      expect(hole.water.length > 0, `hole ${hole.index + 1} water placed`).toBe(wantsWater);

      if (brief.hazards.water?.form === "island") {
        // The one archetype whose polygon is *meant* to contain the cup: `placeWater` draws the
        // island solid and the green is punched back out of it by classification order. Assert
        // that punch-out rather than skipping the hole, so an island green that stopped having a
        // green under its cup fails here instead of going quiet.
        expect(
          pointInEllipse(hole.cup.x, hole.cup.z, hole.green),
          `hole ${hole.index + 1} green under its cup`,
        ).toBe(true);
        expect(
          isWaterAt(hole, hole.cup.x, hole.cup.z),
          `hole ${hole.index + 1} cup plays wet`,
        ).toBe(false);
        islandGreens += 1;
        continue;
      }

      for (const poly of hole.water) {
        expect(
          pointInPolygon(hole.cup.x, hole.cup.z, poly),
          `hole ${hole.index + 1} cup inside its own water`,
        ).toBe(false);
        polygonsChecked += 1;
      }
      holesChecked += 1;
    }

    expect(holesChecked).toBe(17);
    expect(islandGreens).toBe(1);
    expect(polygonsChecked).toBeGreaterThan(0);
  });
});

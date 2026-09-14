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

  it("gives every brief the dog-leg its own control points actually have", () => {
    /**
     * The cross-check that was missing, and its absence is how `briefs.ts` came to describe
     * eighteen holes this course does not have.
     *
     * A brief says a hole bends left; the control points say it bends right; nothing compared them,
     * so both were "correct" in isolation for as long as anybody looked. The two are written in
     * different files by different hands and neither is derived from the other, which is exactly
     * the pairing `TEST-AND-SPEC-PITFALLS.md` says to assert rather than assume.
     *
     * `+z` on a middle control point is left of the line of play (`authoredCourse.ts`), so the sign
     * of the apex offset is the dog-leg direction and its magnitude over the half-length is the
     * severity the brief should be carrying.
     */
    for (const hole of AUTHORED_HOLES) {
      const brief = briefForHole(hole.index + 1);
      const apex = hole.control[1]!.z;
      const expected = apex === 0 ? "none" : apex > 0 ? "left" : "right";
      expect(brief.dogleg.dir, `hole ${hole.index + 1} bend`).toBe(expected);

      // Severity is authored as four times the apex offset taken as a fraction of the half-length,
      // which spreads the eighteen traced bends across 0.24..0.80 rather than compressing them into
      // the bottom fifth of the range. Checked to two decimals: the point is that a hand-edit to one
      // side is caught, not that the mapping is exact to floating point.
      const severity = (Math.abs(apex) / hole.cup.x) * 4;
      expect(brief.dogleg.severity, `hole ${hole.index + 1} severity`).toBeCloseTo(severity, 2);
    }
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
     * **Scope, stated honestly.** Water polygons live in each hole's own local frame, so this
     * checks every cup against *its own* hole's water. The cross-hole half -- the one that would
     * have caught hole 17 in hole 9's pond -- needs the placements, and lives in
     * `authoredLayout.test.ts` as "never leaves a cup inside another hole's water polygon".
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
        //
        // **No hole reaches this branch today** -- see the islandGreens assertion below. It is kept
        // rather than deleted because the archetype is still in the vocabulary, and a brief that
        // adopts it needs this exemption or the point-in-polygon check below fails it wrongly.
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

    // All eighteen go through the point-in-polygon check, because the authored course has no island
    // green: the plat shows water on 4, 12, 13, 15, 16 and 18, and none of them puts the green
    // inside it. The previous card had one at hole 13, where the real card prints a 322-yard par 4.
    expect(holesChecked).toBe(18);
    expect(islandGreens).toBe(0);
    expect(polygonsChecked).toBeGreaterThan(0);

    // The water sits where the plat puts it, asserted against a list written here rather than read
    // back out of `briefs.ts` -- which is the whole reason this file restates the card too.
    const wet = course.holes.filter((h) => h.water.length > 0).map((h) => h.index + 1);
    expect(wet).toEqual([4, 12, 13, 15, 16, 18]);
  });
});

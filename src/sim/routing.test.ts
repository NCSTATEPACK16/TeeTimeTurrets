import { describe, expect, it } from "vitest";
import { briefForHole } from "./briefs";
import type { DoglegDir } from "./briefs";
import { DOGLEG_MAX_TURN, generateCourse } from "./course";
import type { HoleSpec, Vec2 } from "./course";

/**
 * The centreline against the brief that asked for it.
 *
 * These exist because the generator ignored the brief's shape entirely and nothing noticed. It
 * drew a bearing, took the straight run the box allowed, and then solved the apex offset
 * *backwards* out of the length residual -- so the bend's existence, direction and size were all
 * accidents of how the box happened to clip the corridor length. Seven of the eight straightaways
 * bent (hole 11 by 116 m), three of the four doglegs bent the wrong way, and hole 7 -- a signature
 * cape at severity 0.8 -- came out dead straight.
 *
 * Every assertion below is on `spec.control`, which is what `createSpline` consumes and therefore
 * what the ball, the corridor, the hazards and the renderer all ultimately read. Asserting on the
 * brief-to-control mapping is asserting on the thing the game actually plays.
 */

const COURSE_SEED = 2026;
const HOLES = generateCourse(COURSE_SEED, 18).holes;

/**
 * A control point's signed distance from the tee-to-cup line, positive to the left of the line
 * of play.
 *
 * The sign convention is `bulgeSide`'s in `placement.ts` -- the cross product of tee->cup with
 * tee->point -- and it has to stay that one. A hazard placed on "the inside of the turn" and a
 * centreline that turns the other way would put every fairway-elbow bunker on the outside of its
 * own dog-leg, which is a hazard nobody has to think about.
 */
function lateralOffset(spec: HoleSpec, point: Vec2): number {
  const dx = spec.cup.x - spec.tee.x;
  const dz = spec.cup.z - spec.tee.z;
  const length = Math.hypot(dx, dz);
  const mx = point.x - (spec.tee.x + spec.cup.x) / 2;
  const mz = point.z - (spec.tee.z + spec.cup.z) / 2;
  return (dx * mz - dz * mx) / length;
}

/** The interior control points -- the bends. Tee and cup are endpoints, never bends. */
function bends(spec: HoleSpec): number[] {
  return spec.control.slice(1, -1).map((point) => lateralOffset(spec, point));
}

/** `left` is positive, matching `lateralOffset` and `bulgeSide`. */
function sideOf(dir: DoglegDir): number {
  return dir === "right" ? -1 : 1;
}

describe("the centreline follows the brief that asked for it", () => {
  it("leaves a hole straight when the brief asks for no dog-leg", () => {
    const straight = HOLES.map((spec, i) => ({ spec, brief: briefForHole(i + 1) })).filter(
      ({ brief }) => brief.dogleg.dir === "none",
    );
    expect(straight.length).toBeGreaterThan(0);

    for (const { spec, brief } of straight) {
      for (const offset of bends(spec)) {
        expect(offset, `hole ${brief.number} (${brief.archetype})`).toBeCloseTo(0, 6);
      }
    }
  });

  it("turns a dog-leg the way the brief says", () => {
    const doglegs = HOLES.map((spec, i) => ({ spec, brief: briefForHole(i + 1) })).filter(
      ({ brief }) => brief.dogleg.dir === "left" || brief.dogleg.dir === "right",
    );
    expect(doglegs.length).toBeGreaterThan(0);

    for (const { spec, brief } of doglegs) {
      const offset = bends(spec)[0]!;
      expect(
        Math.sign(offset),
        `hole ${brief.number} asks to turn ${brief.dogleg.dir}`,
      ).toBe(sideOf(brief.dogleg.dir));
    }
  });

  /**
   * The mapping itself, not merely its monotonicity. `severity` sets the angle each leg of the
   * routing makes with the tee-to-cup line, so `asin(offset / legLength)` recovers it exactly --
   * and a test that only checked "more severity, more bend" would pass on any increasing
   * function, including one that bends a 0.4 hole by 3 m.
   */
  it("bends a dog-leg by the angle its severity asks for", () => {
    const doglegs = HOLES.map((spec, i) => ({ spec, brief: briefForHole(i + 1) })).filter(
      ({ brief }) => brief.dogleg.dir === "left" || brief.dogleg.dir === "right",
    );

    for (const { spec, brief } of doglegs) {
      const apex = spec.control[1]!;
      const legLength = Math.hypot(apex.x - spec.tee.x, apex.z - spec.tee.z);
      const turn = Math.asin(Math.abs(bends(spec)[0]!) / legLength);
      expect(turn, `hole ${brief.number} at severity ${brief.dogleg.severity}`).toBeCloseTo(
        brief.dogleg.severity * DOGLEG_MAX_TURN,
        6,
      );
    }
  });

  /**
   * **No brief asks for an s-curve any more, and that is a fact worth asserting rather than a gap
   * worth leaving quiet.**
   *
   * Until 13 September 2026 holes 4 and 18 were double-doglegs, and two tests here checked that the
   * drafter gave them four control points with the bends going opposite ways. The briefs are now a
   * tracing of a real routing (`authoredCourse.ts`), every hole of which has a single apex, so
   * neither test had anything to run against: the first failed loudly and **the second passed
   * vacuously**, its loop finding nothing and asserting nothing.
   *
   * So the s-curve branch of `draftHole` is live code with no brief exercising it. This assertion
   * is what makes that visible: add an s-curve to any brief and it fails, which is the signal to
   * restore the two tests that were here. It is not a substitute for them.
   */
  it("has no brief asking for an s-curve, so the drafter's s-curve branch is unexercised", () => {
    const sCurves = HOLES.map((_, i) => briefForHole(i + 1))
      .filter((brief) => brief.dogleg.dir === "s-curve")
      .map((brief) => brief.number);
    expect(sCurves).toEqual([]);

    // Guard the guard: prove the filter can see a direction at all, so this cannot pass because
    // `dogleg.dir` arrived undefined on every hole.
    const named = HOLES.map((_, i) => briefForHole(i + 1)).filter((b) => b.dogleg.dir !== "none");
    expect(named.length).toBeGreaterThan(0);
  });

  /**
   * A property that held by luck before this change and must not stop holding because of it.
   *
   * `par` is never authored: `generateHole` derives it from the length of the spline the layout
   * actually produced, and `intendedPar` picks only the field size. Nothing checks the result
   * against the brief's `parTarget` -- it matched on all eighteen holes purely because
   * `DRAFT_BAND` happens to map each band onto the right par. Reshaping the centreline moves
   * spline lengths, so this is the check that catches a routing change quietly turning a par 4
   * into a par 5.
   */
  it("still derives the par the brief asked for, on every hole", () => {
    for (const [i, spec] of HOLES.entries()) {
      const brief = briefForHole(i + 1);
      expect(spec.par, `hole ${brief.number}`).toBe(brief.parTarget);
    }
  });
});

import { describe, expect, it } from "vitest";
import { COURSE_BRIEFS, COVER_CORRIDOR, briefForHole } from "./briefs";
import type { HoleBrief } from "./briefs";
import {
  CORRIDOR_BAND,
  EDGE_MARGIN,
  FIELD_FOR_PAR,
  biomeForIndex,
  parForIndex,
} from "./course";
// From terrain, not course: course.ts imports BLEND_WIDTH but does not re-export it, and vitest
// transpiles without type-checking. Importing it from the wrong module gives `undefined`, which
// makes `half` NaN and every `NaN < min` comparison false -- so the room check below would pass
// on any input at all. Found by deliberately breaking a brief and watching it not fail.
import { BLEND_WIDTH } from "./terrain";

/**
 * These briefs are eighteen hand-typed literals transcribed from a table in a markdown file, and
 * a test that reads a field back out of the same literal proves nothing -- the failure mode
 * docs/TEST-AND-SPEC-PITFALLS.md exists to catch.
 *
 * So every assertion here checks the briefs against something that was written independently:
 * the shipped `PAR_MIX` and `BIOME_ROUTING` in course.ts, the design rules stated in
 * docs/COURSE_PIPELINE.md section 4, or the geometry the generator actually has room for. A typo
 * in a brief fails one of these; a typo copied identically into both places is the only thing
 * that gets through, and there is no second place to copy it into.
 */

describe("the course bible as data", () => {
  it("is eighteen holes numbered 1..18 in order", () => {
    expect(COURSE_BRIEFS).toHaveLength(18);
    expect(COURSE_BRIEFS.map((b) => b.number)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
  });

  it("matches the shipped par card hole for hole", () => {
    // Against PAR_MIX in course.ts, not against a second copy of the card. If a brief's
    // parTarget and the generator's par disagree, every plan for that hole is mis-parred.
    const mismatched = COURSE_BRIEFS.filter(
      (b) => b.parTarget !== parForIndex(b.number - 1),
    ).map((b) => `hole ${b.number}: brief ${b.parTarget}, card ${parForIndex(b.number - 1)}`);
    expect(mismatched).toEqual([]);
  });

  it("sums to par 72, 36 out and 36 in", () => {
    const par = COURSE_BRIEFS.map((b) => b.parTarget);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(par.slice(0, 9))).toBe(36);
    expect(sum(par.slice(9))).toBe(36);
  });

  it("matches the shipped biome routing hole for hole", () => {
    const mismatched = COURSE_BRIEFS.filter(
      (b) => b.biome !== biomeForIndex(b.number - 1),
    ).map((b) => `hole ${b.number}: brief ${b.biome}, routing ${biomeForIndex(b.number - 1)}`);
    expect(mismatched).toEqual([]);
  });

  it("names exactly holes 7, 13 and 18 as signature", () => {
    // Section 4 design rule 4. Three holes carry the round's memory and absorb the expensive
    // features so the other fifteen can be honest and cheap. A fourth is a budget problem.
    expect(COURSE_BRIEFS.filter((b) => b.signature).map((b) => b.number)).toEqual([7, 13, 18]);
  });

  it("gives no two adjacent holes the same dogleg direction", () => {
    // Section 4 design rule 1, and the reason it exists: the generator flips a coin per hole
    // (`random() < 0.5 ? -1 : 1` in draftHole), so a run of four same-way doglegs has probability
    // 1/16 in any given window and is likely to appear at least once across 18 holes.
    //
    // `none` is exempt -- most holes are straight, and two straight holes in a row is not the
    // repetition this rule is about.
    const clashes: string[] = [];
    for (let i = 1; i < COURSE_BRIEFS.length; i += 1) {
      const prev = COURSE_BRIEFS[i - 1]!;
      const here = COURSE_BRIEFS[i]!;
      if (here.dogleg.dir !== "none" && here.dogleg.dir === prev.dogleg.dir) {
        clashes.push(`holes ${prev.number} and ${here.number} are both ${here.dogleg.dir}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("gives a severity of zero exactly to the straight holes", () => {
    const wrong = COURSE_BRIEFS.filter(
      (b) => (b.dogleg.dir === "none") !== (b.dogleg.severity === 0),
    ).map((b) => `hole ${b.number}: ${b.dogleg.dir} at severity ${b.dogleg.severity}`);
    expect(wrong).toEqual([]);
    expect(COURSE_BRIEFS.every((b) => b.dogleg.severity >= 0 && b.dogleg.severity <= 1)).toBe(true);
  });

  it("declares a bunker count that matches the placements listed", () => {
    // Catches the transcription slip where a count says 2 and one placement was typed.
    const wrong = COURSE_BRIEFS.filter(
      (b) => b.hazards.bunkers.count !== b.hazards.bunkers.placement.length,
    ).map(
      (b) =>
        `hole ${b.number}: count ${b.hazards.bunkers.count}, ` +
        `${b.hazards.bunkers.placement.length} placements`,
    );
    expect(wrong).toEqual([]);
  });

  it("derives every corridor from the cover setting rather than authoring widths per hole", () => {
    // The widths are a function of the combat axis, not eighteen independent judgement calls.
    // A hand-tuned width on one hole is the thing this catches.
    const offTable = COURSE_BRIEFS.filter(
      (b) => b.corridor !== COVER_CORRIDOR[b.cover],
    ).map((b) => `hole ${b.number} (${b.cover})`);
    expect(offTable).toEqual([]);
  });

  it("keeps `moderate` on the corridor half-width the game currently ships", () => {
    // The reviewable property when Tier 2 lands: the eleven moderate holes must come out
    // byte-identical to today, so a change touching all 18 can be read one hole at a time.
    // HALF_WIDTH is 15 in terrain.ts. Deliberately restated as a literal here -- importing it
    // would make this assertion true by construction and it would stop checking anything.
    expect(COVER_CORRIDOR.moderate.start).toBe(15);
    expect(COVER_CORRIDOR.moderate.end).toBe(15);
  });

  it("narrows through the middle on every cover setting", () => {
    for (const [cover, c] of Object.entries(COVER_CORRIDOR)) {
      expect(c.mid, `${cover} should pinch at the landing zone`).toBeLessThan(c.start);
    }
  });

  it("leaves every hole enough room to reach its par band", () => {
    // The one assertion here that can fail on plausible numbers rather than only on a typo.
    //
    // `draftHole` builds a hole inside a box of half-extent
    //   half = fieldSize / 2 - (corridorHalfWidth + BLEND_WIDTH) - EDGE_MARGIN
    // and spends at most STRAIGHT_FILL of it on the run and APEX_FILL on the dog-leg apex, so the
    // longest corridor it can draw on the worst-case (axis-aligned) bearing is
    //   2 * hypot(half * 0.92, half * 0.85).
    // Widening the corridor eats the box, so an over-generous `cover` setting can make a hole
    // unbuildable at its own par -- silently, as an exhausted sampler thirty-two attempts later.
    const STRAIGHT_FILL = 0.92;
    const APEX_FILL = 0.85;

    const longestFor = (b: HoleBrief) => {
      const widest = Math.max(b.corridor.start, b.corridor.mid, b.corridor.end);
      const half = FIELD_FOR_PAR[b.parTarget]! / 2 - (widest + BLEND_WIDTH) - EDGE_MARGIN;
      return 2 * Math.hypot(half * STRAIGHT_FILL, half * APEX_FILL);
    };

    // Guard the guard. A comparison against NaN is false, so a constant that arrives undefined
    // turns this whole check into a no-op that reports success -- which is how it behaved on
    // first writing. Assert the arithmetic produced numbers before trusting what it says.
    expect(COURSE_BRIEFS.every((b) => Number.isFinite(longestFor(b)))).toBe(true);

    const tooTight = COURSE_BRIEFS.filter((b) => longestFor(b) < CORRIDOR_BAND[b.parTarget]!.min)
      .map((b) => `hole ${b.number} (par ${b.parTarget}, ${b.cover})`);

    expect(tooTight).toEqual([]);
  });
});

describe("briefForHole", () => {
  it("indexes by scorecard number, not by array index", () => {
    expect(briefForHole(1).number).toBe(1);
    expect(briefForHole(18).number).toBe(18);
  });

  it("throws with the valid range rather than returning undefined", () => {
    expect(() => briefForHole(0)).toThrow(/1\.\.18/);
    expect(() => briefForHole(19)).toThrow(/1\.\.18/);
  });
});

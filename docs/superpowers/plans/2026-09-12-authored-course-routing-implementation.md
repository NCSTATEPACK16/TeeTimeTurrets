# Authored Course Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The eighteen holes are traced from a real plat map at their real White-tee yardages — par 72, 6,215 yards — with the clubhouse on the southern boundary, a barrier at the road, and every player-facing distance in yards.

**Architecture:** Hole centrelines, pars, yardages and placements become authored data. Everything below them stays seeded from `HoleSpec.seed` — terrain noise, greens, bunkers, trees, rough — so the course is still reproducible from one number. Lengths are authored in yards, converted once to metres at hole construction, and converted back at display. Two functions change hands: `generateCourse` gains an authored sibling, and `solveCourseLayout` is bypassed for the shipped course.

**Tech Stack:** TypeScript, Vitest (node environment for `src/sim/**`), Three.js, Rapier, Vite, Puppeteer (gate and smoke harnesses).

**Spec:** `docs/superpowers/specs/2026-09-12-authored-course-routing-design.md`

**Order:** land `2026-09-12-hazard-aware-ownership-tie-break-implementation.md` first — it is a rule fix, independent of layout. Land this **before** `2026-09-12-stage-d-pickups-implementation.md`; scattering pickups over a routing about to be replaced is verification thrown away.

## Global Constraints

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment.
- **Never `Math.random()` in `src/sim/**`.** Authored data replaces *drafting*, not seeding — terrain, greens, bunkers and trees keep their existing channels.
- **`YARD_M = 0.9144` exactly, defined once.** The simulation stays metric. Do not convert `topSpeed`, `CART_COLLIDER`, `COURSE_CELL_M`, `CLUBHOUSE_APRON_M`, any Blender dimension, any gate baseline or any probe control.
- **The authored card is the source of truth for length**, and the built corridor is checked against it. Neither is derived from the other.
- **A render check is never evidence about simulation.** The gate re-baselines wholesale here; its acceptance is a human review of whether the course looks like the plat.
- **`npm run plan` after every course change**, `npm run plan:course` after every layout change, `npm run probe:terrain` after any change to the assembly.
- Do **not** delete `courseLayout.ts`'s solver or `courseRelaxation.ts`. They come off the shipped path and stay in the tree, marked.

---

## The authored card

Par 72, 6,215 yards White. Front 3,219 / par 36. Back 2,996 / par 36.

| # | Par | White yd | # | Par | White yd |
|---|---|---|---|---|---|
| 1 | 5 | 508 | 10 | 3 | 178 |
| 2 | 4 | 381 | 11 | 4 | 320 |
| 3 | 4 | 381 | 12 | 4 | 368 |
| 4 | 3 | 180 | 13 | 4 | 322 |
| 5 | 4 | 342 | 14 | 5 | 450 |
| 6 | 3 | 171 | 15 | 4 | 380 |
| 7 | 4 | 393 | 16 | 4 | 371 |
| 8 | 5 | 458 | 17 | 3 | 147 |
| 9 | 4 | 405 | 18 | 5 | 460 |

---

## File Structure

**Created:**
- `src/sim/units.ts` — `YARD_M`, `toYards`, `toMetres`. Three exports, no state, no dependencies.
- `src/sim/units.test.ts`
- `src/sim/authoredCourse.ts` — the eighteen-hole card and routing, and `authoredCourse(seed): Course`.
- `src/sim/authoredCourse.test.ts`
- `src/sim/authoredLayout.ts` — `authoredCourseLayout(): CourseLayout`, returning authored placements and the clubhouse position.
- `src/sim/authoredLayout.test.ts`
- `src/sim/courseBarrier.ts` — the southern boundary wall's geometry, DOM-free and Rapier-free.
- `src/render/treeline.ts` — the horizon band beyond the road.

**Modified:**
- `src/sim/course.ts` — `CORRIDOR_BAND` and `FIELD_FOR_PAR` widened and re-purposed as validation bounds; `fieldSize` derived per hole.
- `src/sim/courseWorld.ts` — `buildCourseWorld` calls the authored layout.
- `src/sim/courseLayout.ts`, `src/sim/courseRelaxation.ts` — doc comments only, marking them off the shipped path.
- `src/sim/world.ts` — the cart barrier check.
- `src/render/props.ts` — `MARKER_DISTANCES_M` becomes yards converted at use.
- `src/ui/hudState.ts` — yardage display.
- `tools/gate-baseline/*` — regenerated wholesale.
- `docs/DECISIONS.md`, `docs/HANDOFF.md`, `docs/COURSE_PIPELINE.md`.

---

### Task 1: Yards at the boundary, metres in the middle

**Files:**
- Create: `src/sim/units.ts`, `src/sim/units.test.ts`
- Modify: `src/render/props.ts` (`MARKER_DISTANCES_M`), `src/ui/hudState.ts`

**Interfaces:**
- Produces: `YARD_M = 0.9144`, `toMetres(yards: number): number`, `toYards(metres: number): number`.

- [ ] **Step 1: Write the failing test**

Create `src/sim/units.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { YARD_M, toMetres, toYards } from "./units";

describe("yards and metres", () => {
  it("uses the exact international yard", () => {
    expect(YARD_M).toBe(0.9144);
  });

  it("converts the card's own numbers", () => {
    expect(toMetres(508)).toBeCloseTo(464.52, 2);
    expect(toMetres(147)).toBeCloseTo(134.42, 2);
    expect(toMetres(6215)).toBeCloseTo(5683.0, 1);
  });

  it("round-trips in both directions", () => {
    // A conversion applied twice, or applied backwards, leaves numbers that still look plausible.
    // This is the only assertion that catches either.
    for (const yards of [147, 180, 320, 405, 458, 508, 6215]) {
      expect(toYards(toMetres(yards))).toBeCloseTo(yards, 6);
    }
    for (const metres of [100, 312.7, 464.5]) {
      expect(toMetres(toYards(metres))).toBeCloseTo(metres, 6);
    }
  });

  it("is not the same number in both directions", () => {
    // Guards the copy-paste where toYards is written as a second toMetres.
    expect(toYards(100)).not.toBeCloseTo(toMetres(100), 1);
    expect(toYards(100)).toBeGreaterThan(100);
    expect(toMetres(100)).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/sim/units.test.ts
```

Expected: **FAIL** with `Failed to resolve import "./units"`.

- [ ] **Step 3: Write the module**

Create `src/sim/units.ts`:

```ts
/**
 * Yards at the boundary, metres in the middle.
 *
 * A US golf course is measured in yards and this one is traced from a real card, so the authored
 * hole data is in yards and every number a player reads is in yards. Everything between those two
 * boundaries is metres, because the physics engine, the Blender assets, `CART_TUNING.topSpeed`,
 * `COURSE_CELL_M`, every gate baseline and every probe control already are — and converting them
 * would be a whole-repo rewrite whose only visible effect is one multiply at the HUD.
 *
 * So: convert once when an authored hole is built, convert back once when a distance is shown.
 * Nothing in between knows this file exists.
 *
 * `props.ts`'s `MARKER_DISTANCES_M = [137, 91, 46]` was always the 150, 100 and 50 yard posts with
 * the conversion already applied and the fact never written down. It goes through here now.
 */

/** The international yard, exact by definition since 1959. */
export const YARD_M = 0.9144;

export function toMetres(yards: number): number {
  return yards * YARD_M;
}

export function toYards(metres: number): number {
  return metres / YARD_M;
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/sim/units.test.ts
```

Expected: **PASS**, all four.

- [ ] **Step 5: Route the existing yardage constants through it**

In `src/render/props.ts`, replace the hardcoded metres with the yardages they always were:

```ts
/**
 * Yardage markers: the 150, 100 and 50 yard posts a real course carries, converted to the metres
 * the placement maths works in. A hole shorter than one of them simply does not get it.
 */
const MARKER_YARDS = [150, 100, 50] as const;
const MARKER_DISTANCES_M = MARKER_YARDS.map(toMetres);
```

`props.test.ts` asserts these placements. **Run it and expect it to fail** — the old values were rounded (137, 91, 46) and the exact conversions are 137.16, 91.44 and 45.72. Update the test's expected values to the exact ones; do not round the constants back to match the test.

```bash
npx vitest run src/render/props.test.ts
```

- [ ] **Step 6: Show yards in the HUD**

`hudState.ts`'s `flatDistance` returns metres and its caller formats the readout. Convert at the format site, not in `flatDistance` — the function is used for comparisons elsewhere and changing its unit silently changes those. Find the format site and the existing test:

```bash
grep -n "flatDistance" src/ui/hudState.ts src/ui/hudState.test.ts
```

`hudState.test.ts:140` already says the readout is "the reading a real yardage gives you". Update the assertion to the yard figure and confirm it fails first against the metre value.

- [ ] **Step 7: Commit**

```bash
git add src/sim/units.ts src/sim/units.test.ts src/render/props.ts src/render/props.test.ts src/ui/hudState.ts src/ui/hudState.test.ts
git commit -m "sim: yards at the boundary, metres in the middle"
```

---

### Task 2: The authored card and routing

**Files:**
- Create: `src/sim/authoredCourse.ts`, `src/sim/authoredCourse.test.ts`
- Modify: `src/sim/course.ts` — `CORRIDOR_BAND`, `FIELD_FOR_PAR`, and `fieldSize` derivation

**Interfaces:**
- Consumes: `toMetres` from `./units`. `HoleSpec`, `Course`, `generateHole` from `./course`.
- Produces: `AUTHORED_HOLES: readonly AuthoredHole[]` where `AuthoredHole = { index, par, whiteYards, tee: Vec2, cup: Vec2, control: readonly Vec2[] }`, and `authoredCourse(seed: number): Course`.

**The tracing is the work, and it is not mechanical.** Hole order, region and which holes touch water are read directly off the plat and are settled in the spec's table. **Bearings are medium confidence and dog-leg shapes are not extractable at plat resolution.** Trace each hole against the map image, one at a time, and check each against Step 2's arc-length assertion as you go — that assertion is what turns a guess into a hole.

- [ ] **Step 1: Write the failing test**

Create `src/sim/authoredCourse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AUTHORED_HOLES, authoredCourse } from "./authoredCourse";
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
});
```

`toBeCloseTo(x, -0.7)` admits roughly ±2.5 yards. If `createSpline` exposes its arc length under a different name than `.length`, use that name — check `src/sim/spline.ts` first.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/sim/authoredCourse.test.ts
```

Expected: **FAIL**, unresolved import.

- [ ] **Step 3: Widen the validation bands and derive the field**

In `src/sim/course.ts`, the two constants stop choosing lengths and start catching typos:

```ts
/**
 * Corridor length bands, in metres — **validation bounds, not a generator's choice.**
 *
 * These were the bands a procedural drafter sampled inside, and they were sized for a course about
 * two-thirds real length: not one of the eighteen holes on the real card this course is now traced
 * from was legal under the old numbers, and the old par-4 minimum (148 yd) was shorter than every
 * real par 3. Widened to admit a real US card with margin either side, and kept only so that an
 * authored `58` where `580` was meant fails loudly instead of shipping.
 *
 * In yards, for comparison against a scorecard: par 3 is 120-230, par 4 is 260-470, par 5 is
 * 420-620.
 */
export const CORRIDOR_BAND: Readonly<Record<number, { min: number; max: number }>> = {
  3: { min: 110, max: 210 },
  4: { min: 238, max: 430 },
  5: { min: 384, max: 567 },
};
```

Replace `FIELD_FOR_PAR` usage with a derivation. The field must contain the whole corridor plus the widest half-width the hole authorises plus the blend band:

```ts
/**
 * The square a hole's terrain is built in, derived from the corridor it actually has to hold.
 *
 * Per-hole rather than per-par, because the card's range is 147 to 508 yards and one square that
 * fits the longest would make every par 3 carry three times the heightfield it needs. The old
 * `FIELD_FOR_PAR` could not fit the real card at all: a 220 m par-4 field has a 311 m diagonal
 * against a 370 m par 4, so the longest holes fitted at no bearing.
 */
export function fieldSizeFor(control: readonly Vec2[], corridor: CorridorSpec): number {
  // Implementation: the axis-aligned extent of the control points, plus twice the widest
  // half-width, plus twice BLEND_WIDTH, rounded up to a whole metre and squared off to the larger
  // axis. Read `halfWidthAt` and `BLEND_WIDTH` from ./terrain.
}
```

Keep `FIELD_FOR_PAR` exported as the fallback the fixed test hole uses, with a comment saying it is no longer the shipped path.

- [ ] **Step 4: Write the authored module**

Create `src/sim/authoredCourse.ts`. Its shape:

```ts
export interface AuthoredHole {
  readonly index: number;
  readonly par: number;
  /** From the White tees, as the scorecard prints it. Converted at construction, never stored in metres. */
  readonly whiteYards: number;
  readonly tee: Vec2;
  readonly cup: Vec2;
  /** Tee first, cup last, length >= 3. Interior points are the dog-leg apexes traced off the plat. */
  readonly control: readonly Vec2[];
}

export const AUTHORED_HOLES: readonly AuthoredHole[] = [ /* eighteen entries */ ];

export function authoredCourse(seed: number): Course { /* ... */ }
```

`authoredCourse` builds each `HoleSpec` by taking par, tee, cup and control from `AUTHORED_HOLES`, deriving `fieldSize` with `fieldSizeFor`, and taking **everything else** from the existing seeded path — `waterLevel`, `water`, `bunkers`, `green` and the per-hole seed all keep their current channels. Reuse `generateHole`'s hazard and green code rather than reimplementing it; if that code is not separable from its drafting, extract it in this step and say so in the commit.

**Trace one hole, run the arc-length assertion, then trace the next.** Eighteen holes entered blind and tested at the end gives eighteen simultaneous failures and no way to tell a typo from a bad trace.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/sim/authoredCourse.test.ts
```

Expected: **PASS**, all seven.

- [ ] **Step 6: Mutate to prove the tests bite**

| Mutation | Test that must fail |
|---|---|
| Change hole 7's `whiteYards` from 393 to 394 | "matches the scorecard hole for hole" **and** "totals par 72 and 6,215 yards" |
| Move hole 12's middle control point 40 m sideways | "builds a corridor whose arc length is the yardage on the card" |
| Make `authoredCourse` ignore its `seed` argument | "is still reproducible from a seed below the routing" |

- [ ] **Step 7: Commit**

```bash
git add src/sim/authoredCourse.ts src/sim/authoredCourse.test.ts src/sim/course.ts
git commit -m "sim: the eighteen holes are traced from the plat at White-tee yardages

Par 72, 6,215 yd. The old CORRIDOR_BAND admitted no hole on a real card."
```

---

### Task 3: Authored placements and a clubhouse on the boundary

**Files:**
- Create: `src/sim/authoredLayout.ts`, `src/sim/authoredLayout.test.ts`
- Modify: `src/sim/courseWorld.ts`, `src/sim/courseLayout.ts` and `src/sim/courseRelaxation.ts` (doc comments only)

**Interfaces:**
- Consumes: `CourseLayout { placements, clubhouse }`, `HolePlacement`, `CLUBHOUSE_APRON_M`, `CORRIDOR_CLEARANCE_M`, `inspectLayout` — all from `./courseLayout`.
- Produces: `authoredCourseLayout(): CourseLayout` and `AUTHORED_CLUBHOUSE: Vec2`.

- [ ] **Step 1: Write the failing test**

Create `src/sim/authoredLayout.test.ts`. The three properties that matter are the ones the solver used to guarantee and authored data guarantees nothing about:

```ts
import { describe, expect, it } from "vitest";
import { authoredCourseLayout, AUTHORED_CLUBHOUSE } from "./authoredLayout";
import { authoredCourse } from "./authoredCourse";
import { toCourseFrame } from "./courseGeometry";

const layout = authoredCourseLayout();
const course = authoredCourse(2026);

function cupInCourseFrame(index: number): { x: number; z: number } {
  const out = { x: 0, z: 0 };
  toCourseFrame(layout.placements[index]!, course.holes[index]!.cup.x, course.holes[index]!.cup.z, out);
  return out;
}

describe("the authored layout", () => {
  it("places all eighteen holes once each, in order", () => {
    expect(layout.placements).toHaveLength(18);
    expect(layout.placements.map((p) => p.index)).toEqual([...Array(18).keys()]);
  });

  it("returns both nines to the clubhouse", () => {
    // The one structural property of a returning nine, and authored data can break it as easily
    // as a solver could. 9 and 18 finish near the clubhouse; nothing else has to.
    for (const index of [8, 17]) {
      const cup = cupInCourseFrame(index);
      const d = Math.hypot(cup.x - AUTHORED_CLUBHOUSE.x, cup.z - AUTHORED_CLUBHOUSE.z);
      expect(d, `hole ${index + 1} cup to clubhouse`).toBeLessThan(180);
    }
  });

  it("puts the clubhouse on the southern boundary, not in the middle", () => {
    // The plat has it against a public road with the course to the north. If it comes out near
    // the centroid of the holes, the placements were laid out around it like the solver's.
    const zs = layout.placements.map((p) => p.offsetZ);
    const centre = zs.reduce((a, b) => a + b, 0) / zs.length;
    expect(AUTHORED_CLUBHOUSE.z).toBeLessThan(Math.min(...zs));
    expect(AUTHORED_CLUBHOUSE.z).toBeLessThan(centre);
  });

  it("keeps non-consecutive corridors apart outside the apron", () => {
    // Use the existing inspector rather than restating its rule. The apron exemption is now a
    // half-disc against the southern edge; conflicts inside it are expected and forgiven.
    const report = inspectLayout(layout, course.holes);
    expect(report.conflicts, JSON.stringify(report.conflicts)).toEqual([]);
  });
});
```

Read `inspectLayout`'s real signature and return shape before writing that last assertion — import it from `./courseLayout` and match what it actually returns.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/sim/authoredLayout.test.ts
```

Expected: **FAIL**, unresolved import.

- [ ] **Step 3: Author the placements**

Create `src/sim/authoredLayout.ts`. Each placement is `{ index, offsetX, offsetZ, rotation }` — where the hole's own field centre sits in the course frame and how it is turned. Trace these off the plat the same way the control points were, with the course origin at the **centre of the golf envelope** and the clubhouse south of it.

Set `AUTHORED_CLUBHOUSE` from the plat: it sits on the southern boundary, west of centre, with holes 1, 9, 10 and 18 around it.

- [ ] **Step 4: Make the apron a half-disc**

`CLUBHOUSE_APRON_M` is the radius inside which converging corridors are forgiven. With the clubhouse on the boundary, the northern half of that disc is the apron and the southern half is the road. Find every consumer and make the exemption directional:

```bash
grep -rn "CLUBHOUSE_APRON_M" src/ tools/ --include="*.ts"
```

**Also find everything that assumes the clubhouse is at the origin.** It is a search, not an assumption:

```bash
grep -rn "clubhouse" src/ tools/ --include="*.ts" | grep -v "\.test\."
grep -rn "hypot(x, z)\|hypot(p.x, p.z)" src/ --include="*.ts"
```

The second search matters: `pickupScatter.ts` uses `Math.hypot(x, z) < CLUBHOUSE_APRON_M` as its apron term if the Stage D plan landed first. It must read the clubhouse position instead.

- [ ] **Step 5: Switch `buildCourseWorld` over**

In `src/sim/courseWorld.ts`, replace the `solveCourseLayout(...)` call with `authoredCourseLayout()`. That single line is the whole swap — everything downstream takes `placements` and does not care where they came from.

- [ ] **Step 6: Mark the solver off the shipped path**

Add to the top doc comment of both `src/sim/courseLayout.ts` and `src/sim/courseRelaxation.ts`:

```
 * **Not on the shipped course's path since 12 September 2026.** The eighteen holes are traced
 * from a plat map (`authoredCourse.ts`) and placed from authored offsets (`authoredLayout.ts`);
 * `buildCourseWorld` calls those. This solver and its relaxation stay because generating a
 * *different* course from a seed is still something this project may want, and because deleting a
 * working solver to save bytes is not a trade — but nothing the player drives on comes through
 * here. See `docs/superpowers/specs/2026-09-12-authored-course-routing-design.md`.
```

- [ ] **Step 7: Run everything that touches the course**

```bash
npx vitest run src/sim/authoredLayout.test.ts
npm test
```

Expected: the new tests pass. **`courseLayout.test.ts` and `courseWorld.test.ts` will both move**, and that is the point — `courseWorld.test.ts`'s eighteen-cup assertion must still be green, because it is about materials rather than geometry and the routing changing must not break it. If it goes red, the authored greens and cups have drifted apart and that is a real bug, not a baseline.

- [ ] **Step 8: Commit**

```bash
git add src/sim/authoredLayout.ts src/sim/authoredLayout.test.ts src/sim/courseWorld.ts src/sim/courseLayout.ts src/sim/courseRelaxation.ts
git commit -m "sim: authored placements, clubhouse on the southern boundary"
```

---

### Task 4: The road is a barrier

**Files:**
- Create: `src/sim/courseBarrier.ts`
- Create: `src/render/treeline.ts`
- Modify: `src/sim/world.ts`, `src/render/scene.ts`

**Interfaces:**
- Produces: `BARRIER_INSET_M`, `clampToBounds(bounds, x, z, out): boolean` returning whether the point was outside.

- [ ] **Step 1: Write the failing test**

Add to `src/sim/world.course.test.ts`, using that file's existing `arenaSim()` and `play()` helpers — `arenaSim()` is `async`, returns `{ sim, terrain, holes }`, and steps go through `play(sim, [{ ticks, intent }])`:

```ts
  it("stops a cart at the southern boundary instead of letting it leave", async () => {
    const { sim, terrain } = await arenaSim();
    const b = terrain.bounds;

    // Point it south and hold the throttle down for long enough to cross: 40 s at 14 m/s is
    // 560 m, well past any inset from wherever loadCourse spawned it.
    sim.cart.heading = -Math.PI / 2;
    play(sim, [{ ticks: 40 * 60, intent: { throttle: 1 } }]);

    expect(sim.cart.position.z).toBeGreaterThan(b.minZ);
  });

  it("holds the boundary at more than one point along it", async () => {
    // A wall with a gap passes a single-point test. Three starts, three crossings attempted.
    const { sim, terrain } = await arenaSim();
    const b = terrain.bounds;
    for (const frac of [0.25, 0.5, 0.75]) {
      sim.cart.position.x = b.minX + (b.maxX - b.minX) * frac;
      sim.cart.position.z = b.minZ + 80;
      sim.cart.heading = -Math.PI / 2;
      play(sim, [{ ticks: 20 * 60, intent: { throttle: 1 } }]);
      expect(sim.cart.position.z, `boundary at x fraction ${frac}`).toBeGreaterThan(b.minZ);
    }
  });
```

**What these detect that a "a wall exists" assertion would not:** a collider at the wrong height, a collider set as a sensor, a collider on a layer the cart does not collide with, and a wall with a gap. All four satisfy "a barrier was created" and fail the thing a barrier is for.

- [ ] **Step 2: Run and confirm they fail**

```bash
npx vitest run src/sim/world.course.test.ts -t "boundary"
```

Expected: **FAIL** — the cart drives past `minZ`. Record how far past; that number is the evidence the barrier is doing something when it passes.

- [ ] **Step 3: Clamp the cart at the bounds**

`world.ts`'s existing bounds check at `:1425` is the *ball's* out-of-bounds rule and is not this. Add the cart clamp in `moveCartBody`, after the controller has computed its translation and before the result is written back — clamping the desired translation rather than teleporting, so a cart driving into the edge slides along it instead of stopping dead.

A clamp rather than a Rapier collider, deliberately: a wall collider on a course this size is four long thin boxes that have to be rebuilt whenever the bounds move, and the bounds are already the authority. **Rejected:** a static collider ring, for that reason; and a teleport-back, which reads as a glitch.

- [ ] **Step 4: Draw the treeline**

Create `src/render/treeline.ts`: an instanced band of the existing tree geometry, placed in a strip just outside the bounds along the southern edge, so the horizon continues past the road. Follow `Trees.ts` exactly — one merged geometry, one `InstancedMesh`, one `dispose()` freeing geometry, material and mesh.

Add it to the arena branch of `scene.ts` beside `courseGround` and `coursePickups`, and to `dispose()`.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/sim/world.course.test.ts
npm test
tsc --noEmit
npm run smoke
```

- [ ] **Step 6: Look at it**

```bash
npm run dev
```

Drive south into the road. Confirm: the cart stops rather than falling, it slides along the boundary rather than sticking, and trees are visible beyond it.

- [ ] **Step 7: Commit**

```bash
git add src/sim/courseBarrier.ts src/render/treeline.ts src/sim/world.ts src/render/scene.ts src/sim/world.course.test.ts
git commit -m "sim: carts stop at the road; render: a treeline beyond it"
```

---

### Task 5: Re-baseline, re-measure, and review the course

**Files:**
- Modify: `tools/gate-baseline/metrics.json`, `tools/gate-baseline/signatures.json`
- Modify: `docs/course/plans/*.svg` (regenerated)

- [ ] **Step 1: Regenerate the plans and look at all eighteen**

```bash
npm run plan
npm run plan:course
```

Every SVG changes. **This is the review that matters and no test replaces it.** Open all eighteen and the course plan, and check them against the plat image: is hole 1 running east along the road, do 9 and 18 come back to the clubhouse, are the ponds on the holes the spec's table says they are, does the routing read as two returning nines on opposite halves?

A hole that traced wrong shows up here far more clearly than in any assertion.

- [ ] **Step 2: Measure the terrain cost**

```bash
npm run probe:terrain
```

The course heightfield was 374k cells at 82 MB before this change. Longer holes mean larger fields mean more cells. **Record the new numbers in the commit message.** If cells have grown past roughly 1.5×, say so plainly — `COURSE_CELL_M` is the lever, not the routing, and moving it is a separate decision with its own measurement.

- [ ] **Step 3: Re-baseline the gate**

```bash
npm run gate
```

Every course subject fails on a signature delta, by construction. Review the pictures, accept the new baseline, and re-run to 19/19 PASS. The gate is a render check and proves nothing about routing correctness; its acceptance here is whether the course looks like the plat.

- [ ] **Step 4: Full verification**

```bash
tsc --noEmit && npm test && npm run gate && npm run smoke && npm run probe:terrain && npm run probe
```

Expected: `tsc` clean · suite green · gate 19/19 · smoke PASS · terrain probe PASS at its new control · `npm run probe` red on the one known driver-distance line **only**.

- [ ] **Step 5: Commit**

```bash
git add tools/gate-baseline/ docs/course/plans/
git commit -m "gate: re-baseline for the authored routing; regenerate all eighteen plans

Course heightfield: NNNk cells, NN MB (was 374k, 82 MB)."
```

---

### Task 6: Record it

**Files:** `docs/DECISIONS.md`, `docs/COURSE_PIPELINE.md`, `docs/HANDOFF.md`

- [ ] **Step 1: The decisions entry**

One entry: **"The routing is authored, and the course is measured in yards."** What a future reader cannot recover from the code:

- **The measurement that settled it.** Not one of eighteen holes on a real card was legal under the old `CORRIDOR_BAND`; the par-4 minimum was shorter than every real par 3. The generated course was about two-thirds real length hole for hole. Record the table.
- **Why the solver stays.** ~940 lines, two specs, off the shipped path and kept for generating alternate courses.
- **Why the simulation did not convert to yards.** One multiply at the boundary versus a whole-repo rewrite with no visible difference.
- **What authored data costs.** The course is no longer discoverable from a seed alone — it is a seed plus eighteen traced holes. The reproduce-from-a-seed argument in `ASSET_PIPELINE.md` §1 still holds for everything below the routing, and that distinction is worth stating because the next person will read the §1 rule and think this broke it.

- [ ] **Step 2: Update `COURSE_PIPELINE.md`**

It documents the procedural pipeline as the way courses are made. Add a section at the top saying the shipped course is authored, pointing at the spec, and scoping the rest of the document to generated courses.

- [ ] **Step 3: Rewrite the handoff**

State: the routing is authored at real yardages; the solver is off the shipped path; the barrier exists; Stage D is next and its one clubhouse-position dependency is resolved. Carry forward the loose ends this did not touch — the flat course rough, the driver roll/carry line, and the Rapier determinism build note.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: record the authored routing and the yard boundary"
```

---

## Self-Review

**Spec coverage.** Authored routing with seeded detail below it (T2) · yards authored, metres simulated, yards displayed (T1) · per-hole derived field size (T2 S3) · widened bands as validation not generation (T2 S3) · clubhouse on the southern boundary and the apron as a half-disc (T3 S3–S4) · solver retired and marked, not deleted (T3 S6) · the road as a barrier with a treeline beyond (T4) · arc-length checked against the card (T2 S1) · par and yardage totals (T2 S1) · returning nines (T3 S1) · corridor separation (T3 S1) · conversions asserted both ways (T1 S1) · gate re-baselined with human review (T5 S1, S3) · terrain cost measured (T5 S2).

**Placeholders.** Two steps carry a described implementation rather than code, and both say why: `fieldSizeFor` (T2 S3) states the formula and names the constants to read it from, because the exact expression depends on `halfWidthAt`'s signature; and the cart clamp (T4 S3) states where it goes and what it must do rather than guessing at `moveCartBody`'s internals. **The eighteen authored control-point sets are deliberately not in this plan** — they cannot be traced from a plat without the image open, the spec says so, and inventing eighteen coordinate triples here would be the worst kind of placeholder: numbers that look authoritative and are made up.

**Type consistency.** `toMetres`/`toYards`/`YARD_M` defined in T1 and used in T2. `AuthoredHole` and `AUTHORED_HOLES` defined in T2 and consumed in T3's test. `authoredCourseLayout(): CourseLayout` in T3 matches the existing `CourseLayout { placements, clubhouse }` at `courseLayout.ts:120`. `HolePlacement` carries `index`, `offsetX`, `offsetZ`, `rotation` — confirm against `courseGeometry.ts` before authoring, since it is re-exported rather than defined in `courseLayout.ts`.

**Three things the executor must verify before trusting this plan**, all of which moved under previous plans in this repo: `createSpline`'s arc-length accessor name, `inspectLayout`'s signature and return shape, and whether `generateHole`'s hazard/green code is separable from its drafting. Each is named at the step that needs it.

# Physics-Relaxation Course Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `solveCourseLayout`'s constructive-geometry closure (the fan-scan in
`placeNineAsLobes`, currently red on 3 of its own tests) with a deterministic relaxation pass that
closes the loop by giving the transition distance slack, while keeping the lobed out-and-back
shape and the existing `LayoutHole → HolePlacement[]` contract.

**Architecture:** `solveCourseLayout` keeps calling `placeNineAsLobes` to get an initial, roughly
lobed layout, then runs a new Gauss-Seidel/Verlet relaxation (`relaxNine`, new file
`src/sim/courseRelaxation.ts`) that treats each hole as a rigid rod (fixed length, hard
constraint), each green-to-tee transition as a bounded slack joint (soft constraint, free inside
`[TRANSITION_MIN_M, TRANSITION_MAX_M]`), non-consecutive corridors as mutually repelling, and pulls
the last hole's cup toward the clubhouse. If a nine still misses its return threshold after
relaxation, that nine falls back to the already-shipped, already-exact circle construction
(`loopRadius` + `placeNine`), which becomes live code again instead of dead code.

**Tech Stack:** TypeScript, Vitest. No new dependencies — this is arithmetic over the existing
`Vec2`/`HolePlacement` types.

**Spec:** `docs/superpowers/specs/2026-09-10-physics-relaxation-course-routing-design.md`. Also
read `docs/RESEARCH-ROUTING.md` (why the fixed 30 m transition made closure impossible) and
`docs/TEST-AND-SPEC-PITFALLS.md` §1 (this repo's recurring defect: an assertion loose enough to
pass against a broken implementation) before Task 4.

## Global Constraints

- No `Math.random()` anywhere in `src/sim/**`, including this work — `relaxNine` must be a pure
  function of its inputs (fixed iteration count, no probabilistic termination).
- `solveCourseLayout`'s signature (`(holes: readonly LayoutHole[]) => CourseLayout`) does not
  change — every downstream caller (terrain assembly, surfaces, spawns, map, arena ground)
  consumes `HolePlacement[]` unchanged.
- A placement must remain a rigid motion: hole length (`|cup - tee|` in the hole's own frame) is
  never stretched, compressed, or mirrored by relaxation or by the fallback.
- `frontReturnM ≤ TRANSITION_M + 1` (31 m) and `backReturnM ≤ CLUBHOUSE_GAP_M + TRANSITION_M + 1`
  (121 m) are **not relaxed** — these are `courseLayout.test.ts`'s existing thresholds (lines 104,
  116, 168) and this plan's fallback trigger is defined against them directly, in Task 3.
- `TRANSITION_MIN_M = 15`, `TRANSITION_MAX_M = 100` (RESEARCH-ROUTING.md §Q3). `TRANSITION_M = 30`
  stays as-is and keeps its existing meaning: the initial construction's per-step walk and the
  relaxation's implicit target (nothing pulls a transition toward it once it's inside the bounds —
  see design §4, step 2).

---

### Task 1: Transition slack bounds and the exports `courseRelaxation.ts` needs

**Files:**
- Modify: `src/sim/courseLayout.ts:140` (add constants), `:282` (`chordOf`), `:439`
  (`pointToSegment`, stays private), `:461` (`polylineClearance`), `:429` (`placedControl`)
- Test: `src/sim/courseLayout.test.ts`

**Interfaces:**
- Produces: `TRANSITION_MIN_M: number`, `TRANSITION_MAX_M: number` (new exported constants);
  `chordOf(hole: LayoutHole): number`, `placedControl(hole: LayoutHole, placement: HolePlacement):
  Vec2[]`, `polylineClearance(a: readonly Vec2[], b: readonly Vec2[]): { distance: number; at:
  Vec2 }` (existing functions, changed from module-private to exported — signatures unchanged).

- [ ] **Step 1: Write the failing test**

Add to `src/sim/courseLayout.test.ts` (new `describe` block, anywhere after the imports):

```ts
describe("transition slack bounds", () => {
  it("brackets the shipped target", () => {
    expect(TRANSITION_MIN_M).toBeLessThan(TRANSITION_M);
    expect(TRANSITION_MAX_M).toBeGreaterThan(TRANSITION_M);
  });
});
```

Add `TRANSITION_MIN_M, TRANSITION_MAX_M` to the existing import block at the top of the file
(alongside `TRANSITION_M`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/courseLayout.test.ts -t "brackets the shipped target"`
Expected: FAIL — `TRANSITION_MIN_M` is not exported.

- [ ] **Step 3: Add the constants and the three exports**

In `src/sim/courseLayout.ts`, immediately after `export const TRANSITION_M = 30;` (line 140):

```ts
/** Floor and ceiling on a green-to-tee walk once relaxation is allowed to stretch or compress
 *  it. RESEARCH-ROUTING.md §Q3: a fixed 30 m walk left the loop with no slack to absorb the
 *  residual displacement a lobed shape leaves behind (see courseLayout.ts's `placeNineAsLobes`
 *  doc comment). Outside this range a transition is a defect, not a variation. */
export const TRANSITION_MIN_M = 15;
export const TRANSITION_MAX_M = 100;
```

Change `function chordOf` (line 282) to `export function chordOf`.
Change `function placedControl` (line 429) to `export function placedControl`.
Change `function polylineClearance` (line 461) to `export function polylineClearance`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/courseLayout.test.ts`
Expected: PASS, and the full existing file still shows the same red/green pattern it had before
this task (this task adds exports and a constants test; it does not touch closure behaviour, so
the hole-9/hole-18/clean-bill failures from the `course-routing` branch's attempt 6 are still red
here — that's Task 3's job).

- [ ] **Step 5: Commit**

```bash
git add src/sim/courseLayout.ts src/sim/courseLayout.test.ts
git commit -m "Export transition slack bounds and clearance helpers for the relaxation solver"
```

---

### Task 2: The relaxation core

**Files:**
- Create: `src/sim/courseRelaxation.ts`
- Test: `src/sim/courseRelaxation.test.ts`

**Interfaces:**
- Consumes: `LayoutHole`, `HolePlacement`, `toCourseFrame`, `chordOf`, `placedControl`,
  `polylineClearance`, `TRANSITION_MIN_M`, `TRANSITION_MAX_M`, `CORRIDOR_CLEARANCE_M`,
  `CLUBHOUSE_APRON_M` — all from `./courseLayout` (Task 1 exported the last three of these
  already; `CORRIDOR_CLEARANCE_M`/`CLUBHOUSE_APRON_M` were already exported).
- Produces: `relaxNine(holes: readonly LayoutHole[], initial: readonly HolePlacement[], hub: Vec2,
  clubhouse: Vec2): HolePlacement[]` — Task 3 calls this directly.

- [ ] **Step 1: Write the failing test**

Create `src/sim/courseRelaxation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { relaxNine } from "./courseRelaxation";
import type { HolePlacement, LayoutHole } from "./courseLayout";

function hole(index: number, length: number): LayoutHole {
  return {
    index,
    tee: { x: -length / 2, z: 0 },
    cup: { x: length / 2, z: 0 },
    control: [
      { x: -length / 2, z: 0 },
      { x: length / 2, z: 0 },
    ],
  };
}

function place(layout: readonly HolePlacement[], holes: readonly LayoutHole[], index: number, local: { x: number; z: number }): { x: number; z: number } {
  const h = holes[index]!;
  const p = layout.find((q) => q.index === index)!;
  const cos = Math.cos(p.rotation);
  const sin = Math.sin(p.rotation);
  return { x: p.offsetX + local.x * cos - local.z * sin, z: p.offsetZ + local.x * sin + local.z * cos };
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// Three holes laid out in a straight line, 960 m from the clubhouse and pointing further away --
// a deliberately bad initial guess (real callers pass placeNineAsLobes's output, which already
// points roughly homeward). Nothing about relaxNine should assume a good starting guess; the
// attractor is what has to do the work here.
function straightLine(): { holes: LayoutHole[]; initial: HolePlacement[]; hub: { x: number; z: number }; clubhouse: { x: number; z: number } } {
  const holes = [hole(0, 300), hole(1, 300), hole(2, 300)];
  const initial: HolePlacement[] = [
    { index: 0, offsetX: 150, offsetZ: 0, rotation: 0 },
    { index: 1, offsetX: 480, offsetZ: 0, rotation: 0 },
    { index: 2, offsetX: 810, offsetZ: 0, rotation: 0 },
  ];
  return { holes, initial, hub: { x: 0, z: 0 }, clubhouse: { x: 0, z: 0 } };
}

describe("relaxNine", () => {
  it("never changes a hole's own length", () => {
    const { holes, initial, hub, clubhouse } = straightLine();
    const relaxed = relaxNine(holes, initial, hub, clubhouse);
    for (const h of holes) {
      const local = dist(h.tee, h.cup);
      const placed = dist(place(relaxed, holes, h.index, h.tee), place(relaxed, holes, h.index, h.cup));
      expect(placed).toBeCloseTo(local, 6);
    }
  });

  it("pulls the last cup closer to the clubhouse than the bad initial guess left it", () => {
    const { holes, initial, hub, clubhouse } = straightLine();
    const before = dist(place(initial, holes, 2, holes[2]!.cup), clubhouse);
    const relaxed = relaxNine(holes, initial, hub, clubhouse);
    const after = dist(place(relaxed, holes, 2, holes[2]!.cup), clubhouse);
    expect(after).toBeLessThan(before);
  });

  it("keeps every transition within the slack bounds", () => {
    const { holes, initial, hub, clubhouse } = straightLine();
    const relaxed = relaxNine(holes, initial, hub, clubhouse);
    for (let i = 0; i + 1 < holes.length; i++) {
      const green = place(relaxed, holes, i, holes[i]!.cup);
      const tee = place(relaxed, holes, i + 1, holes[i + 1]!.tee);
      const walk = dist(green, tee);
      expect(walk).toBeGreaterThanOrEqual(15 - 0.5);
      expect(walk).toBeLessThanOrEqual(100 + 0.5);
    }
  });

  it("pins the first hole's tee on the hub", () => {
    const { holes, initial, hub, clubhouse } = straightLine();
    const relaxed = relaxNine(holes, initial, hub, clubhouse);
    expect(dist(place(relaxed, holes, 0, holes[0]!.tee), hub)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/courseRelaxation.test.ts`
Expected: FAIL — `./courseRelaxation` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/sim/courseRelaxation.ts`:

```ts
/**
 * Closes a nine's loop by relaxation instead of by construction. `placeNineAsLobes` gives this
 * an initial guess that already has the right lobed shape (docs/RESEARCH-ROUTING.md's attempt
 * 6); what it does not reliably have is closure, because its transitions are fixed at exactly
 * TRANSITION_M and a lobed shape's residual displacement has nowhere else to go. This module
 * gives the chain the one degree of freedom §Q3 identifies -- transition length, bounded rather
 * than fixed -- and lets a fixed number of constraint-satisfaction passes absorb the residual.
 *
 * Deterministic by construction: no RNG, and a fixed iteration count rather than a convergence
 * threshold, so floating-point order-of-operations differences cannot change how many passes run.
 */

import type { Vec2 } from "./mapGeometry";
import {
  CLUBHOUSE_APRON_M,
  CORRIDOR_CLEARANCE_M,
  TRANSITION_MAX_M,
  TRANSITION_MIN_M,
  chordOf,
  placedControl,
  polylineClearance,
  toCourseFrame,
  type HolePlacement,
  type LayoutHole,
} from "./courseLayout";

const ITERATIONS = 200;
/** Fraction of the remaining distance to the clubhouse the last cup closes per iteration. Low
 *  enough that the rigid-length and slack constraints (which run first each iteration) get to
 *  react to each step rather than being dragged past their own limits by a single big jump. */
const ATTRACTOR_RATE = 0.08;

/** Moves `a`/`b` apart or together until `|b - a| === targetLen`, weighting the move by which
 *  endpoint is pinned. A pinned endpoint (weight 0) never moves; if neither is pinned each moves
 *  half the correction. */
function satisfyDistance(a: Vec2, b: Vec2, pinnedA: boolean, pinnedB: boolean, targetLen: number): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return;
  const wa = pinnedA ? 0 : 1;
  const wb = pinnedB ? 0 : 1;
  const wsum = wa + wb;
  if (wsum === 0) return;
  const diff = (len - targetLen) / len;
  a.x += dx * diff * (wa / wsum);
  a.z += dz * diff * (wa / wsum);
  b.x -= dx * diff * (wb / wsum);
  b.z -= dz * diff * (wb / wsum);
}

/** Only pulls `a`/`b` toward each other (or pushes apart) when their distance is outside
 *  [min, max] -- inside the range this applies no force at all, which is what makes it slack
 *  rather than a spring toward a fixed rest length. */
function satisfySlack(a: Vec2, b: Vec2, min: number, max: number): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < min) satisfyDistance(a, b, false, false, min);
  else if (len > max) satisfyDistance(a, b, false, false, max);
}

function placementFromParticles(hole: LayoutHole, tee: Vec2, cup: Vec2): HolePlacement {
  const wanted = Math.atan2(cup.z - tee.z, cup.x - tee.x);
  const own = Math.atan2(hole.cup.z - hole.tee.z, hole.cup.x - hole.tee.x);
  const rotation = wanted - own;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    index: hole.index,
    offsetX: tee.x - (hole.tee.x * cos - hole.tee.z * sin),
    offsetZ: tee.z - (hole.tee.x * sin + hole.tee.z * cos),
    rotation,
  };
}

/** Nudges every non-consecutive, off-apron pair of corridors apart when they run closer than
 *  CORRIDOR_CLEARANCE_M, by translating each hole's tee and cup together (a translation cannot
 *  change a hole's own length, so this needs no rigid-length re-check of its own). Reuses
 *  `placedControl`/`polylineClearance` -- the same functions `inspectLayout` grades against --
 *  so the solver and its own test suite agree on what a conflict is. */
function applyCorridorRepulsion(holes: readonly LayoutHole[], tee: Vec2[], cup: Vec2[], clubhouse: Vec2): void {
  const placements = holes.map((h, i) => placementFromParticles(h, tee[i]!, cup[i]!));
  const centrelines = holes.map((h, i) => placedControl(h, placements[i]!));

  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      if (j - i === 1) continue;
      const { distance, at } = polylineClearance(centrelines[i]!, centrelines[j]!);
      if (distance === 0 || distance >= CORRIDOR_CLEARANCE_M) continue;
      if (Math.hypot(at.x - clubhouse.x, at.z - clubhouse.z) <= CLUBHOUSE_APRON_M) continue;

      const push = (CORRIDOR_CLEARANCE_M - distance) / 2;
      const midA = { x: (tee[i]!.x + cup[i]!.x) / 2, z: (tee[i]!.z + cup[i]!.z) / 2 };
      const midB = { x: (tee[j]!.x + cup[j]!.x) / 2, z: (tee[j]!.z + cup[j]!.z) / 2 };
      const sep = Math.hypot(midB.x - midA.x, midB.z - midA.z) || 1;
      const dx = (midB.x - midA.x) / sep;
      const dz = (midB.z - midA.z) / sep;
      tee[i]!.x -= dx * push; tee[i]!.z -= dz * push;
      cup[i]!.x -= dx * push; cup[i]!.z -= dz * push;
      tee[j]!.x += dx * push; tee[j]!.z += dz * push;
      cup[j]!.x += dx * push; cup[j]!.z += dz * push;
    }
  }
}

export function relaxNine(
  holes: readonly LayoutHole[],
  initial: readonly HolePlacement[],
  hub: Vec2,
  clubhouse: Vec2,
): HolePlacement[] {
  if (holes.length === 0) return [];

  const byIndex = new Map(initial.map((p) => [p.index, p]));
  const tee: Vec2[] = [];
  const cup: Vec2[] = [];
  for (const hole of holes) {
    const placement = byIndex.get(hole.index)!;
    const t = { x: 0, z: 0 };
    const c = { x: 0, z: 0 };
    toCourseFrame(placement, hole.tee.x, hole.tee.z, t);
    toCourseFrame(placement, hole.cup.x, hole.cup.z, c);
    tee.push(t);
    cup.push(c);
  }

  const lengths = holes.map(chordOf);
  const lastCup = cup[cup.length - 1]!;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Re-pin every iteration rather than once: step 3 (repulsion) moves every particle,
    // including hole 0's tee, and only re-pinning after the fact keeps the anchor exact without
    // giving repulsion special-case knowledge of which particle is pinned.
    tee[0] = { x: hub.x, z: hub.z };

    for (let i = 0; i < holes.length; i++) {
      satisfyDistance(tee[i]!, cup[i]!, i === 0, false, lengths[i]!);
    }
    for (let i = 0; i + 1 < holes.length; i++) {
      satisfySlack(cup[i]!, tee[i + 1]!, TRANSITION_MIN_M, TRANSITION_MAX_M);
    }
    applyCorridorRepulsion(holes, tee, cup, clubhouse);

    lastCup.x += (clubhouse.x - lastCup.x) * ATTRACTOR_RATE;
    lastCup.z += (clubhouse.z - lastCup.z) * ATTRACTOR_RATE;
  }
  tee[0] = { x: hub.x, z: hub.z };

  return holes.map((hole, i) => placementFromParticles(hole, tee[i]!, cup[i]!));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/courseRelaxation.test.ts`
Expected: PASS on all four assertions. If "pulls the last cup closer" is flaky or "keeps every
transition within the slack bounds" fails by a small margin, raise `ITERATIONS` (try 400) or
lower `ATTRACTOR_RATE` (try 0.05) before touching the constraint logic itself — these two knobs
are the tuning surface this design intentionally left open (spec §4).

- [ ] **Step 5: Commit**

```bash
git add src/sim/courseRelaxation.ts src/sim/courseRelaxation.test.ts
git commit -m "Add deterministic Verlet relaxation for closing a nine's routing loop"
```

---

### Task 3: Wire relaxation into `solveCourseLayout`, with the circle-construction fallback

**Files:**
- Modify: `src/sim/courseLayout.ts:397-426` (`solveCourseLayout`)
- Test: `src/sim/courseLayout.test.ts` (no new tests — this task is graded by the existing
  `describe("returning nines", ...)` and `describe("inspectLayout", ...)` blocks going green)

**Interfaces:**
- Consumes: `relaxNine` from `./courseRelaxation` (Task 2).
- Produces: `solveCourseLayout`'s external behaviour changes (closure now holds); its signature
  does not.

- [ ] **Step 1: Confirm the current red**

Run: `npx vitest run src/sim/courseLayout.test.ts`
Expected: FAIL on "brings hole 9 back to the clubhouse", "brings hole 18 back to the clubhouse",
and `describe("inspectLayout", ...) > "reports a clean bill..."` — these are the
`course-routing` branch's attempt-6 failures RESEARCH-ROUTING.md's table already measured
(h9 = 274.1 m, h18 = 371.2 m against thresholds of 31 / 121). Record the actual failing numbers
from this run's output; Task 5 needs them for the fallback threshold sanity check.

- [ ] **Step 2: Add the circle-construction fallback and the relaxation call**

In `src/sim/courseLayout.ts`, add this import at the top:

```ts
import { relaxNine } from "./courseRelaxation";
```

This makes `courseLayout.ts` and `courseRelaxation.ts` import from each other. That's safe here
specifically because every use on both sides is inside a function body (`relaxNine`'s use of
`chordOf`/`placedControl`/etc., and `solveCourseLayout`'s use of `relaxNine`) rather than at
module top-level — by the time any of these functions actually runs, both modules have finished
evaluating. If `tsc`/Vite ever complains about this cycle, the fix is splitting the shared
`chordOf`/`placedControl`/`polylineClearance`/constants into a third module both import from,
not making one of the two imports lazy.

Add this function after `placeNineAsLobes` (after line 328):

```ts
/** The shipped-and-measured construction from before this module had lobes: chords fit exactly
 *  to a circle through the hub (docs/RESEARCH-ROUTING.md, "What ships today"). Deterministic,
 *  closes exactly by the bisection in `loopRadius`, zero corridor conflicts on every seed
 *  measured -- the fallback when relaxation does not land a nine's return within its threshold. */
function placeNineOnCircle(holes: readonly LayoutHole[], hub: Vec2, direction: number): HolePlacement[] {
  if (holes.length === 0) return [];
  const chords = holes.flatMap((h) => [chordOf(h), TRANSITION_M]);
  const radius = loopRadius(chords);
  const centre: Vec2 = { x: hub.x, z: hub.z - direction * radius };
  const startAngle = direction * (Math.PI / 2);
  return placeNine(holes, centre, radius, startAngle, direction);
}

/** Relaxation's initial guess, then relaxation itself; falls back to the exact circle
 *  construction if the result still misses its return threshold. */
function placeNineWithFallback(
  holes: readonly LayoutHole[],
  hub: Vec2,
  clubhouse: Vec2,
  outward: number,
  direction: number,
  returnLimitM: number,
): HolePlacement[] {
  if (holes.length === 0) return [];

  const seeded = placeNineAsLobes(holes, hub, outward, direction);
  const relaxed = relaxNine(holes, seeded, hub, clubhouse);

  const lastHole = holes[holes.length - 1]!;
  const lastPlacement = relaxed[relaxed.length - 1]!;
  const lastCup: Vec2 = { x: 0, z: 0 };
  toCourseFrame(lastPlacement, lastHole.cup.x, lastHole.cup.z, lastCup);
  const miss = Math.hypot(lastCup.x - clubhouse.x, lastCup.z - clubhouse.z);

  return miss <= returnLimitM ? relaxed : placeNineOnCircle(holes, hub, direction);
}
```

Replace the body of `solveCourseLayout` (lines 397-426) with:

```ts
export function solveCourseLayout(holes: readonly LayoutHole[]): CourseLayout {
  const clubhouse: Vec2 = { x: 0, z: 0 };
  const front = holes.slice(0, 9);
  const back = holes.slice(9, 18);

  const placements: HolePlacement[] = [];

  if (front.length > 0) {
    placements.push(
      ...placeNineWithFallback(front, clubhouse, clubhouse, Math.PI / 2, 1, TRANSITION_M + 1),
    );
  }
  if (back.length > 0) {
    const hub: Vec2 = { x: clubhouse.x + CLUBHOUSE_GAP_M, z: clubhouse.z };
    placements.push(
      ...placeNineWithFallback(
        back,
        hub,
        clubhouse,
        -Math.PI / 2,
        -1,
        CLUBHOUSE_GAP_M + TRANSITION_M + 1,
      ),
    );
  }

  return { placements, clubhouse };
}
```

Delete the now-unused local `chordsOf` closure that was inside the old `solveCourseLayout` body
(it was already dead before this task — RESEARCH-ROUTING.md flagged it — and
`placeNineOnCircle` above is its replacement, built from the same `chordOf`/`loopRadius` pair at
module scope instead of redefined per call).

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/sim/courseLayout.test.ts`
Expected: PASS on every test in `describe("returning nines", ...)` and
`describe("inspectLayout", ...)`. The two tests that assert exact `TRANSITION_M` (line 124's
"keeps the walk... short" and line 167's `maxTransitionM` check) may still be red here — Task 4
updates those assertions to match the new bounded behaviour; leave them failing until then rather
than special-casing the solver to force exact 30 m transitions, which would defeat this whole
change.

- [ ] **Step 4: Commit**

```bash
git add src/sim/courseLayout.ts
git commit -m "Close nine routing by relaxation, falling back to the exact circle construction"
```

---

### Task 4: Loosen the exact-transition assertions

**Files:**
- Modify: `src/sim/courseLayout.test.ts:5` (import), `:124`, `:167`

**Interfaces:** none — test-only change.

- [ ] **Step 1: Update the import**

Line 5, add `TRANSITION_MIN_M, TRANSITION_MAX_M,` to the destructured import from
`"./courseLayout"` (alongside the existing `TRANSITION_M`).

- [ ] **Step 2: Replace the exact-walk assertion**

Line 124 currently reads:

```ts
      expect(dist(green, tee)).toBeCloseTo(TRANSITION_M, 3);
```

Replace with:

```ts
      expect(dist(green, tee)).toBeGreaterThanOrEqual(TRANSITION_MIN_M - 0.5);
      expect(dist(green, tee)).toBeLessThanOrEqual(TRANSITION_MAX_M + 0.5);
```

- [ ] **Step 3: Replace the exact `maxTransitionM` assertion**

Line 167 currently reads:

```ts
    expect(report.maxTransitionM).toBeCloseTo(TRANSITION_M, 3);
```

Replace with:

```ts
    expect(report.maxTransitionM).toBeLessThanOrEqual(TRANSITION_MAX_M + 0.5);
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run src/sim/courseLayout.test.ts src/sim/courseRelaxation.test.ts`
Expected: PASS, including `describe("holes run out and back beside each other", ...)` (the
pairing test) and `describe("the course the game actually generates", ...)` (the real
`generateCourse(2026, 18)` fixture) — neither of those was touched by this task, so their result
here is this task's actual acceptance check, not just the two lines edited above.

- [ ] **Step 5: Commit**

```bash
git add src/sim/courseLayout.test.ts
git commit -m "Assert bounded transition walks instead of an exact 30 m, matching the slack solver"
```

---

### Task 5: Red-first proof that the attractor and the slack bound are load-bearing

This task has no diff to commit by itself — it is the verification `docs/TEST-AND-SPEC-PITFALLS.md`
§1 asks for before trusting a green suite that a relaxation-style solver is exactly the shape of
defect that section warns about (a tolerance wide enough to pass against a solver that never ran
its own closing step). Do this before considering the branch done; if either check below does not
reproduce the described failure, the corresponding test is not discriminating and needs a tighter
bound (raise `returnLimitM`'s calling test's strictness, or narrow `TRANSITION_MAX_M - 0.5`'s
margin) before this plan is complete.

**Files:** none modified and kept — temporary edits, reverted after each check.

- [ ] **Step 1: Prove the attractor is load-bearing**

In `src/sim/courseRelaxation.ts`, temporarily comment out the two attractor lines at the end of
the iteration loop:

```ts
    // lastCup.x += (clubhouse.x - lastCup.x) * ATTRACTOR_RATE;
    // lastCup.z += (clubhouse.z - lastCup.z) * ATTRACTOR_RATE;
```

Run: `npx vitest run src/sim/courseLayout.test.ts -t "brings hole 9 back"`
Expected: FAIL. If it still passes, `placeNineAsLobes`'s initial guess alone is already
satisfying the 31 m threshold on this seed and the test is not exercising the attractor at all —
tighten `TRANSITION_M + 1` in that assertion or pick a fixture where the initial guess is known to
miss (the `eighteen()` fixture in this file, or a specific seed) before undoing this step.

Revert the comment-out (`git diff` should be empty for this file) and re-run to confirm PASS
before moving to Step 2.

- [ ] **Step 2: Prove the slack bound is load-bearing**

In `src/sim/courseLayout.ts`, temporarily set both:

```ts
export const TRANSITION_MIN_M = 30;
export const TRANSITION_MAX_M = 30;
```

Run: `npx vitest run src/sim/courseLayout.test.ts`
Expected: FAIL, and specifically on the same tests attempt 6 failed on before Task 3 (hole 9 /
hole 18 return, clean bill) — this is the reproduction of RESEARCH-ROUTING.md's original bug: with
zero slack, the chain is overconstrained again and closure fails the same way it did across all
six prior attempts. If the suite stays green with zero slack, the relaxation's attractor step is
doing the closing on its own without the transition bound actually being exercised, which means
`TRANSITION_MIN_M`/`TRANSITION_MAX_M` are not load-bearing and Task 1-4's central claim (transition
slack is what fixes this) is not actually demonstrated by the suite.

Revert to `TRANSITION_MIN_M = 15` / `TRANSITION_MAX_M = 100` and re-run to confirm PASS.

- [ ] **Step 3: Record the result**

No commit for this task (both edits are reverted). If either check did not reproduce the expected
failure, open a follow-up task to tighten the relevant assertion before treating this plan as
finished — do not weaken the check to make Step 1 or 2 "pass" instead.

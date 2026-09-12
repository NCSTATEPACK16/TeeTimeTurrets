# Hole Ownership Near the Apron — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every one of the eighteen cups reports `green` as the material under it, and the scene gate's course subject finally covers the clubhouse apron where the bug lived.

**Architecture:** Hole ownership is decided by an argmax over per-hole influence. Influence saturates at `1`, so where two corridors overlap both holes report exactly `1`, the strictly-greater test never fires, and the winner is decided by hole order. The fix adds a defined tie-break — distance to the hole's spline as a fraction of that corridor's half-width — captured during the influence computation and consulted only when influence ties. The change is confined to the discrete owner channel; the continuous weight vector is untouched, so assembled heights cannot move.

**Tech Stack:** TypeScript, Vitest (node environment for `src/sim/**`), Three.js, Rapier, Vite, Puppeteer (gate and smoke harnesses).

**Spec:** `docs/superpowers/specs/2026-09-12-hole-ownership-near-the-apron-design.md`

**Issues:** #22 (Task 1), #23 (Task 2), #24 (Task 3)

## Global Constraints

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. Do not import anything browser-only into them.
- **Never `Math.random()` in `src/sim/**`.** Not needed by this work, but it is a standing rule.
- The fixed tick **bans allocation** in query paths. `weightsInto` and `influenceLocal` are called hundreds of thousands of times by `buildHeightfield`; they must continue to allocate nothing. Use closure-owned scratch, which is the existing pattern in this module.
- **Get a test to fail for the right reason before you make it pass.** `docs/TEST-AND-SPEC-PITFALLS.md` §1 is this repo's named recurring defect.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle physics; `npm run gate` and `npm run smoke` settle presentation.
- **`npm run probe:terrain` after any change to the assembly.**
- Do **not** add a second test at a lower seam. The spec settles this: one seam, the existing one.
- Do **not** touch the continuous weight vector, its cubing, or its normalisation.

---

## File Structure

**Modified:**
- `src/sim/courseTerrain.ts` — adds one closure-scratch variable and a tie-break clause. The only behavioural change in the whole plan.
- `src/sim/courseWorld.test.ts:49` — `it.fails` becomes `it`. Assertion unchanged.
- `tools/gate/gateScene.ts:201` — `GATE_COURSE_HOLES` 3 → 18.
- `tools/gate-baseline/metrics.json`, `tools/gate-baseline/signatures.json` — regenerated for the `course-ground` subject only.
- `docs/DECISIONS.md` — one new entry.
- `docs/HANDOFF.md` — the loose-end entry for this bug is removed.

**Created:**
- `src/sim/courseOwnership.scratch.test.ts` — **temporary**, for per-cup red evidence only. Deleted in Task 1 before the commit. It must not appear in any commit.

---

### Task 1: Define the tie-break where corridor influence saturates

**Issue:** #22

**Files:**
- Create (temporary, deleted in this task): `src/sim/courseOwnership.scratch.test.ts`
- Modify: `src/sim/courseTerrain.ts` (the `createCourseTerrain` closure — scratch declarations near the top, `influenceLocal`, `weightsInto`)
- Modify: `src/sim/courseWorld.test.ts:49`

**Interfaces:**
- Consumes: `halfWidthAt(corridor, t)` and `nearestScratch: NearestPoint` with fields `.distance` and `.t`, both already in scope inside `createCourseTerrain`.
- Produces: no signature changes. `weightsInto(x, z, out): number` keeps its exact shape — the returned owner index simply becomes correct where corridors overlap.

- [ ] **Step 1: Write a temporary test that prints every cup's material**

This is the per-cup red evidence the spec requires. It is throwaway and gets deleted in Step 8.

Create `src/sim/courseOwnership.scratch.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildCourseWorld } from "./courseWorld";
import { generateCourse } from "./course";
import { toCourseFrame } from "./courseGeometry";
import { SurfaceId } from "./surfaces";

const COURSE_SEED = 2026;
const world = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED);

function cupOf(index: number): { x: number; z: number } {
  const hole = world.holes[index]!;
  const out = { x: 0, z: 0 };
  toCourseFrame(hole.placement, hole.spec.cup.x, hole.spec.cup.z, out);
  return out;
}

describe("cup ownership, per hole", () => {
  // One case per hole, so every cup reports independently rather than the loop
  // aborting on the first wrong one.
  for (let i = 0; i < 18; i++) {
    it(`hole ${i + 1} reads green under its cup`, () => {
      const cup = cupOf(i);
      expect(world.surfaces.surfaceAt(cup.x, cup.z)).toBe(SurfaceId.Green);
    });
  }
});
```

- [ ] **Step 2: Run it and record which cups are wrong**

Run: `npx vitest run src/sim/courseOwnership.scratch.test.ts`

Expected: **15 pass, 3 fail.** The three failures must be **hole 9, hole 17 and hole 18** — and no others. Record the actual `SurfaceId` each reports.

If a different set of holes fails, **stop**. The spec's premise is that these three are wrong; a different set means the course or the seed has changed since the spec was written, and the plan needs revisiting rather than pushing through.

- [ ] **Step 3: Capture how centred each point is, during the influence computation**

In `src/sim/courseTerrain.ts`, alongside the existing closure-owned scratch (`localScratch`, `nearestScratch`, `weightScratch`), add:

```typescript
  /**
   * How centred in its own corridor the last `influenceLocal` call's point was: distance to the
   * spline as a fraction of the corridor half-width there. Written on every call before any early
   * return, and read by `weightsInto` immediately afterwards.
   *
   * A variable rather than a return value because `influenceLocal` returns early from four places
   * once influence saturates, and the fixed tick bans allocating a pair to return instead.
   */
  let lastCentredness = Number.POSITIVE_INFINITY;
```

Then inside `influenceLocal`, immediately after `const half = halfWidthAt(spec.corridor, nearestScratch.t);` and **before** the `if (weight >= 1) return 1;` line:

```typescript
    lastCentredness = half > 0 ? nearestScratch.distance / half : Number.POSITIVE_INFINITY;
```

Placement matters: every early return in this function must leave `lastCentredness` already written for the current point.

- [ ] **Step 4: Consult it only when influence ties**

In `weightsInto`, replace the accumulator declarations and the argmax clause. The existing code reads:

```typescript
    let sum = 0;
    let best = -1;
    let bestInfluence = 0;
```

becomes:

```typescript
    let sum = 0;
    let best = -1;
    let bestInfluence = 0;
    let bestCentredness = Number.POSITIVE_INFINITY;
```

and the existing clause:

```typescript
      if (influence > bestInfluence) {
        bestInfluence = influence;
        best = i;
      }
```

becomes:

```typescript
      const centredness = lastCentredness;
      // Influence saturates at 1 inside a corridor, so two converging holes both report exactly 1
      // and `>` alone hands the point to whichever came first in hole order -- which is why three
      // cups inside the clubhouse apron read a neighbour's material. Ties go to the hole the point
      // is most centred in: distance to the spline as a fraction of that corridor's half-width.
      if (
        influence > bestInfluence ||
        (influence === bestInfluence && centredness < bestCentredness)
      ) {
        bestInfluence = influence;
        bestCentredness = centredness;
        best = i;
      }
```

Leave everything else in the function exactly as it is — `blendWeight(influence)`, `out[i] = weight`, `sum += weight`, and the `sum > 1` normalisation are all untouched. `const centredness = lastCentredness;` must sit **after** the `if (influence <= 0) continue;` guard so it reads the current point's value.

- [ ] **Step 5: Run the temporary test and confirm each cup individually**

Run: `npx vitest run src/sim/courseOwnership.scratch.test.ts`

Expected: **18 pass.** Specifically confirm holes 9, 17 and 18 each now report green as their own named case. This is the acceptance criterion "cups 9, 18 and 17 are each observed going green individually" — record the before/after for each.

- [ ] **Step 6: Invert the real test**

In `src/sim/courseWorld.test.ts:49`, change `it.fails(` to `it(`. Change nothing else — not the assertion, not the title.

Delete the second doc-comment block above it (the one beginning "`it.fails` and not `it.skip`"), since it describes a bug that no longer exists. **Keep** the first doc-comment block (the one beginning "The failure this module exists to prevent"), which explains what the assertion is for and is still true.

- [ ] **Step 7: Run the real suite**

Run: `npm test`

Expected: all green, with **no** expected-failure entries remaining. The handoff's previous count was 910 tests / 61 files with 909 passing and 1 expected fail; that 1 should now be a pass.

- [ ] **Step 8: Delete the temporary test**

```bash
rm src/sim/courseOwnership.scratch.test.ts
```

It has done its job. It must not reach a commit — the spec settles that no new test is added at a lower seam, and this one duplicates the real seam.

- [ ] **Step 9: Confirm geometry did not move**

Run: `npm run probe:terrain`

Expected: **PASS, unchanged control.** This is the evidence that the change stayed in the discrete channel. If the control moved, the change reached the weights and the fix is wrong — revisit Step 4.

- [ ] **Step 10: Confirm the type check and the untouched gate**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run gate`
Expected: **19/19 PASS.** The `course-ground` subject is still three holes at this point, which has no apron, so it should be unaffected at delta 0.00. A move here would mean the tie-break changed ownership somewhere with no overlapping corridors — investigate before continuing.

- [ ] **Step 11: Commit**

```bash
git add src/sim/courseTerrain.ts src/sim/courseWorld.test.ts
git commit -m "sim: ties in hole ownership go to the corridor the point is most centred in

Influence saturates at 1, so two converging holes both reported exactly 1 and
the argmax fell through to hole order -- three cups inside the clubhouse apron
read a neighbour's material. Closes #22."
```

Confirm `git status` shows no trace of `courseOwnership.scratch.test.ts` before committing.

---

### Task 2: Extend the gate's course subject to eighteen holes

**Issue:** #23 · **Blocked by:** Task 1

Do not start this until Task 1 is committed. Landing it first would bake the bug into the new baseline and cost a second picture review.

**Files:**
- Modify: `tools/gate/gateScene.ts:201`
- Modify: `tools/gate-baseline/metrics.json`, `tools/gate-baseline/signatures.json` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: `buildCourseWorld` and `createCourseGround`, both already imported by `gateScene.ts`. No signature changes anywhere.
- Produces: nothing other code reads.

- [ ] **Step 1: Widen the subject**

In `tools/gate/gateScene.ts:201`:

```typescript
const GATE_COURSE_HOLES = 18;
```

Leave the bake loop at `gateScene.ts:194` alone. Its bound of 5000 was measured as sufficient: eighteen holes at 40,000 iterations produced identical geometry (251,328 vertices, 490,056 triangles), so the bake converges well inside the existing bound.

Update the subject's doc comment to say it builds the full course, and delete any wording claiming it does not exercise routing or relaxation — at eighteen holes it now does.

- [ ] **Step 2: Run the gate and confirm only this subject moves**

Run: `npm run gate`

Expected: **FAIL, and only on `course-ground`.** Every other subject must still report signature delta 0.00. The expected numbers, measured while writing the spec:

```
FAIL - course-ground: vertices 251328 != baseline 56868
FAIL - course-ground: triangles 490056 != baseline 111400
FAIL - course-ground: bbox.x 976.3639 != baseline 438.8115
FAIL - course-ground: bbox.y 12.5897 != baseline 11.6808
FAIL - course-ground: bbox.z 1196.2454 != baseline 432.8708
```

If any other subject moves, **stop** — the change has reached something it should not have.

- [ ] **Step 3: Record the wall time**

Run: `time npm run gate`

Expected: roughly **29–30 s**, against roughly 25.5 s for the three-hole subject — about 1.16×. The agreed budget was that the gate stays inside `npm run build` if the extension costs under about 2×. If it lands materially above that on this machine, **stop and report it** rather than proceeding: the decision to keep it in the build was made against the measured 1.16×.

- [ ] **Step 4: Regenerate the baseline**

Run: `npm run gate -- --update-baseline`

Expected: the baseline is rewritten and the run reports PASS.

- [ ] **Step 5: Run the gate again, clean**

Run: `npm run gate`

Expected: **19/19 PASS**, every subject at delta 0.00. This confirms the new baseline is stable rather than sensitive to run-to-run variation.

- [ ] **Step 6: Stop and request the picture review**

**This issue cannot be closed by an implementation session alone.** The subject changed shape entirely, so this is a fresh baseline rather than a diff and automated comparison has nothing meaningful to compare against.

Surface the regenerated `course-ground` picture to the repository owner and ask for approval, naming what to look for: eighteen holes present, the returning nines converging on the clubhouse, mow stripes running with their own holes near the apron, and no water or sand mask sitting under a green.

Do not commit until that approval is given.

- [ ] **Step 7: Verify the build path**

Run: `npm run build`

Expected: clean — `tsc --noEmit`, then the Vite build, then the gate at 19/19.

- [ ] **Step 8: Commit**

```bash
git add tools/gate/gateScene.ts tools/gate-baseline/metrics.json tools/gate-baseline/signatures.json
git commit -m "gate: the course subject builds all eighteen holes

Three holes fell back to the circular placement, so the subject had never
contained a returning nine or the clubhouse apron -- the region the ownership
bug lived in. Costs 1.16x wall time and converges inside the existing bake
bound. Closes #23."
```

---

### Task 3: Record the rule and its evidence in the decisions log

**Issue:** #24 · **Blocked by:** Task 1, Task 2

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/HANDOFF.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write the entry**

Add one entry to `docs/DECISIONS.md`, placed with the existing section on assembling the course ("influence, not a mosaic") — that section explains the continuous channel and says nothing about the discrete one, which is the silence that left this tie-break undefined.

Match the surrounding entries' voice and structure. It must cover:

- **The mechanism, stated plainly.** Influence saturates at 1; inside overlapping corridors two holes report exactly 1; the argmax then falls through to hole order. Nothing about the blend is wrong — say so explicitly, because this reads like a blending problem and is not one.
- **The rule.** Ties go to the hole the point is most centred in, measured as distance to the spline over that corridor's half-width. General, not a cup special case.
- **Why "a point does not belong to a field" does not conflict.** That recorded argument is about height, and assembled heights discard the owner entirely. Discrete material is a different question.
- **What was rejected, and why:** raw metric distance (hands contested ground to whichever hole is wider); a cup-specific special case (indistinguishable from a coincidence, and leaves the defect live at every other feature in the apron); an explicit apron precedence order; changing the continuous weights (moves geometry and the grade invariant for no benefit); splitting mow direction from material ownership (would leave stripes pointing at a neighbouring hole in the place just fixed); teaching the course assembly about the clubhouse (the tie-break is geometry-local and needs nothing extra).
- **The evidence, with numbers.** The gate subject went 3 → 18 holes; it costs 1.16× wall time (25.5 s → 29.5 s) so it stays in `npm run build`; the bake loop was left alone because eighteen holes at eight times the bound produced identical geometry. Both were settled by measurement, not by argument.

The full record of what was rejected at each grilling round is in `.scratch/cup-ownership-near-the-apron/prd.md` if more detail is wanted.

- [ ] **Step 2: Retire the loose end**

In `docs/HANDOFF.md`, remove the `courseTerrain.weightsInto` cup-ownership entry from "Loose ends this session added". It is no longer loose.

Also update the note in "The tests worth reading before you write another one" that describes `courseWorld.test.ts`'s `it.fails` as a live pattern — the bug is fixed and the marker is gone. Keep the general lesson about `it.fails` versus `it.skip`; it is still the right pattern for the next known bug. Adjust the carried-forward line stating the gate's `course-ground` subject does not exercise routing or relaxation: at eighteen holes it now does.

- [ ] **Step 3: Confirm nothing else claims the bug is open**

Run: `grep -rn "it.fails\|misdrawn\|cup-ownership\|cup ownership" docs/ src/ --include=*.md --include=*.ts`

Expected: no remaining text describing the three cups as currently wrong. Anything that turns up is either a historical account (fine, leave it) or a stale claim (fix it).

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md docs/HANDOFF.md
git commit -m "docs: record the ownership tie-break and the widened gate subject

Closes #24."
```

---

## Notes for whoever picks this up

**The hazard interaction is a deliberate consequence, not an oversight.** `influenceLocal` can saturate from a water polygon or a bunker ellipse rather than from the corridor, and in that case `lastCentredness` still reports distance to the *spline*. A point deep inside a pond but far from that hole's centreline will therefore lose a tie to a hole whose corridor it sits nearer the middle of. This follows from the rule as specified — distance to spline over half-width, applied generally — and cups are unaffected because a cup sits in the middle of a green by construction. If it produces a visibly wrong result somewhere that is not a cup, that is new information and worth raising rather than quietly special-casing.

**Why the owner index is safe to change but the weights are not.** `heightAt` calls `weightsInto` and discards the return value, so ownership cannot reach assembled heights. The owner is read by the material lookup, the surface tuning lookup, the hazard channel's sand/water/bridge selection, and the renderer's mow-stripe direction. The weights are read by the material blend and the renderer's biome selection. Task 1 touches only the first group.

**This unblocks Stage D.** Pickup placement is specified to ask `weightsInto` which hole a candidate point belongs to, and was deliberately sequenced after this work so it would not be built on the wrong answer.

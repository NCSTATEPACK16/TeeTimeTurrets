# Hazard-Aware Ownership Tie-Break — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A point inside a hole's own water polygon or bunker ellipse reports that hole's material, restoring the 8,824 m² of course water that currently reads as dry ground.

**Architecture:** `influenceLocal` writes `lastCentredness` once from the spline, before its `spec.water` and `spec.bunkers` loops run. When a hazard is what saturates the influence, the tie-break therefore compares the wrong quantity. The fix sets `lastCentredness = 0` — the value that already means "dead centre" — where a hazard shape both raises the weight and contains the point. One new local in each loop, no signature changes, and the continuous weight vector is untouched.

**Tech Stack:** TypeScript, Vitest (node environment for `src/sim/**`), Three.js, Rapier, Vite, Puppeteer (gate harness).

**Spec:** `docs/superpowers/specs/2026-09-12-hazard-aware-ownership-tie-break-design.md`

**Blocks:** `docs/superpowers/plans/2026-09-12-stage-d-pickups-implementation.md`. Land this first.

## Global Constraints

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment.
- The fixed tick **bans allocation** in query paths. `influenceLocal` is called hundreds of thousands of times by `buildHeightfield`. Use the existing closure-owned scratch pattern; add no allocation.
- **Never `Math.random()` in `src/sim/**`.** Not needed here; standing rule.
- **Get a test to fail for the right reason before you make it pass.** `docs/TEST-AND-SPEC-PITFALLS.md` §1.
- **A render check is never evidence about simulation.** `npm test` settles this change; `npm run gate` settles only the picture.
- **`npm run probe:terrain` after any change to the assembly.** An unchanged control is the expected result.
- Do **not** touch the continuous weight vector, its cubing (`blendWeight`), or the `sum > 1` normalisation.
- Do **not** modify `world.course.test.ts`'s existing `wetPoint` scan test. It stays; it is simply not the evidence.

---

## File Structure

**Modified:**
- `src/sim/courseTerrain.ts` — `influenceLocal` only (currently lines 181–205). Two small clauses, one per hazard loop.
- `src/sim/courseWorld.test.ts` — one new `it` block appended inside the existing `describe("buildCourseWorld")`.
- `tools/gate-baseline/metrics.json`, `tools/gate-baseline/signatures.json` — regenerated for the `course-ground` subject only.
- `docs/DECISIONS.md` — the "This was accepted deliberately, not overlooked" paragraph in the hole-ownership entry is amended to record the reversal.
- `docs/HANDOFF.md` — loose-end entry updated.

**No new source files.** The whole behavioural change is inside one function.

---

### Task 1: Hazard containment wins the ownership tie

**Files:**
- Modify: `src/sim/courseTerrain.ts` — `influenceLocal`, lines 181–205
- Test: `src/sim/courseWorld.test.ts` (append one `it` inside the existing `describe`)

**Interfaces:**
- Consumes: `polygonSignedDistance(x, z, poly): number` (negative inside) and `ellipseEdgeDistance(x, z, e): number` (negative inside), both already imported at `courseTerrain.ts:35`. `lastCentredness`, a closure-scoped `let` declared at `courseTerrain.ts:173`.
- Produces: no signature changes. `weightsInto(x, z, out): number` keeps its exact shape; the owner index it returns simply becomes correct inside hazards.

- [ ] **Step 1: Write the failing test**

Append this inside the existing `describe("buildCourseWorld", ...)` in `src/sim/courseWorld.test.ts`. The module already has `world`, `toCourseFrame` and `SurfaceId` in scope from its existing imports.

```ts
  /**
   * `influenceLocal` writes `lastCentredness` from the spline before its hazard loops run, so a
   * point a pond saturated is compared on its *corridor* centredness and can lose the tie to a
   * neighbour. `weightsAt`/`surfaceAt` then read the hazard channel from the wrong hole and the
   * pond reports dry.
   *
   * Named by construction, never by search. `world.course.test.ts`'s `wetPoint` helper scans the
   * course for any cell that still reports water, which self-adapts to a shrinking pond and passes
   * whatever this bug does.
   */
  it("reports water at the centre of every placed water polygon", () => {
    const out = { x: 0, z: 0 };
    let checked = 0;

    for (const hole of world.holes) {
      for (const poly of hole.spec.water) {
        let localX = 0;
        let localZ = 0;
        for (const p of poly.points) {
          localX += p.x;
          localZ += p.z;
        }
        localX /= poly.points.length;
        localZ /= poly.points.length;

        toCourseFrame(hole.placement, localX, localZ, out);
        checked++;
        expect(
          world.surfaces.surfaceAt(out.x, out.z),
          `hole ${hole.spec.index + 1} pond centroid (${out.x.toFixed(1)}, ${out.z.toFixed(1)})`,
        ).toBe(SurfaceId.Water);
      }
    }

    // A loop over an empty list passes every assertion inside it. Seed 2026 routes eleven dry
    // holes, so this must find ponds on the rest.
    expect(checked, "no water polygons found -- the loop asserted nothing").toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
npx vitest run src/sim/courseWorld.test.ts -t "reports water at the centre"
```

Expected: **FAIL**, with at least one message naming a specific hole and reporting `"fairway"` or `"rough"` where `"water"` was expected. Record which holes fail — Task 1 is not done until each of them is observed passing individually.

If it passes here, stop. Either the centroid of every pond happens to sit where its own corridor already wins, in which case this test cannot detect the defect and needs a better point, or the bug is not present.

- [ ] **Step 3: Make the water loop set centredness on containment**

In `src/sim/courseTerrain.ts`, replace the `spec.water` loop inside `influenceLocal` (currently lines 191–195):

```ts
    for (const poly of spec.water) {
      const signed = polygonSignedDistance(localX, localZ, poly);
      const w = 1 - smoothstep01(signed / COURSE_BLEND_M);
      if (w > weight) {
        weight = w;
        // The tie-break asks how far inside this hole's own geometry the point is, and nothing is
        // further inside than the middle of its pond. `lastCentredness` was written from the
        // spline above, which is a fact about the corridor and says nothing about why this hole
        // claimed the point -- so a pond could lose a tie to a better-centred neighbour and report
        // dry. Containment, not proximity: a point merely near a hazard is still the corridor's.
        if (signed <= 0) lastCentredness = 0;
      }
      if (weight >= 1) return 1;
    }
```

- [ ] **Step 4: Make the bunker loop do the same**

Replace the `spec.bunkers` loop (currently lines 196–200):

```ts
    for (const bunker of spec.bunkers) {
      const edge = ellipseEdgeDistance(localX, localZ, bunker);
      const w = 1 - smoothstep01(edge / COURSE_BLEND_M);
      if (w > weight) {
        weight = w;
        if (edge <= 0) lastCentredness = 0;
      }
      if (weight >= 1) return 1;
    }
```

The rule is "hazards", not "hazards except bunkers". Sand's consequence is only mechanical — a bunker that does not bog a cart down — but it is the same defect and the same two lines.

- [ ] **Step 5: Run the new test and the whole sim suite**

```bash
npx vitest run src/sim/courseWorld.test.ts
npm test
```

Expected: the new test **PASSES**. Every other test in the file, including `"puts green under every cup"`, stays green — cups sit on greens rather than in hazards, so this change should not reach them. **Confirm that rather than assuming it**; "in principle it cannot" is what the previous bug hid behind.

- [ ] **Step 6: Confirm red-before-green per hole**

For each hole recorded as failing in Step 2, re-run with only that hole's assertion reachable (comment out the others, or `git stash` the fix and re-read the Step 2 output). Each must be seen going from red to green on its own. A suite that turns green all at once cannot distinguish a rule that fixes every hole from one that fixes most and reaches the rest by accident.

- [ ] **Step 7: Measure the restored water**

Write this to `/tmp/water-area.mjs` (scratch, not committed) and run it against a `vite build -c tools/probe.vite.config.ts` bundle, or add it as a temporary `it` that `console.log`s and then delete it. Either way the number goes in the commit message, not into an assertion — pinning an area to a constant would fail on any future change to pond shape for reasons unrelated to ownership.

```ts
const b = world.terrain.bounds;
let cells = 0;
for (let x = b.minX; x <= b.maxX; x += 2) {
  for (let z = b.minZ; z <= b.maxZ; z += 2) {
    if (world.surfaces.surfaceAt(x, z) === SurfaceId.Water) cells++;
  }
}
console.log(`${cells} cells, ${cells * 4} m2`);
```

Expected: close to **9,993 cells / 39,972 m²**, the figure measured before the September tie-break landed. The pre-fix figure is 7,787 cells / 31,148 m². Anything materially above 9,993 means the fix is over-claiming and hazards are winning ties they should lose.

- [ ] **Step 8: Run the terrain probe as a regression net**

```bash
npm run probe:terrain
```

Expected: **PASS**, unchanged control. This is what confirms the change stayed inside the discrete channel and did not move assembled geometry.

- [ ] **Step 9: Commit**

```bash
git add src/sim/courseTerrain.ts src/sim/courseWorld.test.ts
git commit -m "sim: a tied point goes to the hole whose own hazard contains it

Restores 2,206 cells (8,824 m2) of course water that reported dry.
Measured seed 2026, 2 m grid, full bounds: 7,787 -> 9,9xx cells."
```

Replace `9,9xx` with the number Step 7 actually produced.

---

### Task 2: Re-baseline the gate and amend the decision record

**Files:**
- Modify: `tools/gate-baseline/metrics.json`, `tools/gate-baseline/signatures.json`
- Modify: `docs/DECISIONS.md` — the hole-ownership entry, the paragraph beginning "**This was accepted deliberately, not overlooked.**"
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: nothing from Task 1 in code. Depends on Task 1 being committed, because the mask this re-baselines is what Task 1 changed.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Run the gate and see the course subject move**

```bash
npm run gate
```

Expected: `course-ground` **FAILS** with a non-zero signature delta. Every other subject **PASSES** at delta 0.00. If a second subject moved, stop — this change is scoped to the hazard channel and should touch exactly one picture.

- [ ] **Step 2: Review the new course picture by eye**

Open the generated `course-ground` render. The gate is a render check and is never evidence about simulation — its acceptance is a human review, and what you are reviewing for is specific: **the ponds are visibly back**, particularly inside the clubhouse apron where holes 1, 9, 10 and 18 converge. Compare against the previous baseline image side by side.

Do not accept the baseline if the ponds look *larger* than the surrounding geometry suggests they should. Step 7 of Task 1 is the number; this is the picture that has to agree with it.

- [ ] **Step 3: Accept the new baseline**

Follow the same approval path the eighteen-hole extension used (`docs/superpowers/plans/2026-09-12-hole-ownership-near-the-apron-implementation.md`, Task 3). Regenerate the two baseline files and confirm `npm run gate` is 19/19 PASS afterwards.

```bash
npm run gate
```

Expected: **19/19 PASS**, mean delta 0.00.

- [ ] **Step 4: Amend the decision record rather than appending to it**

In `docs/DECISIONS.md`, the hole-ownership entry currently ends with a paragraph stating the hazard consequence "was accepted deliberately, not overlooked" and naming the hazard-aware tie-break as open. That paragraph now describes a decision that was reversed. Replace its closing two sentences with the reversal and its cause:

```markdown
**This was accepted deliberately, and then reversed.** The consequence above was found in review,
measured against the real code, and put to the repository owner, who chose to accept it and record
it here. It was reopened on 12 September when Stage D specified pickup placement to ask the same
`surfaceAt` call whether a candidate point is valid ground — a second consumer of the same wrong
answer, and one that would have scattered pickups into ponds reporting fairway. The hazard-aware
tie-break named below as the open alternative is now the shipped rule: a tied point goes to the
hole whose own placed hazard contains it, with `lastCentredness` set to zero on containment in
both the water and bunker loops. Measured the same way, seed 2026 on the 2 m grid: the course
reports water at 9,9xx cells again, against 7,787 under the corridor-only tie-break. See
`docs/superpowers/specs/2026-09-12-hazard-aware-ownership-tie-break-design.md`.
```

Replace `9,9xx` with Task 1 Step 7's number.

- [ ] **Step 5: Update the handoff**

In `docs/HANDOFF.md`, the hazard consequence is currently carried as accepted. Replace that with one line recording it as closed and naming this spec. Add nothing else — the handoff is a baton, not a log.

- [ ] **Step 6: Full verification before the commit**

```bash
tsc --noEmit
npm test
npm run gate
npm run probe:terrain
```

Expected: `tsc` clean · the suite green with one more test than before · gate 19/19 PASS · terrain probe PASS with an unchanged control. `npm run probe` is expected to stay red on the one known driver-distance line only — do not read that as a regression.

- [ ] **Step 7: Commit**

```bash
git add tools/gate-baseline/ docs/DECISIONS.md docs/HANDOFF.md
git commit -m "gate: re-baseline course-ground for the restored ponds; record the reversal"
```

---

## Self-Review

**Spec coverage.** Both hazard loops (Task 1 Steps 3–4) · containment not proximity (Steps 3–4, and the comment says why) · centredness-of-zero rather than a third comparison key (Steps 3–4) · restored lethality shipped as-is, no drowning change (nothing in either task touches `checkCartWater`) · scope confined to the discrete channel (Step 8's probe is the evidence) · the test named by construction rather than by search (Step 1, with the reason in its doc comment) · what else would satisfy the assertion (Step 1's `checked > 0` guard) · area as acceptance rather than assertion (Step 7) · eighteen-cup assertion confirmed not assumed (Step 5) · red-before-green per hole (Step 6) · gate re-baselined with human review (Task 2 Steps 1–3) · decision record amended not appended (Task 2 Step 4).

**Placeholders.** None. Every code step carries the actual code; the two `9,9xx` tokens are explicitly a measured number the executor fills in, and both say so.

**Type consistency.** `polygonSignedDistance` and `ellipseEdgeDistance` are used with the signatures they have at `src/sim/hazards.ts:138` and `:72`, both negative inside. `lastCentredness` is the existing `let` at `courseTerrain.ts:173`. `toCourseFrame(frame, localX, localZ, out)` matches `courseGeometry.ts:51`. `Polygon.points` is `readonly Vec2[]` per `hazards.ts:29`.

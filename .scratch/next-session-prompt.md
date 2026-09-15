# What is left

Branch `hole-ownership-near-the-apron`, pushed. **Draft PR #26** against `main`.
At HEAD: `tsc --noEmit` clean, `npm test` **931/931** — but use `--testTimeout=30000`; at the default
5 s a different two or three Rapier tests time out each run, and the base commit is flaky the same
way. Not run since Task 2: `gate`, `smoke`, `probe`, `probe:terrain`.

**Read first:** `AGENTS.md` (DCO sign-off on every commit, `git commit -s`; never AI or session
metadata in a commit or PR). Then, in
`.superpowers/sdd/2026-09-12-authored-course-routing-implementation/` (gitignored, so it is not in
the PR): `progress.md` (the ledger — every ruling and measurement), `plat-trace.md` (**the map** —
the plat image is not and will never be in the tree), `user-decisions.md`, `verified-signatures.md`.

---

## 0. Blocking: the owner's plat review

The eighteen plans are regenerated (`docs/course/plans/*.svg`, rasterised to `tools/.plan-png/`).
**The placements are a fit, not a tracing** — 11 of 15 stated bearings survive within 37°, holes
**12, 14, 15, 16** are 71°/74°/49°/68° out, and field centres moved 170 m mean / 343 m max. Nothing
asserts the routing *is* the plat's; only eighteen pictures and a human can. If the answer is no,
re-fit (method in the ledger; the lever is marker weight against bearing weight) rather than
hand-edit.

## 1. ~~Re-author the eighteen briefs~~ — DONE, commit `61732d7`

All eighteen now match the card; `PAR_MIX` moved to the card's order. Water on **4, 12, 13, 15, 16,
18**. Signature holes **4, 13, 18** (the cape moved 7 → 13). **No island green** — the plat shows
none and 13 is a 322-yard par 4; the exemption branch stays in the cup-in-water test for any brief
that adopts the form later.

**⚠️ It cost the generated course, and this is not fixed.** Moving `PAR_MIX` made the lobed
relaxation fail to close on **six of ten seeds**, so `solveCourseLayout` falls back to the circle
construction — anti-parallel pairs 475–583 m apart, zero returning legs. The tell is
`maxTransitionM` of exactly 30 instead of ~100. Cause: a lobe's first and third holes are meant to
run anti-parallel, and the real card puts par 5s at 1, 8, 14, 18, so a 460-yard leg keeps getting
paired with a 320-yard one. **Nothing the player drives on comes through that solver**, so it was
recorded rather than repaired — see the comment on `courseLayout.test.ts`'s "returns a conflict-free
layout on every generated seed". Fixing it means teaching the lobe construction about unequal legs.

## 2. The road is a barrier (plan 2, Task 4)

`courseBarrier.ts`, a cart clamp in `moveCartBody`, `treeline.ts`.
The geometry already ships: `AUTHORED_SOUTH_BOUNDARY` + `metresNorthOfBoundary` in
`authoredLayout.ts`. Task 4 owns the inset, the clamp and the physics, not the line.

- **County Home Road is diagonal.** The plan's `cart.position.z > bounds.minZ` is a clamp to a
  constant `z` — it would cut the course short in the west and leave playable ground over the road in
  the east. Treat the boundary as a line.
- **Files Road** (south-east corner, plat px (915,1120)→(960,1245)) is undecided. Say which way you
  went and why.
- Ruled: **the second barrier test must not write `sim.cart.position`** — `moveCartBody` fights it
  next tick and the test measures the fight. Use three `arenaSim()` instances steered to different x,
  or unit-test `clampToBounds` at three x values and say so. **Do not delete the multi-point check**
  — "a wall with a gap passes a single-point test" is why it exists. `arenaSim()` is `async`, returns
  `{ sim, terrain, holes }`, builds a **six-hole** course at 8 m cells, `botCount: 0`, steps via
  `play(sim, [{ ticks, intent }])`. There is no `idleIntent`.

## 3. Re-baseline (Task 5)

`npm run plan`, `plan:course`, `probe:terrain` (old control 374k cells / 82 MB; the authored envelope
is smaller — placed fields span 1,520 × 1,331 m), then the gate. All three plan tools already render
the authored course.

## 4. Record it (Task 6)

`DECISIONS.md`, `COURSE_PIPELINE.md`, `HANDOFF.md`, plus three entries beyond the plan's list:
- **the deferred half-disc apron**, with its measurement: all 11 pairs the apron forgives lie north
  of the clubhouse, so a half-disc is a no-op here, and `inspectLayout` is shared with the solver
  whose two nines need the full disc.
- **`inspectLayout` cannot see consecutive corridors crossing** — four pairs did on the first fit,
  one mid-fairway on hole 6 — which is why `authoredLayout.test.ts` asserts it separately.
- `LICENSES.md` already names **Caswell Pines Golf Club, North Carolina**, White tees.

## 5. Hazard-aware ownership tie-break (plan 1, 2 tasks)

`git apply .superpowers/sdd/2026-09-12-hazard-aware-ownership-tie-break-implementation/task-1-work-in-progress.patch`
(both files), re-run red/green, **re-measure the water area on the new routing** — the 8,824 m² and
9,993-cell figures describe a course that no longer exists — then the gate re-baseline and the
`DECISIONS.md` amendment. It halted on a defect in the generated routing this branch deletes.
**Check hole 13 first if anything goes red**: its cup sits at the exact centroid of its own water
polygon, safe only because the pond is its own hole's. If the briefs work moves the island, check
whichever hole gains it.

## 6. Stage D pickups (plan 3, 6 tasks + 1 blocked)

`docs/superpowers/plans/2026-09-12-stage-d-pickups-implementation.md`. Not started.
- **`pickupScatter.ts` must read the clubhouse from the layout**, never `Math.hypot(x, z) <
  CLUBHOUSE_APRON_M` — `AUTHORED_CLUBHOUSE` is at `{ x: -243.4, z: -533.3 }`, not the origin.
- `PICKUP_CHANNEL = 5` is free; 0–4 are taken.
- **`SPAWN_CLEARANCE_M = 60` makes some contention tests impossible** — `loadCourse` never spawns two
  carts inside one pickup's 3 m radius. Rig-order precedence is recorded unasserted and tested a
  level down. **Do not teleport carts to "fix" it.**
- **Task 7 is blocked on a Blender session**, not code; `src/entities/graphs/pickups.json` does not
  exist. Task 5 ships placeholder geometry so nothing waits on it.
- Art-sheet deviations: `pickup-items-01.jpg` has cross-object scale wrong by ~¼;
  `clubhouse-exterior-01.jpg` draws window mullions its prompt banned.

## 7. Doc corrections owed

- **`TEST-AND-SPEC-PITFALLS.md` §1, tenth instance:** `props.test.ts`'s distance-post assertion has a
  **4 m tolerance against a 0.16–0.44 m change** — 25× too loose, which is why a plan and a session
  brief both predicted a red that could not happen. The 4 m is real; the defect was the stale
  `[137, 91, 46]`.
- **Eleventh:** `inspectLayout`'s consecutive-hole exemption — a check scoped one notch wider than
  its claim, which is why four crossed fairways were invisible.
- **`docs/UI-SPEC.md:80` and `src/ui/pinMarker.ts:2` still say the pin readout is "whole metres".**
  It is yards.
- `docs/HANDOFF.md` rewritten as a baton at the end.

---

## Traps that cost a session

- **Search, never trust a line number.** Plans here carry stale ones.
- **`npm run probe` is expected RED** on the one driver-distance line. Only a second line is a
  regression.
- **Confirm a file is new before `Write`ing it** (`git status`/`ls`). This repo nearly lost
  `matchScoreboard.ts` that way.
- **A render check is never evidence about simulation.** `npm test`/`probe` settle behaviour;
  `gate`/`smoke` settle presentation.
- **Do not accept an unevidenced green.** Regenerate red/green yourself if a worker dies.
- `art/clubhouse-and-cart.blend` is modified in the working tree and uncommitted. No session touched
  it. Ask before doing anything with it.

## To finish PR #26

Take it out of draft once 1–7 are done and:

```
tsc --noEmit           clean
npm test               green (--testTimeout=30000)
npm run gate           19/19 PASS
npm run smoke          PASS
npm run probe:terrain  PASS at its new control
npm run probe          red on the driver-distance line only
```

Plus the two things no command checks: **eighteen hole plans reviewed against the plat by a human**,
and `docs/HANDOFF.md` rewritten. The PR body already carries the framing; update its "what is
deliberately not here" section as each item lands.

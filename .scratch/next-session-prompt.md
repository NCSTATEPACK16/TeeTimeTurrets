# Waiting on the owner's plat review. Then re-author the briefs, then Task 4, then plan 1, then Stage D.

Branch: `hole-ownership-near-the-apron`. Remote: `origin` → `NCSTATEPACK16/TeeTimeTurrets`.
Four commits on top of the planning session's docs commit. **Nothing is pushed.**

```
664e44e  sim: authored placements, clubhouse on the southern boundary
26bee9d  sim: the eighteen holes are traced from the plat at White-tee yardages
f5ad7b9  sim: yards at the boundary, metres in the middle
843f4b9  docs: spec and plan the hazard tie-break, authored routing, and Stage D
```

Verified at `664e44e`: `tsc --noEmit` clean · `npm test` **931 passed, 64 files**.
Not run since: `gate`, `smoke`, `probe:terrain`, `probe`.

**`npm test` at its default 5 s timeout is flaky on this machine and was flaky at `26bee9d` too** —
a different two or three Rapier tests time out each run. Everything passes at
`npm test -- --testTimeout=30000`. Not a regression; verified by running the baseline commit the
same way. Whether to raise `testTimeout` in `vitest.config.ts` is the owner's call, not a silent fix.

**Unrelated stray change: `art/clubhouse-and-cart.blend` is modified in the working tree** (250,716
→ 252,786 bytes) and was not touched by this session. Left alone and uncommitted. Ask the owner
before doing anything with it.

---

## THE ONE THING BLOCKING EVERYTHING

**The owner is reviewing the eighteen hole plans against the plat, and asked that nothing further be
built until that is done.** Plans regenerated at `docs/course/plans/*.svg`, rasterised to
`tools/.plan-png/*.png`. The course plan was sent to them.

This review is not a formality. **The placements are a fit, not a tracing** — see
`authoredLayout.ts`'s own doc comment and the ledger. The plat has no scale bar and its drawn
fairways run ~20% short of the scorecard, so lengths (the card's) and positions (the drawing's) are
over-determined. What the fit cost, measured:

- **11 of the 15 stated bearings survive within 37°.** Four do not: holes **12, 14, 15, 16** at 71°,
  74°, 49°, 68°. Look at those hardest.
- Field centres moved **170 m on average, 343 m at worst** (hole 12).
- Holes 6, 10 and 17 had no stated bearing — the plat records only "short".

Everything structural is green: walks ≤57 m, clearance 47.8 m with zero conflicts, both nines return
at 130/131 m, clubhouse south of every hole, corridors ≥78 m north of the road, one corridor
crossing (14/15) and it is at the green-to-tee handover.

**If the owner says the routing does not read as the plat**, re-fit rather than hand-edit: the method
is in the ledger, and the trade to move is the marker weight against the bearing weight.

---

## Read these first, in this order

1. `AGENTS.md` — house rules. DCO sign-off on every commit (`git commit -s`); never any AI or
   session metadata in a commit message.
2. `.superpowers/sdd/2026-09-12-authored-course-routing-implementation/progress.md` — **the ledger.**
   Task 3's rulings, the fit's method and cost, the mutation evidence, and the briefs blocker.
3. `plat-trace.md` in the same directory — **the map**, and now carries a correction: **hole 14 plays
   north, not south.** The `Plays` column came from the spec, not the drawing, and had a reversal in
   it. Do not trust that column blind.
4. `user-decisions.md` — the owner's calls, including the two made on 13 September.
5. `docs/TEST-AND-SPEC-PITFALLS.md` §1 and §2.
6. `docs/DECISIONS.md` before touching `courseTerrain.ts`, `match.ts` or either results screen.

---

## Next, once the review clears: re-author the eighteen briefs — OWNER-RULED, SUPERSEDES TASK 3b

**Task 3b as written in the old handoff is dead.** It assumed only the *water* was on the wrong
holes. Measured during Task 3: `briefs.ts` was authored against the generator's `PAR_MIX`, and
**11 of 18 briefs carry a `parTarget` the authored card contradicts** — taking their `archetype`,
hazard schema, `signature` flag and prose with them.

- hole **13**: brief is the island-green par 3, *"the shortest hole on the card"* — card says **par
  4, 322 yd**. The shortest is hole 17 at 147 yd.
- hole **4**: brief is a par-5 *"three-shot hole"* — card says **par 3, 180 yd**, and the plat makes
  it the signature hole played over the north-east pond.
- hole **17**: brief is *"tightest driving hole… a sharp dogleg"* — card says **par 3, 147 yd**.
- hole **11**: *"Longest on the card"* — card says **320 yd**, the shortest par 4.
- hole **1**: *"wide, gentle opener"* par 4 — card says **par 5, 508 yd**.

And the water cannot move on its own, because two archetypes *are* their water: hole **7** is
`archetype: "cape"` (defined by the inside water) **and `signature: true`**, hole **2** is
`forced-carry`. Hole 15's note cross-references hole 2's water; hole 16's note says *"the water
stops"* and 16 is a hole that gains it.

**Owner chose: re-author all eighteen briefs against the card** — pars, archetypes, hazard schemes,
signature holes and prose — **and move `PAR_MIX` to the card's mix**, because `briefs.test.ts`
asserts `parTarget` against it:

```
5,4,4,3,4,3,4,5,4  /  3,4,4,4,5,4,4,3,5     (same 36 / 36 / 72 totals)
```

Water goes on the plat's holes: **4, 13, 15, 16, 18**, with **12** adjacent to the large pond.
Off **2, 7, 9, 14**. Hole 4 is a `crossing` (played *over* the pond); hole 16 a lateral, pond to its
west, so `lateral-right` playing south.

**Traps in this work:**

1. `briefs.test.ts` locks `signature` to exactly **{7, 13, 18}** and `parTarget` to `PAR_MIX`. If the
   signature holes move, that test moves with them — deliberately, not incidentally.
2. `authoredCourse.test.ts` hardcodes `holesChecked === 17` and `islandGreens === 1`. Those survive
   **only while hole 13 stays the island**. Under the card hole 13 is a 322-yard par 4, and an island
   green on a par 4 is not the archetype — so this probably moves, and both totals move with it.
3. Changing `PAR_MIX` changes every **generated** course, not just the authored one. `course.test.ts`,
   `routing.test.ts`, `courseLayout.test.ts` and `briefs.test.ts` all build generated courses.
4. `FIELD_FOR_PAR` and `DRAFT_BAND` are indexed by par; re-parring a hole changes which band it is
   drafted in. `briefs.test.ts`'s "leaves every hole enough room to reach its par band" will bite.
5. **Cup-in-water is now asserted cross-hole** (`authoredLayout.test.ts`). Task 3's placements were
   fitted against the *current* water; moving water can only relax that, but re-run it and believe
   the result rather than the reasoning.

---

## Then Task 4 — the road is a barrier

`courseBarrier.ts`, a cart clamp in `moveCartBody`, `treeline.ts`.

**The geometry already exists** — `AUTHORED_SOUTH_BOUNDARY` and `metresNorthOfBoundary` are exported
from `authoredLayout.ts` (ruled: it is traced off the same plat as the placements and must not drift
from them). Task 4 owns the inset, the clamp and the cart physics, not the line.

**County Home Road is diagonal** and the plan does not know that. The plan's Step 1 tests assert
`cart.position.z > bounds.minZ`, a clamp to a constant `z`, which would cut the course short in the
west and leave playable ground hanging over the road in the east. Treat the boundary as a line.

**Files Road**, the second boundary road on the south-east corner (plat px (915, 1120) → (960,
1245)), is still undecided — say which way you went and why.

Ruled already: **the second barrier test must not write `sim.cart.position` directly** —
`moveCartBody` fights it on the next tick and the test would measure the fight. Use three separate
`arenaSim()` instances steered to different x, or unit-test `clampToBounds` at three x values and
say so. **Do not delete the multi-point check** — "a wall with a gap passes a single-point test" is
why it exists. `arenaSim()` is `async`, returns `{ sim, terrain, holes }`, builds a **six-hole**
course at 8 m cells, `botCount: 0`, steps via `play(sim, [{ ticks, intent }])`. There is no
`idleIntent` helper.

## Then Task 5 — re-baseline

`npm run plan`, `plan:course`, `probe:terrain` (the old control was 374k cells / 82 MB; the authored
envelope is smaller — placed-field bounds are 1,520 × 1,331 m), then the gate. All three plan tools
(`coursePlan.ts`, `holePlan.ts`, `terrainProbe.ts`) were moved to the authored course in Task 3, so
they already render the shipped course.

## Then Task 6 — record it

`DECISIONS.md`, `COURSE_PIPELINE.md`, `HANDOFF.md`. Three entries owed beyond the plan's list:

- **the deferred half-disc apron**, with the measurement: all 11 pairs the apron forgives lie north
  of the clubhouse, so a half-disc is a no-op on this course, and `inspectLayout` is shared with the
  solver whose two nines need the full disc. The road-boundary assertion covers the real risk.
- **`inspectLayout` cannot see consecutive corridors crossing**, which is why
  `authoredLayout.test.ts` asserts it separately. Four pairs crossed on the first fit, one of them
  mid-fairway on hole 6.
- the routing-provenance entry in `LICENSES.md` already names **Caswell Pines Golf Club, North
  Carolina**, White tees.

---

## Then plan 1 — hazard-aware ownership tie-break, 2 tasks

Apply `.superpowers/sdd/2026-09-12-hazard-aware-ownership-tie-break-implementation/task-1-work-in-progress.patch`
(`git apply`, both files), re-run red/green, **re-measure the water area on the new routing** (the
8,824 m² and 9,993-cell figures describe a course that no longer exists), then the gate re-baseline
and the `DECISIONS.md` amendment.

It halted because its fix put hole 17's cup inside hole 9's pond on the *generated* routing, which is
now gone. **Check hole 13 first if anything goes red** — it is the island green and its cup sits at
the exact centroid of its own water polygon, structurally the same shape, safe only because the
containing pond is its own hole's. If the briefs work moves the island off 13, re-check whichever
hole gains it.

## Then plan 3 — Stage D pickups, 6 tasks plus one blocked

`docs/superpowers/plans/2026-09-12-stage-d-pickups-implementation.md`, 1,349 lines. Not started.

- **`pickupScatter.ts` must read the clubhouse from the layout**, never `Math.hypot(x, z) <
  CLUBHOUSE_APRON_M`. That idiom was only ever correct with the clubhouse at the origin, and
  `AUTHORED_CLUBHOUSE` is at `{ x: -243.4, z: -533.3 }`.
- `PICKUP_CHANNEL = 5` is verified free; 0–4 are taken.
- **`SPAWN_CLEARANCE_M = 60` makes some contention tests impossible** — `loadCourse` never spawns two
  carts inside one pickup's 3 m radius. Rig-order precedence is recorded as unasserted and tested one
  level down. **Do not "fix" this by teleporting carts**; `moveCartBody` fights a direct write.
- **Task 7 is blocked on a Blender session**, not code. `src/entities/graphs/pickups.json` does not
  exist. Task 5 ships placeholder geometry so nothing waits on it.
- Art-sheet deviations: `pickup-items-01.jpg` has cross-object scale wrong by ~¼ (bucket 0.80 m and
  cup 0.90 m each drawn filling a 1.00 m bar); `clubhouse-exterior-01.jpg` draws window mullions its
  prompt banned.

## Doc corrections still owed

- **`docs/TEST-AND-SPEC-PITFALLS.md` §1 gains a tenth instance.** `props.test.ts`'s distance-post
  assertion has a **4 m tolerance against a change of 0.16–0.44 m** — 25× too loose to detect it,
  which is why a plan and a session brief both confidently predicted a red that could not happen.
  Same class as instances 8 and 9. The 4 m is *real* (posts are offset laterally, so the nearest
  point on a curved centreline slides along the arc); the defect was the stale hardcoded
  `[137, 91, 46]`.
- **An eleventh is now owed too:** `inspectLayout`'s consecutive-hole exemption is an assertion
  scoped so broadly it could not see four crossed fairways. Same family as §1 — a check whose scope
  is one notch wider than its claim.
- **`docs/UI-SPEC.md:80` and `src/ui/pinMarker.ts:2` still say the pin readout is "whole metres".**
  It is yards. Fix in Task 6.
- `docs/HANDOFF.md` must be rewritten as a baton at the end.

---

## Traps that will cost you a session

- **Search, never trust a line number.** Plans here carry stale ones.
- **`npm run probe` is expected RED** on the one known driver-distance line. Not a regression unless
  a second line joins it.
- **Before `Write`ing a file, confirm it is new** — `git status` or `ls`. This repo nearly lost
  `matchScoreboard.ts` that way.
- **A render check is never evidence about simulation.** `npm test` and `probe` settle behaviour;
  `gate` and `smoke` settle presentation.
- **Do not accept an unevidenced green.** Two subagents were killed mid-task by rate limits in an
  earlier session, one a step before its green run. Regenerate red/green yourself if a worker dies.

---

## Then the PR

When all three plans' tasks are ticked and the docs corrections are in:

```
tsc --noEmit           clean
npm test               green   (use --testTimeout=30000; see the flakiness note at the top)
npm run gate           19/19 PASS
npm run smoke          PASS
npm run probe:terrain  PASS at its new control
npm run probe          red on the driver-distance line only
```

Plus the two things no command checks: **all eighteen regenerated hole plans reviewed against the
plat by a human**, and `docs/HANDOFF.md` rewritten.

The PR body should lead with the measurement that justified the change — *not one of the eighteen
holes on a real scorecard was legal under the old `CORRIDOR_BAND`* (and say "shorter than three of
the card's four par 3s", not "every real par 3" — the spec carries that error) — then the band split,
the yard boundary, the barrier, the re-authored briefs, and the pickups. Name `LICENSES.md`'s
routing-provenance entry explicitly: the routing is traced from **Caswell Pines Golf Club, North
Carolina**, White tees, and a reviewer should see that decision rather than discover it.

**Do not push or open the PR without the owner saying so.** Everything above is local.

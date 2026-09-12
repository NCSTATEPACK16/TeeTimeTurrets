# Cup ownership near the clubhouse apron — working stub

**Status: pre-grilling.** This file holds the feature statement, what the codebase already
provides, and the decisions that are still open. It deliberately contains no user stories, no
implementation decisions and no acceptance criteria — those are outputs of grilling, and writing
them now would mean inventing the answers.

Item 2 of 4 in this session's queue. Ordered after Stage D pickups by the user, but note the
coupling recorded under "Load-bearing facts" below.

---

## The feature, as stated

Three of eighteen cups read a neighbouring hole's surface material rather than their own — hole 9
reads `fairway`, hole 18 reads `rough`, hole 17 reads `water` — all inside the clubhouse apron
where the returning nines crowd. `docs/HANDOFF.md` frames the choice as: *"Next session should
either fix `weightsInto`'s ownership near the apron or explicitly decide three misdrawn cups are
acceptable and change the test's framing."*

So this is a decision, not only a bugfix.

---

## What the codebase already provides

**The bug is one comparison.** `weightsInto` (`src/sim/courseTerrain.ts:207-233`) runs one pass
over 18 `HoleContext`s. For each it computes `influenceLocal` (`:172-195`), then decides ownership
at `:217` by argmax of raw pre-cube influence, first-wins on ties, iterating in hole-index order.

**`influenceLocal` saturates at 1.0** — `if (weight >= 1) return 1`. Inside two overlapping
corridors near the apron, both holes return exactly 1.0, so the `>` test never fires and `best`
stays the **lowest-indexed** hole that saturated, not the hole whose cup it is. That is the entire
mechanism. The tie-break is undefined precisely where corridors overlap, which is the apron.

**`weightsInto` returns two things, and the split is blessed by design.** A continuous weight
vector (cubed, then normalised when the sum exceeds 1) *and* a discrete owner index.
`docs/DECISIONS.md:459-464` records this split deliberately. `:451-457` argues a point does not
belong to a field — but that argument is about **height**, not about discrete material.

**Who reads which half:**

| Call site | Uses |
|---|---|
| `courseSurfaces.ts:50` `surfaceAt` | owner only — `-1 → Rough`, else the owning hole's surface |
| `courseSurfaces.ts:57` `tuningAt` | owner |
| `courseSurfaces.ts:94` `weightsAt` | weights for green/corridor, **owner alone** for sand/water/bridge |
| `render/courseGround.ts:130` `biomeInto` | weights only, owner ignored |
| `render/courseGround.ts:149` `mowInto` | **owner only** — sets mow-stripe direction |
| `courseTerrain.ts:245` `heightAt` | calls it and **discards the owner** |

Heights do not depend on ownership. An owner-only fix cannot move geometry.

**`CLUBHOUSE_APRON_M` is 140** (`src/sim/courseGeometry.ts:128`) and is **layout-side only** —
used at `courseLayout.ts:537` (apron pairs exempt from the clearance check),
`courseRelaxation.ts:176` (apron pairs not pushed apart) and `tools/coursePlan.ts:98` (the dashed
circle). `courseTerrain.ts` never imports it. Terrain today has no concept of the apron at all.

**The test that holds the bug open.** `src/sim/courseWorld.test.ts:49-54` asserts the *correct*
behaviour under `it.fails`, with its rationale at `:37-48`: it inverts to red the moment the fix
lands, at which point the `.fails` is deleted rather than the test. `it.skip` would have hidden a
cup under water; asserting the broken values would have locked them in.

**Golden-file exposure is narrower than feared.**
- `npm run plan` / `plan:course` are **unaffected** — `tools/coursePlan.ts` and `tools/holePlan.ts`
  never import `courseTerrain`. SVGs stay byte-identical.
- `npm run gate` **is** exposed: `tools/gate/gateScene.ts:181-196` builds `course-ground` via
  `buildCourseWorld` → `createCourseGround`, which uses `weightsInto` for biome, mow direction and
  mask texels.
- But that subject builds **3 holes at seed `0x7ee71e5`** (`gateScene.ts:199-201`), so it contains
  no returning-nines apron. And since `heightAt` ignores the owner, an owner-only fix leaves
  `vertices` / `triangles` / `bbox` in `tools/gate-baseline/metrics.json` untouched. Only the
  pixel signature could move, and only where mow stripes or hazard masks flip.

---

## Load-bearing facts that reshape the design

1. **"Influence, not a mosaic" is not in tension with single ownership — the two already
   coexist.** The tension is narrower and more specific: the discrete channel's tie-break is
   undefined under saturation. That reframes this from "does the blend model need rethinking"
   to "what should the tie-break be".
2. **An owner-only fix is provably geometry-neutral**, because `heightAt` discards the owner. The
   grade invariant (3e-6, `DECISIONS.md:445-485`) cannot be disturbed by it. A fix that touches
   *weights* instead would move geometry and all three gate metrics, and would need re-checking
   against that invariant.
3. **`mowInto` and the hazard channel ride the same `best` as `surfaceAt`.** Whatever ownership
   becomes, it changes mow-stripe direction and hazard masks too — not just cup materials.
4. **This gates item 1.** Pickup placement is specified to ask `weightsInto` which hole a candidate
   point belongs to. Placing pickups on a known-wrong ownership answer near the clubhouse is what
   `HANDOFF.md` warns against. The user has chosen to spec pickups first; that ordering needs to be
   revisited during item 1's grilling or consciously accepted.

---

## Decisions settled — round 1 (2026-09-12)

1. **Fix it.** "Three misdrawn cups are acceptable" is closed as an option. The fix is one
   comparison and is geometry-neutral, so the cost does not justify living with wrong material
   under a cup.
2. **The tie-break is smallest normalised distance to the hole's spline.** A general rule, not a
   cup special-case: the corridor you are most centred in owns you. Rejected: cup proximity as a
   special case, an explicit apron precedence order, and raising the saturation ceiling.
3. **Owner only; weights do not move.** The bug lives in the discrete channel. The continuous
   channel behaves as designed, and touching it would move `vertices`/`triangles`/`bbox` and force
   a re-check against the 3e-6 grade invariant for no benefit.
4. **`mowInto`, `weightsAt`'s hazard channel and `surfaceAt` keep sharing one owner.** One notion
   of "which hole is this". A fix that corrected materials but left mow stripes pointing at a
   neighbouring hole would be visibly wrong in exactly the place just fixed.
5. **The gate subject is extended to cover the apron** rather than merely proving the existing
   3-hole subject is unaffected. `GATE_COURSE_HOLES = 3` falls back to `placeNineOnCircle` and has
   never exercised the returning nines. This is the bigger job, chosen deliberately for the
   coverage. **Consequence: a re-baseline is now mandatory and intentional**, not something to be
   avoided — the subject's geometry changes by construction.
6. **The `it.fails` test resolves by deleting `.fails` only.** No second test asserting ownership
   directly. The existing assertion through `surfaceAt` is held to be enough.

### Resolved by implication

- **`courseTerrain` does not learn about the apron.** Decision 2 selects a tie-break on spline
  distance, which is geometry-local and already computed. `CLUBHOUSE_APRON_M` stays layout-side,
  and `courseTerrain.ts` continues not to import it.

---

## Decisions settled — round 2 (2026-09-12)

7. **Normalised by the corridor half-width**, not raw metres. "Fraction of the way from centreline
   to edge" — the same quantity `influenceLocal`'s smoothstep is already built from. Raw distance
   would hand contested ground to whichever hole happens to be wider, which has nothing to do with
   whose hole a player is standing on. Rejected: raw metric distance; half-width plus `BLEND_WIDTH`.
8. **The gate subject goes to all 18 holes.** A subset containing the apron (1, 9, 10, 18) would
   still not be the real layout, because `courseRelaxation` solves the whole loop — a partial course
   is a different course. 18 is the only number that makes the subject mean what its name says.
9. **The extended subject stays inside `npm run build`.** The rule agreed was: keep it in the build
   if the extension lands under ~2× current gate wall time, otherwise split it to its own script.
   **Measured, so this is settled rather than conditional** — see below.
10. **The user reviews the re-baselined PNGs once, on the extension commit.** The subject changes
    shape entirely at 3→18, so this is a fresh baseline rather than a diff; automated comparison has
    nothing meaningful to compare against.
11. **The `it.fails` test resolves by deleting `.fails` only — confirmed — but the red is confirmed
    per-cup first.** Before the fix is finished, the tie-break change is run against the test and
    cups 9, 18 and 17 are each watched going green individually, rather than only observing the
    suite turn green. Red-before-green without adding a test.

### Measured, not assumed (2026-09-12)

`npm run gate` timed on this machine, with `GATE_COURSE_HOLES` temporarily set to 18 and reverted:

| | 3 holes (today) | 18 holes | Ratio |
|---|---|---|---|
| Gate wall time | 25.5 s | 29.5 s | **1.16×** |
| `course-ground` vertices | 56,868 | 251,328 | 4.42× |
| `course-ground` triangles | 111,400 | 490,056 | 4.40× |
| bbox x | 438.81 | 976.36 | 2.22× |
| bbox y | 11.68 | 12.59 | 1.08× |
| bbox z | 432.87 | 1196.25 | 2.76× |

At 1.16× the extension is far inside the 2× budget, so decision 9 resolves to **stays in the
build**. Every other subject was `PASS` at signature delta 0.00 in both runs; only `course-ground`
moved, which is the scoping evidence decision 3 predicted.

The bbox y ratio of 1.08 is worth noting in passing: an 18-hole course is only 8% taller than a
3-hole one, which is the flat-rough loose end (`HANDOFF.md`, "the course rough is flat overall")
showing up as a number. Not this feature's problem.

---

### The bake loop needs no change — measured, not assumed (2026-09-12)

`gateScene.ts:194` bounds the tiling at 5000 iterations, because "a tile that never finishes is a
bug, and a gate run that hangs on it reports nothing at all". The open worry was that 4.4× the
geometry would no longer reach steady state inside that bound, silently under-baking the subject
and pinning a half-tiled course into the new baseline.

Run at 18 holes with the bound raised to 40,000: **251,328 vertices and 490,056 triangles —
identical to the 5,000-iteration run.** The bake converges well before the existing bound. The loop
stays at 5000 and the gate extension does not touch it.

---

## Decisions settled — round 3 (2026-09-12)

12. **One `DECISIONS.md` entry covering both the tie-break rule and the gate extension.** The rule
    is what a future reader will most need — "why does the corridor you are most centred in own you"
    is not recoverable from the code — and the existing "influence, not a mosaic" section
    (`DECISIONS.md:445-485`) is exactly where someone would look for it and currently find nothing
    about the discrete channel. The gate extension goes in the same entry because it is the evidence
    the rule works. Rejected: two separate entries; no entry at all.

---

## Frontier: empty

Every branch of the design tree has been visited and answered by the user across three rounds
(2026-09-12). Shared understanding confirmed in the user's own message. Nothing in this design is
an assumption of mine.

Two questions that looked like decisions were settled as **facts** instead, by measurement rather
than by asking: the 18-hole gate cost (1.16×, so it stays in the build) and the bake-loop
convergence (identical geometry at 5,000 and 40,000 iterations, so the bound is untouched).

**Next step:** formalise into the full PRD via `write-a-prd`, then cut issues via `to-issues`.

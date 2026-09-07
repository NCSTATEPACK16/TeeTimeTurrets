# Handoff — next session

Written 2026-09-06, at the end of the session that landed dog-leg-aware routing — and that began
by finding the built game rendering nothing but sky.
Rewrite this file at the end of each session; it is a baton, not a log.

---

## Where things stand

**`COURSE_PIPELINE.md` §9 build order: steps 1–7 are done.** Step 7 landed this session; the Tier 2
notes below are from the session before it. The
generator now reads the briefs. The two defects §5.1 was written about are fixed and re-measured:

| Surface | Before | After |
|---|---|---|
| **water** | **37.5%** | **5.2%** — and 0.0% on the ten holes whose briefs ask for none |
| sand in the mown corridor | 3.6% | **0.00%**, every hole |
| rough | 42.8% | 77.5% (reclaimed from the flood) |

Sand geography was tightened in a follow-up pass: **92.0% of sand is on the fairway, 8.0% on the
rough's first cut, and 0.0% in the woods** (zero cells, all 18 holes). The bound is derived, not
written down — `WOODS_WEIGHT` (0.92) in `terrain.ts` has exactly two consumers that must agree:
`render/Trees.ts` plants at or above it, `sim/placement.ts` keeps every bunker's far rim below it.
Change the blend and the sand line follows the tree line automatically.

That pass also caught a defect worth remembering: **sand loses to both the green and water in
`surfaceAt`, so a bunker overlapping either shows no sand at all.** Hole 7's two greenside bunkers
sat inside its inside-elbow water and were invisible while `spec.bunkers.length` cheerfully
reported 2. Placement now runs after water and searches the corridor for ground clear of both. The
test that found it asserts a hole placing bunkers must actually *show* sand — the kind of claim
that is easy to assume and was false on 1 hole in 18.

Work is on `biome-palettes-from-sheets` (PR #6, open against `main`), which this stacks on.

**Verified at this commit:** `tsc` clean · 446 tests / 26 files · `npm run build` + scene gate pass
(5/5, mean delta 0.00) · `npm run plan` byte-identical across two consecutive runs · `npm run probe`
red on the one known line only (see Loose ends).

### What Tier 2 actually changed

Four `HoleSpec` fields, landed together because they shared the constants they replaced:

- `water: Polygon[]` — replaces "terrain below `waterLevel`". `waterLevel` survives only as an
  elevation: where the water plane renders and how deep a basin is cut.
- `bunkers: Ellipse[]` — replaces the `SAND_FREQUENCY`/`SAND_THRESHOLD` noise field, deleted.
- `green: Ellipse` — replaces `GREEN_RADIUS` about the cup.
- `corridor: number[]` per control point — replaces the global `HALF_WIDTH`.

New modules: `src/sim/hazards.ts` (ellipse/polygon point queries), `src/sim/placement.ts`
(brief → coordinates). Hazards are placed on each drafted candidate **before** validation, so a
hole whose water lands somewhere unplayable gets redrawn rather than shipped.

### Three decisions that departed from what §5 proposed

Read these before touching the validator — each one looks like a bug until you know why.

1. **Check 6 is not "the centreline is never inside a water polygon."** That was §5's own wording
   and it is unsatisfiable: holes 2, 13 and 15 are forced carries and an island green, whose whole
   design is a centreline crossing water. Check 6 is now **tee dry, and no contiguous wet run on
   the centreline longer than `DRIVER_CARRY_M` (69.5 m)**.
2. **There is no "is the cup wet" check**, deliberately. The green beats water in `isWaterAt`, so a
   cup is dry by construction. What makes an over-watered green unplayable is the carry, and the
   wet-run rule already measures that.
3. **Checks 3 and 4 skip samples inside water.** A legal crossing's bank is a 0.25 grade against
   check 3's 0.11 limit; sampling it would reject every forced carry as a slope defect.

`isWaterAt` in `course.ts` is the **single** definition of "is this point water", called by both
`surfaceAt` and `validateHole`. Do not re-test the polygons anywhere else — a validator that did
found the island green's cup underwater and rejected hole 13.

---

## What landed this session

**A blue rectangle.** The deployed game rendered sky and nothing else while `tsc` was clean, 446
tests passed and the scene gate passed 5/5. `placement.ts` derived a module-level constant from
`WOODS_WEIGHT` across the import cycle `course → placement → surfaces → course`; Rollup emitted the
initialiser after the reader, the minifier had made the `const` a hoisted `var`, so the read
returned `undefined` instead of throwing. Every bunker got NaN coordinates and `heightAt` returned
NaN everywhere. `WOODS_WEIGHT` now lives in `terrain.ts`, strictly upstream; the two driver
distances moved to `carry.ts` for the same reason; `tools/importCycles.test.mjs` fails the suite on
any value-import cycle in `src/**`. Full account in `TEST-AND-SPEC-PITFALLS.md` §6 — including why
no test in the suite could see it, and why `npm run smoke`, which *does* catch it, is not part of
`npm run build`.

**§9 step 7, dog-leg-aware routing.** The measured before-state was worse than the previous handoff
described: the apex offset was solved backwards out of the length residual, so bend existence,
direction and size were all accidents of the box. Seven of eight straightaways bent (hole 11 by
116 m at severity 0), three of four dog-legs bent the wrong way, hole 7's signature cape was dead
straight, and `severity` was read by nothing. Now `severity × DOGLEG_MAX_TURN` is the angle each leg
makes with the tee-to-cup line, s-curves get four control points, and the bearing is chosen from the
arc that fits rather than drawn blind. `src/sim/routing.test.ts` pins the mapping. Acceptance is
unchanged at 1.19 mean attempts over 720 draws, worst case 6 → 4.

---

## Next session — pick one of these two, they are not the same size

### Where the eighteen holes actually are, because this is the first thing anyone asks

All eighteen are generated at boot and every one of them is playable **right now, one at a time, by
URL**: `teetimeturrets.netlify.app/?hole=0` through `?hole=17` (0-based — `?hole=12` is hole 13, the
island green). `npm run plan` draws all eighteen to `docs/course/plans/`. Nothing about the course is
missing.

What is missing is a **round**. Four specific facts, in the order you will hit them:

1. `main.ts:34` calls `parseHoleIndex(window.location.search, …)` **once, at boot**. The hole index
   is never read again.
2. `Sim.loadHole(spec)` (`src/sim/world.ts:540`) already works and is tested — it swaps the terrain,
   surfaces, ground collider, targets, ball pool and bucket positions, and re-sizes cart health for
   the new par. **The simulation half of hole advancement is done.**
3. `RenderScene` builds its ground mesh once, in the constructor (`src/render/scene.ts:134`,
   `createGround(terrain, surfaces)`), and has no rebuild path. **This is the actual blocker.** It is
   why the comment at `main.ts:29` says switching holes still means a page reload.
4. Nothing carries a scorecard across holes and nothing transitions between them.

### Option A — `RenderScene.loadHole`, and a round (Phase 1.75)

The bigger piece, and the one that turns eighteen playable holes into a game. `Sim.loadHole` gives
you the sim side for free, so the first commit is small and self-contained:

- Add `RenderScene.loadHole(terrain, surfaces)`: dispose `this.ground` and `this.trees`, rebuild both
  from the new terrain, swap the scene children, and reset `cameraTarget`. `dispose()` already frees
  the right things (`scene.ts:190`) — follow it exactly or the session leaks a heightfield mesh per
  hole, which at 48,841 vertices a hole is not subtle.
- Then `sim.loadHole` + `render.loadHole` behind a temporary key (advance on `N`) proves the pair
  works before any screen work exists. That is the whole first commit, and it is testable in smoke:
  drive, press N, assert the terrain changed and no console errors.
- Only then the Phase 1.75 screen flow — `ScreenManager`, `src/sim/round.ts` for the per-hole card,
  `ResultsScreen`. `ROADMAP.md` Phase 1.75 has the full checklist.

**Watch for:** cart health is `2 × par` and `loadHole` re-sizes it, so advancing from a par 3 to a
par 5 heals the player. That is a design question nobody has answered, not a bug — decide it out
loud rather than letting `setMaxHealth` decide it.

### Option B — §9 step 8, a failed brief that names itself

The smaller piece, and the one the generator is currently missing. `generateHole` throws
`exhausted 32 attempts; the last rejection was check N: <reason>`, which names the last *candidate's*
problem rather than the *brief's*. Aggregate rejections across all 32 attempts, report the dominant
check, and name the brief field implicated.

Step 7 made this sharper rather than softer: its interim version exhausted the sampler on holes 9
and 11, and the useful sentence was not "check 2 again" but *"a par 5 straightaway cannot be 375 m
inside a 300 m field at any bearing"*.

**Carry this into it:** `CORRIDOR_BAND[5].max` (375 m) exceeds what `FIELD_FOR_PAR[5]` (300 m) can
hold straight even on the diagonal (342 m). `draftHole` squeezes rather than throwing, and par
survives, but the authored numbers still contradict each other and step 8 is the feature that would
say so out loud. Fixing it is a design call — a larger par-5 field costs heightfield cells (`cells`
tracks `fieldSize`), a lower band top costs par-5 length.

### Not optional, whichever you pick

`npm run smoke` is the only gate that catches bundle-only breakage — the class of bug that shipped a
blue rectangle to production this session — and it is **not** part of `npm run build` (which is
`tsc && vite build && npm run gate`, and the gate renders five harness rigs, never a course). Adding
it costs about 40 s per build. It was left out of this session's PR deliberately because it is a
pipeline decision, not part of a fix.

---

## What still needs a human with an image model

`COURSE_PIPELINE.md` §7 and `ASSET_PIPELINE.md` §8 hold the prompt blocks; both name their consumer,
which is the rule that decides whether an image is worth generating at all.

| Prompt | Consumer | Status |
|---|---|---|
| §7.1 biome style sheets ×3 | `BIOMES` in `src/render/biomes.ts` | **Done.** |
| §7.2 prop silhouette sheet | `ASSET_PIPELINE.md` §2 "Course props", §5 | **Done.** `docs/concept/reference/prop-silhouettes-01.jpg` |
| §8.1 orthographic turnaround | `ASSET_PIPELINE.md` §5 cart blockout | **Done.** `docs/concept/reference/cart-turnaround-01.jpg` |
| §7.3 hole styling, image-to-image | mood and marketing only | **Not run.** Needs `npm run plan:png` first. |
| §7.4 key art | `public/`, `og:image`, store page | **Not run.** Ordinary marketing. |
| §8.2 image-to-3D | a Blender reference object, never the repo | **Not run.** Only when a blockout stalls. |

**§7.3 is worth running now in a way it was not before.** The plans finally show designed holes
rather than flooded noise, so a conditioning image of hole 7, 13 or 18 is a picture of a real golf
hole. Run `npm run plan:png` → `tools/.plan-png/hole-NN.png`.

Read `docs/concept/reference/README.md` before modelling from either new sheet. The four deviations
that change what a modeller does: the turnaround has **no shared baseline and no uniform scale**
across panels (silhouette reference, not a blueprint); its **SIDE view faces left** against the
prompt; its **labels print grid positions, not view names**; and **`club_bag` is missing** from all
four views though §2.1 lists it as one of eight material slots.

### How to prompt, in short

- **Paste the prompt blocks unmodified.** Each has been through at least one failure that shaped
  its wording.
- **Open every prompt with the art-style block** from `concept/hole-shot-prompts.md` §1 — that doc
  is superseded but that block survives. Two exceptions, both because it describes a *scene*: §7.1
  uses a trimmed preamble and §8.1 uses none.
- **Never ask for a hex code.** Image models draw text as pixels: on the first parkland sheets not
  one printed code matched its swatch, several were the literal `#RRGGBB`, and a magenta `#C11ACF`
  sat under a sky-blue swatch.
- **Never ask for layout, routing, or teebox sightlines.** Layout is `npm run plan`, correct by
  construction. Sightlines are a camera question only the built hole can answer.
- **Expect labels and scale to go first.** Both new sheets lost a labelling or scale requirement
  while getting the art right. State those as their own lines, not as clauses in a layout sentence.
- **Nothing generated ships as geometry.**

---

## Also available but not started: the asset pipeline

Blender and its MCP addon were confirmed running, and the cart reference is in hand — but
`ASSET_PIPELINE.md` §10 steps 2–3 come first and neither is started:

2. **The primitive-graph runtime assembler and the §4.3 Blender exporter.** Verify the Z-up→Y-up
   conversion on an asymmetric test object before anything real depends on it.
3. **Port `GolfClub.ts` to a graph** as the proof — a correct port produces an identical scene-gate
   screenshot, which is a real test rather than a claim.

Step 1 (the `AGENTS.md` §1.1 edit) is landed. Modelling the cart is step 4 and should not start
before 2 and 3, or the graph format gets designed around one asset.

---

## Loose ends carried forward

- **Driver roll/carry ratio is 0.63 where real golf is ~0.15.** Open since Phase 0. The cause is
  loft, not damping: at 13° the trajectory is near-symmetric so the ball lands at a 13° descent
  angle and skips. Raising `loftDeg` toward 18–20° is the lever. It is club balance, so it wants a
  play session rather than more arithmetic.

  **`npm run probe` exits 1 on this one check alone** — re-verified this session:
  `driver distance FAIL - 106.7 m total (65.3 carry + 41.4 roll) vs REFERENCE_CARRY_M 129,
  drift 17.3% (limit 15%)`. Everything else passes, including course playability. Do not read a red
  probe as a regression without checking it is still only this line.
- **`DRIVER_CARRY_M` moved from `tools/holePlan.ts` to `src/sim/course.ts`.** Check 6 needs it, and
  a second copy of a measured constant is the failure `AGENTS.md` names.
- **Hazard outlines are rectangles.** Honest geometry, correct to the metre, but a real bank is
  irregular. Jittering the vertices is cheap and cosmetic; left undone on purpose because a
  rectangle makes a placement bug obvious in a plan and a lobed blob hides one.
- **A greenside bunker may end up on the other side.** When neither bank at any sampled `t` is
  clear of water, placement takes the opposite side rather than shipping an invisible bunker. A
  compromise on the brief's intent. Step 7 was expected to relieve it and visibly does on hole 7,
  whose lake now fills a real elbow instead of sprawling across a straight corridor — but the
  compromise path still exists and is still reachable.
- **Narrow corridors are closer to the camber limit.** Check 4's arm now follows the corridor's own
  width, so a `dense` hole (10 m) samples at 15 m rather than 20 m and the same terrain reads as a
  steeper cross-slope. All eighteen holes still generate inside `MAX_ATTEMPTS`, but there is less
  headroom on 5, 12 and 17 than elsewhere. If a future terrain change starts exhausting the
  sampler, this is the first place to look.
- **`docs/course/plans/` is 2.9 MB of generated SVG**, committed as reviewable design docs while
  `tools/.plan-out/` and `tools/.plan-png/` are gitignored. Flagged on PR #6.
- **Links' corridor edge is present but soft** — 26.6 luminance on a near-identical hue. Worth a
  look in play.
- **`terrainMobility.ts` port** (Phase 2, 159 lines, MIT) still open. Needs a `NOTICE` entry.
- **The 00–15 shot list is still not in the repo**, and `docs/concept/README.md` cites it as the
  provenance for sixteen tracked images. Either check the prompts in or stop citing them.

---

## House rules that catch people

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. It
  is what lets `npm run probe`, `npm run plan` and the server import the sim unmodified.
- **A render check is never evidence about simulation** (`AGENTS.md`). `npm test` and
  `npm run probe` settle physics; `npm run gate` and `npm run smoke` settle presentation.
- **`npm run plan` after every course change.** A change that does not show up in the plans either
  did nothing or did something you did not intend. A render-only change that *does* move a plan
  means something leaked into `src/sim/`.
- **`npm run plan` wipes `tools/.plan-out/`** (`emptyOutDir: true`), which is why the PNGs live in
  `tools/.plan-png/` next door. Do not move them back.
- **Read `docs/TEST-AND-SPEC-PITFALLS.md`.** This repo has a documented history of tests that pass
  for the wrong reason, and it happened three times in the last two sessions — each caught only by
  deliberately breaking the code and watching the test *not* fail:
  - `briefs.test.ts` imported `BLEND_WIDTH` from `course.ts`, which does not re-export it. The
    constant arrived `undefined`, `half` was `NaN`, and `NaN < min` is false, so the check reported
    success on every input. Vitest transpiles without type-checking.
  - Two Tier 2 tests asserted "this point is water" / "this ground is below the water line" on a
    fixture where both were already true for the old reason. Both had to be made *differential* —
    same point, with and without the polygon — before they tested anything.

  **Get a test to fail for the right reason before you make it pass.**
- **Read `DECISIONS.md` before touching ragdolls.** Several plausible Rapier fields are inert no-ops
  in the JS bindings.

# Handoff — next session

Written 2026-09-09, at the end of the session that built Stage B: the eighteen holes as one
piece of ground. Rewrite this file at the end of each session; it is a baton, not a log.

---

## Where things stand

**`distance-plates-and-course-map` is merged** — it landed on `main` as PR #18, so the map, the
nameplate rules and `courseLayout.ts` are shipped and no longer branches to reason about.

**`arena-course-terrain`** carries this session's seven commits. Everything below assumes it is
merged; if it is not, check before building on it.

**Verified at the tip:** `tsc` clean · **826 tests / 55 files** (was 788/51) · `npm run gate`
**19/19 PASS** mean delta 0.00, two new subjects · `npm run smoke` **PASS**, all four memory
gates · `npm run plan` all 18 SVGs byte-identical · `npm run probe:terrain` **PASS** ·
`npm run probe` red on the one known driver-distance line only.

### Stage B is done. Stage C is next, and `DECISIONS.md` has both halves of the argument

Read § "Arena mode, and a course that is one place" for the mode, and § "Assembling the course:
influence, not a mosaic" for how the ground was built and what a later change has to preserve.

### What this session shipped

| Commit | |
|---|---|
| `2b598d1` | `tools/terrainProbe.ts` — measure one Rapier heightfield at course scale |
| `2a91c75` | the course frame into `src/sim/`, and the rough octaves shared |
| `554ef14` | `courseTerrain.ts` — eighteen holes as one heightfield |
| `faf7421` | the probe re-pointed at the real assembly |
| `95a6eb0` | `courseSurfaces.ts` — the same blend over materials |
| `9bdd827` | `playfield.ts`, and `Sim.loadCourse` |
| `e1054ce` `3d27349` | the ground's gate subject, then `courseGround.ts` |

**The measurement came first and it changed a number.** `DECISIONS.md` reasoned 2 m cells over a
square 1,300 m course; the real thing is **1056 × 1613 m, 426k cells**, sampled in 951 ms, built
into a collider in 4 ms, **1.19 ms mean per tick** with 24 KCC carts on it. The 4 m fallback is
not needed and neither is streaming. **1 m is the row that fails** — 3.9 s to sample, over the
build budget — which is how the sweep shows the probe responds to cell size rather than
reporting a constant.

**The assembly is influence-weighted, not a mosaic.** Inside a corridor the ground is exactly
what stroke play builds, to the last decimal; between corridors it is course rough; hazards hold
their own ground where the corridor has let go of it. Weights are cubed so a neighbouring hole
cannot drag camber onto a fairway. `courseSurfaces.ts` blends materials over the same weights.

**`Sim` stands on a `Playfield`.** Four questions — height, material, boundary, heightfield —
moved behind an interface with two implementations, so `loadCourse` swaps the world without `Sim`
knowing which mode it is in, and `isPastFieldEdge` means something in a mode with no field edges.

**The ground renders as tiles that refine on approach**, 8 m everywhere at construction and 2 m
where the camera is, built a few rows per frame. The limit is *build* time, not draw calls:
`weightsAt` is 3.0 µs, so stroke play's 0.5 m mask over the course would be ten minutes.

---

## Next session — Stage C, the mode itself

### Stage C — mode and scoring

`src/sim/match.ts` (teams, points, strokes, timer, MVP), `src/sim/spawn.ts` (random-tee
selection, respawn delay, spawn protection), `src/sim/matchConfig.ts` (**every tunable in one
module** — the user chose to set match length, team sizes, respawn and pickup rates from
playtesting rather than reason them into existence, so ship placeholders and say so).
`HudState`/`HudSource` gain arena fields; the golf fields stay. A new `MatchResultsScreen`;
`scorecard.ts` is not touched.

Size every player-indexed structure for **24 players**. That is a Phase 5 target and this ships
single-player against bots, but the data model is the part that would be a rewrite later.

**Three things Stage B left for Stage C on purpose:**

- **Wiring `courseGround` into `RenderScene`.** The scene takes one `Terrain` today and uses it
  for the chase camera's ground clearance, the trees, the props and the water plane. Choosing
  between a hole and a course is mode plumbing, which is what `match.ts` brings.
- **Spawns.** `loadCourse` re-tees every cart onto ground that exists and no further, so they
  start wherever hole 1's tee lands in the course frame — by the clubhouse. `spawn.ts` is the
  answer, and it wants `toCourseFrame(placement, spec.tee)` per hole.
- **The furniture.** The ball, the pin and the targets are still stroke play's and are still
  built on `Sim.terrain`. Arena has no played ball and no pin.

### Stage D — pickups

`src/sim/entities/Pickup.ts` is 33 lines defining one hardcoded ammo `Bucket`. It becomes a typed
collection — bucket = ammo, drink = shield, hot dog = health, per concept sheet `06` — scattered
course-wide from a seeded PRNG (**never `Math.random()` in `src/sim/**`**), re-rolled per match,
weighted near flags and valid anywhere drivable. Plus the striped food cart as a prop that spawns
pickups around itself. `Sim.pickups` already exists as a readonly getter and the map already
draws whatever it returns. `CourseTerrain.weightsInto` is how to ask which hole a candidate
point belongs to.

### Stage E — Blender landmarks

Clubhouse and 18 tee signs. **The constraint that decides the shape of this work:**
`docs/ASSET_PIPELINE.md` forbids `.glb` for anything with a collider, enforced by
`tools/decorBoundary.test.mjs`. The user chose a detailed `.glb` shell **plus** a proxy-box
`PrimitiveGraph` collider, **both exported from one `.blend` in one pass** by `ttt_authoring.py` —
one file, one edit, two outputs, so they cannot drift. Add a `collision` collection of crude
invisible proxies tagged `ttt_kind`/`ttt_params`/`ttt_slot` inside the detailed model.

Sign faces are a **third asset class**: a PNG texture, not primitives and not mesh. `npm run plan`
already renders each hole's plan and `tools/planPng.mjs` already rasterises SVG to PNG — extend it
to emit 18 sign-sized images. Record the new class in `ASSET_PIPELINE.md`.

---

## The tests worth reading before you write another one

**Nine of `courseTerrain`'s ten tests were red against a stub, and the tenth is why the first one
means anything.** It asserts that ground out in the rough is *not* the hole's own — the control
that a `heightAt` forwarding every query to the nearest hole would fail.

**Two of this session's tests passed for the wrong reason and were caught by mutating the
finished module, not by the red run.** "The blend lands between the two holes" passes against
stacking, because a sum of one negative height and one positive one usually does land between
them; it asserts the mean now. "Every tile hangs a skirt" passed against a tile with no skirt at
all, because `toBeLessThanOrEqual` is satisfied by equality; it counts the vertices that hang
now. **Mutation is the check that found both.** Four mutations of `courseTerrain`, three of
`courseSurfaces`, three of `Sim`'s arena wiring and four of `courseGround` each fail a test.

**Where the assembly could only be judged against the thing it assembles, it is.** The steepest
corridor on the course is compared with the steepest that same corridor has in stroke play —
equal to 3e-6 — rather than against a number someone chose. Same for the surface tuning across a
join, and same for the probe's cell-size sweep.

**A measurement has validity guards or it is a number.** `terrainProbe` fails the run if the
carts were not grounded ≥ 90% of ticks or did not travel ≥ 40% of free speed. They earned it
immediately: the first run reported a cheerful 0.81 ms on a control whose carts had been fanned
off the edge of the field and were in free fall, querying no ground at all.

**The gate now covers the ground.** `hole-ground` was added *before* the shader was touched,
which is what proves the extraction into `groundShader.ts` changed nothing (mean delta 0.00).
`course-ground` found both skirt bugs — normals shared with the rim drew a dark grid over the
whole course, and a doubled winding left the skirt's own normals cancelling to black.

---

## Loose ends this session added

- **The scene gate's `course-ground` subject no longer exercises the routing it appears to.**
  `GATE_COURSE_HOLES` is 3, and at three holes the relaxed layout misses its 31 m return threshold,
  so `placeNineWithFallback` falls back to `placeNineOnCircle`. Its placements are bit-identical to
  the pre-relaxation merge-base and its nine-ending cup sits at exactly 30.00 m; the real 18-hole
  course closes at 25.07 m and does use relaxation. So the subject is a true geometry baseline and
  a green one, but it says nothing about the relaxation or the returning belt — the routing is
  covered by `courseLayout.test.ts` alone. Raising the subject to nine holes would close the gap
  and costs a reviewed re-baseline; the subject's own comment argues for three on legibility
  grounds, so it is a trade, not an oversight. This is `TEST-AND-SPEC-PITFALLS.md` §1 again: ask
  what the passing gate actually loads.
- **`courseGround` is not in the scene yet.** It is built, tested and gated; nothing draws it.
  See Stage C above.
- **Bridge is still not in the ground splat.** The mask's four channels are green, corridor, sand
  and water, and packing a fifth into a shared channel puts a ring of false sand around every
  pond under a linear filter. A second sampler is the honest fix and it was not worth it before
  the mode exists. Still `weights.bridge` computed and read by nobody.
- **A near tile costs ~65 ms of building**, spread at 2.5 ms per frame, so about 26 frames to
  refine one tile. Fine while driving; visible if you teleport. Stage C's respawn is a teleport.
- **Tiles are never freed.** Driving back the way you came is the common case in a match, and a
  near tile is a third of a megabyte. At 54 tiles that is ~18 MB if a match visits all of them.
- **The course rough is flat overall** — every hole's field sits at its own local zero, so there
  is no course-scale macro relief between holes. A low-frequency term added to the rough and to
  every hole's height would fix it and would move every corridor grade, so it is a decision.
- ~~**`courseLayout` holes are straight chords around a circle**, more polygonal than a real
  course.~~ Superseded: the shipped routing is three out-across-back lobes per nine, relaxed to
  close and held in shape by `satisfyReturningBelt`. Holes are still straight chords *within* a
  lobe, so the jitter question stands; the ring it described is gone.
- **Hole 9's corridor crosses hole 1's near the clubhouse.** Inside the apron, so the clearance
  rule forgives it by design. Worth a look now that you can drive it.
- **Teams are hardcoded `enemy`** in `RoundScreen`. Real sides arrive with `src/sim/match.ts`.

---

## Loose ends carried forward

- **Driver roll/carry is 0.63 where real golf is ~0.15.** Open since Phase 0, carried in nine
  handoffs. The cause is loft, not damping: at 13° the trajectory is near-symmetric so the ball
  lands at a 13° descent angle and skips. Raising `loftDeg` toward 18–20° is the lever. **Worth
  actually scheduling.** `npm run probe` exits 1 on this one check alone. Do not read a red probe
  as a regression without checking it is still only this line. Note that raising `loftDeg` moves
  the swing clearance — the putter's 3° currently caps the follow-through.
- **Whether a bridged carry should count as playable in `validateHole`.** Relaxing the wet-run
  check regenerates the whole course — par, corridor, field size and acceptance all move. Own
  spec, own play session.
- **Cart health is `2 × par` and `Sim.loadHole` re-sizes it**, so advancing par 3 → par 5 heals
  the player. Still unanswered. **Arena has no par**, so Stage C has to decide this out loud
  rather than letting `setMaxHealth` decide it.
- **The ball still leaves at the top of the backswing, not at impact.** `SWING.downswingSeconds`
  is the knob; making it literally true buys accuracy with input latency on every shot.
- **`CHASE_HEIGHT` is 3.6 m and the rider is hidden under the roof.** Wants a play session.
- **`npm run smoke` is still not part of `npm run build`.** Run and passed this session. Still the
  only check that catches bundle-only breakage. ~40 s.
- **Draw calls per cart are 78** (52 cart + 26 rider), player and every bot. At 24 carts that is
  1,872 draw calls, and the course ground adds 54 more. **Look at this during Stage C.**
  `mergeGraphInstances` is the tool, and bots are n copies of one graph; the player's cart cannot
  use it without losing clubhouse recolouring.
- **Railings are decoration and a cart drives through them.** Consistent with D5.
- **Paint is only asserted to stay out of the sim at the data level.** Nothing drives a purchase
  end to end.
- **Coins and loadout are page-scoped** and reset on reload — BACKLOG #48.
- **Hazard outlines are rectangles.** Honest geometry, left undone on purpose.
- **§9 step 8, the self-naming failed brief**, still unbuilt. `CORRIDOR_BAND[5].max` (375 m)
  exceeds what `FIELD_FOR_PAR[5]` (300 m) holds straight even on the diagonal (342 m).
- **`terrainMobility.ts` port** (Phase 2, 159 lines, MIT) still open. Needs a `NOTICE` entry.
- **The 00–15 shot list is still not in the repo**, and `docs/concept/README.md` cites it as
  provenance for sixteen images. Check the prompts in or stop citing them.
- **`docs/course/plans/` is ~2.9 MB of generated SVG**, committed as reviewable design docs.

---

## House rules that catch people

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. It
  is what lets `npm run probe`, `npm run probe:terrain`, `npm run plan`, `npm run plan:course` and
  the server import the sim unmodified. Everything Stage B added lives there and stays clean.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  physics; `npm run gate` and `npm run smoke` settle presentation.
- **`npm run plan` after every course change**, `npm run plan:course` after every layout change,
  and **`npm run probe:terrain` after any change to the assembly** — the sampling cost is the part
  that moves, and it is what the renderer's tiling is sized against.
- **Get a test to fail for the right reason before you make it pass — and where the code came
  first, mutate it.** This session's two wrong-reason tests were both caught by mutation and
  neither by a red run.
- **`mergeGraph` bakes colours into vertices**, so a merged graph cannot be recoloured by slot.
- **`Box3.setFromObject` walks the subtree.** Both cart test files carry an `ownBox` helper.
- **Read `DECISIONS.md` before touching ragdolls.** Several plausible Rapier fields are inert
  no-ops in the JS bindings.
- **`.glb` is forbidden for anything with a collider**, enforced by `tools/decorBoundary.test.mjs`.
  This is the rule that shapes Stage E's clubhouse, and it is not negotiable by convenience.

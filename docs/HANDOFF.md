# Handoff — next session

Written 2026-09-09, at the end of the session that built the course map and placed the eighteen
holes. Rewrite this file at the end of each session; it is a baton, not a log.

---

## Where things stand

**`course-props-crossing` is merged** — it landed on `main` as PR #17, so the drivable crossing is
shipped and no longer a branch to reason about.

**`distance-plates-and-course-map`** carries this session's six commits, rebased onto `main` and
opened as a single PR. Everything below assumes it is merged; if it is not, check before building
on it.

**Verified at the tip:** `tsc` clean · **788 tests / 51 files** (was 726/46 at the branch point) ·
`npm run gate` **17/17 PASS** mean delta 0.00 · `npm run smoke` **PASS** including all four memory
gates and eight new assertions · `npm run plan` all 18 SVGs byte-identical · `npm run probe` red on
the one known driver-distance line only, acceptance 84.0% (168/200) unchanged.

### Read `DECISIONS.md` § "Arena mode, and a course that is one place" before anything else

This session made the largest scope change since Phase 0, and the reasoning is recorded there
rather than repeated here. In one paragraph: there is now a second mode — a timed team deathmatch
across all eighteen holes joined into one drivable course, with **kills as points** and **deaths as
strokes**, fewest team strokes winning and MVP going to most kills. No played ball, no scorecard,
no par. Stroke play is untouched and its fate is **explicitly deferred**, not decided.

### What this session shipped

| Commit | |
|---|---|
| `f33a4ad` | Nameplate distance, team colours, line-of-sight rules |
| `a39d147` | Geometry extraction — one marching squares, shared by plan and map |
| `5d84159` | The `M` course map |
| `36fa5e6` | Map sampling resolution, and building it lazily |
| `488237b` | `courseLayout.ts` — eighteen holes placed, and `npm run plan:course` |

**Plates gained a distance and a reason to hide.** Under 100 m exact, to 300 m rounded to 25 and
marked approximate, past 300 m no number at all — a plate reading the same string for everything
beyond 300 m tells you nothing. Allies render through terrain; enemies render only in line of sight
and fade over a second once it breaks. The rules live in `src/ui/plateState.ts`, DOM-free and in
the node suite, the same split `hudState.ts` makes from `hud.ts`.

**Line of sight is a heightfield march, not a Rapier raycast** (`src/sim/lineOfSight.ts`). The
physics world holds carts, the ball, the pin and props, so a ray fired into it is blocked by a
passing cart — which is not what "can I see through that hill" asks. It is measured **cart to cart,
not camera to cart**: the chase camera floats 3.6 m above and behind, so a ridge the cart is
genuinely hiding behind reads as clear from the camera.

**The map draws from the same functions as the committed plans.** `tools/holePlan.ts` already
computed surface fill, contours and the corridor; rather than write marching squares a second time
for a canvas, the geometry moved to `src/sim/mapGeometry.ts` and holePlan formats what it returns.
All 18 plan SVGs are byte-identical across that extraction, which is the whole proof it was
faithful.

**`M` cycles closed → the hole you are on → the whole course → closed**; `Escape` closes from
anywhere. It lives inside `RoundScreen`, because `ScreenManager` tears one screen down to show
another and has no overlay concept. The toggle is a listener rather than a `PlayerIntent` — opening
a map is not something the sim needs to know.

**The eighteen holes now know where each other are.** `src/sim/courseLayout.ts`, data only. On the
real generated course: **728 × 1231 m**, every green **30.0 m** from the next tee, hole 9 finishing
30 m from the clubhouse and hole 18 120 m, closest two corridors off the apron **126 m**, **zero
conflicts**. `npm run plan:course` draws it.

---

## Next session — Stage B, and do the measurement first

The plan for the rest of this PR is five stages. **A is done.** B, C, D and E are below, in order.

### Do this before writing any of Stage B

**Measure one Rapier heightfield at course scale.** A 1,300 m course at 2 m cells is ~422k collider
cells and ~845k ground triangles. Those numbers are *reasoned, not measured* — build one, time its
construction and its step cost, and check the memory. `AGENTS.md` and
`TEST-AND-SPEC-PITFALLS.md` §3 both say the same thing about trusting docs over a probe, and this
is exactly that situation. **If it fails, 4 m cells is the fallback** (~106k cells, ~211k triangles)
and it is a constant, not a rewrite. Do not build tiled physics streaming without a measurement
saying you need it — that machinery was designed out on purpose once the ball left the mode.

### Stage B — the contiguous terrain

- `src/sim/courseTerrain.ts` — one 2 m heightfield assembled from the placed hole fields plus
  interstitial rough, blended at the joins. **Fields overlap by design**; the assembly is base noise
  with every hole's corridor carved into it, and overlapping carves simply both apply.
- `src/sim/courseSurfaces.ts` — course-wide surface lookup delegating to per-hole `surfaces.ts`
  through the layout transform. `toCourseFrame` in `src/ui/mapCamera.ts` is the transform; it is
  tested and it rotates about the hole's own centre.
- `src/render/courseGround.ts` — LOD ground mesh. `src/render/ground.ts:82-90` builds one
  `PlaneGeometry` per hole today; this is the course-scale analogue.
- `src/sim/world.ts` — arena variant: one course collider (cf. `:487`), and perimeter out-of-bounds
  replacing `isPastFieldEdge()` (`:747`, `:1180`), which has no meaning without field edges.

### Stage C — mode and scoring

`src/sim/match.ts` (teams, points, strokes, timer, MVP), `src/sim/spawn.ts` (random-tee selection,
respawn delay, spawn protection), `src/sim/matchConfig.ts` (**every tunable in one module** — the
user chose to set match length, team sizes, respawn and pickup rates from playtesting rather than
reason them into existence, so ship placeholders and say so). `HudState`/`HudSource` gain arena
fields; the golf fields stay. A new `MatchResultsScreen`; `scorecard.ts` is not touched.

Size every player-indexed structure for **24 players**. That is a Phase 5 target and this ships
single-player against bots, but the data model is the part that would be a rewrite later.

### Stage D — pickups

`src/sim/entities/Pickup.ts` is 33 lines defining one hardcoded ammo `Bucket`. It becomes a typed
collection — bucket = ammo, drink = shield, hot dog = health, per concept sheet `06` — scattered
course-wide from a seeded PRNG (**never `Math.random()` in `src/sim/**`**), re-rolled per match,
weighted near flags and valid anywhere drivable. Plus the striped food cart as a prop that spawns
pickups around itself. `Sim.pickups` already exists as a readonly getter and the map already draws
whatever it returns.

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

### Before the PR

- **`docs/ROADMAP.md`** — re-sequence for arena mode; note stroke play's status is open.
- **`docs/ARCHITECTURE.md:33`** — "Sim owns one hole" now holds for stroke play only.
- **`docs/UI-SPEC.md`** — H8 is built (mark it); H13 needs the distance tiers and team rules.
- **`docs/ASSET_PIPELINE.md`** — the sign-face texture class.
- `DECISIONS.md` is **already written** for this work. Do not write it twice.

---

## The tests worth reading before you write another one

**Three times this session, the first red run had assertions passing against a stub.** Every one was
a negative check — `visible === false`, `distanceText === ""`, `Number.isFinite(...)`, and once
`toEqual` between two empty results — satisfied by an implementation that computed nothing. That is
`TEST-AND-SPEC-PITFALLS` §1, and it is now four sessions running. `plateState` was 9 failed / **4
passed** on its first run; `mapCamera` was 12 / **2**; `courseLayout` was 15 / **1**.

**The fix is a positive control in the same test.** Assert the negative *and* a case that differs by
exactly one variable and comes out the other way. After that, all three suites failed completely
against a stub, which is what a red run is supposed to mean.

**Where code came before its tests, mutate instead.** `mapGeometry` was extracted from working code,
so it was never going to fail honestly. Flipping the corridor normal, removing the run merge,
swapping the contour crossing axis and dropping the nice-interval snap each fail at least one test;
all twelve pass with the mutations reverted. `lineOfSight` was checked against an always-`true`
**and** an always-`false` stub — 7 of 7 red for each, so no constant return passes any of it.

**A canvas needs pixels, not a visible element.** The map's smoke check counts non-background pixels
off the canvas, because a blank panel and a drawn course are the same DOM. Removing the surface fill
takes it from 188,356 to 21,295 of 284,089 and fails; that was watched before it was kept.

**The plan SVGs are the regression check on `mapGeometry`.** They only work as one because the
arithmetic order was preserved — the crossing is still computed in world space, then projected, then
rounded, so nothing rounds twice. Confirmed discriminating by perturbing the corridor half-width by
1 cm and watching all 18 files change.

---

## Loose ends this session added

- **`courseLayout` holes are straight chords around a circle.** Valid, closing, conflict-free — and
  more polygonal than a real course, which meanders. Jitter or a non-circular loop is tuning, and
  wants the terrain to exist first so it can be judged in play rather than in an SVG.
- **Hole 9's corridor crosses hole 1's near the clubhouse.** Inside the apron, so the clearance rule
  forgives it by design. Two fairways crossing is unusual on a real course; on the apron it is
  survivable. Worth a look once you can drive it.
- **Teams are hardcoded `enemy`** in `RoundScreen`. Real sides arrive with `src/sim/match.ts`; the
  comment says so at the call site.
- **The map holds a single-entry course** — `Sim` still loads one hole at a time, so `buildMapHole`
  returns one. The placement frame exists so Stage B is a longer array rather than a rewrite. Wiring
  `courseLayout` into it is a few lines and is the first visible payoff of Stage B.
- **`npm run plan:course` output is committed** (`docs/course/plans/course.svg`, 1 file) on the same
  argument as the 18 hole plans: reviewable design docs.

---

## Loose ends carried forward

- **Driver roll/carry is 0.63 where real golf is ~0.15.** Open since Phase 0, carried in eight
  handoffs. The cause is loft, not damping: at 13° the trajectory is near-symmetric so the ball
  lands at a 13° descent angle and skips. Raising `loftDeg` toward 18–20° is the lever. **Worth
  actually scheduling.** `npm run probe` exits 1 on this one check alone: `driver distance FAIL -
  106.7 m total (65.3 carry + 41.4 roll) vs REFERENCE_CARRY_M 129, drift 17.3% (limit 15%)`. Do not
  read a red probe as a regression without checking it is still only this line. Note that raising
  `loftDeg` moves the swing clearance — the putter's 3° currently caps the follow-through.
- **The ground under the deck is still turf-coloured.** `weights.bridge` is computed by
  `surfaces.ts` and read by nobody; `ground.ts` packs RGBA as green/corridor/sand/water and all four
  channels were spoken for before `SurfaceId.Bridge` existed. Cosmetic since the planks landed, but
  a cart leaving the deck crosses six metres of `Bridge` underfoot that looks like fairway. Closing
  it means re-encoding the splat as an enum in one channel and **will** move the gate baseline. It is
  a decision, not a chore — **and Stage B rewrites the ground shader anyway, so take it there.**
- **Whether a bridged carry should count as playable in `validateHole`.** Relaxing the wet-run check
  regenerates the whole course — par, corridor, field size and acceptance all move. Own spec, own
  play session.
- **Cart health is `2 × par` and `Sim.loadHole` re-sizes it**, so advancing par 3 → par 5 heals the
  player. Still unanswered. **Arena has no par**, so Stage C has to decide this out loud rather than
  letting `setMaxHealth` decide it.
- **The ball still leaves at the top of the backswing, not at impact.** `SWING.downswingSeconds` is
  the knob; making it literally true buys accuracy with input latency on every shot.
- **`CHASE_HEIGHT` is 3.6 m and the rider is hidden under the roof.** Wants a play session.
- **`npm run smoke` is still not part of `npm run build`.** Run and passed this session, now with
  eight more assertions. Still the only check that catches bundle-only breakage. ~40 s.
- **Draw calls per cart are 78** (52 cart + 26 rider), player and every bot. At 24 carts that is
  1,872 draw calls and it becomes the binding constraint long before the terrain does — **look at
  this during Stage C**, not after. `mergeGraphInstances` is the tool, and bots are n copies of one
  graph; the player's cart cannot use it without losing clubhouse recolouring.
- **Railings are decoration and a cart drives through them.** Consistent with D5. Recorded so it is
  not read as an oversight.
- **Paint is only asserted to stay out of the sim at the data level.** Nothing drives a purchase end
  to end.
- **Coins and loadout are page-scoped** and reset on reload — BACKLOG #48.
- **Hazard outlines are rectangles.** Honest geometry, left undone on purpose.
- **§9 step 8, the self-naming failed brief**, still unbuilt. `CORRIDOR_BAND[5].max` (375 m) exceeds
  what `FIELD_FOR_PAR[5]` (300 m) holds straight even on the diagonal (342 m).
- **`terrainMobility.ts` port** (Phase 2, 159 lines, MIT) still open. Needs a `NOTICE` entry.
- **The 00–15 shot list is still not in the repo**, and `docs/concept/README.md` cites it as
  provenance for sixteen images. Check the prompts in or stop citing them.
- **`docs/course/plans/` is ~2.9 MB of generated SVG**, committed as reviewable design docs.

---

## House rules that catch people

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. It is
  what lets `npm run probe`, `npm run plan`, `npm run plan:course` and the server import the sim
  unmodified. `mapGeometry.ts` and `courseLayout.ts` both live there and both stay clean.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  physics; `npm run gate` and `npm run smoke` settle presentation.
- **`npm run plan` after every course change**, and now `npm run plan:course` after every layout
  change. A change that does not show up either did nothing or did something you did not intend. A
  render-only change that *does* move a plan means something leaked into `src/sim/`.
- **Get a test to fail for the right reason before you make it pass — and read the red, do not count
  it.** Four sessions running. This session's instance is the cheapest to reproduce: a negative
  assertion passes against a stub that computes nothing, and a green count of 4 out of 13 looks like
  progress rather than the warning it is.
- **`mergeGraph` bakes colours into vertices**, so a merged graph cannot be recoloured by slot. Props
  and bots can use it; the player's cart cannot without losing the clubhouse loadout.
- **`Box3.setFromObject` walks the subtree.** Both cart test files carry an `ownBox` helper; use it.
- **Read `DECISIONS.md` before touching ragdolls.** Several plausible Rapier fields are inert no-ops
  in the JS bindings.
- **`.glb` is forbidden for anything with a collider**, enforced by `tools/decorBoundary.test.mjs`.
  This is the rule that shapes Stage E's clubhouse, and it is not negotiable by convenience.

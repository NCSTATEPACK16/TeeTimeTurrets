# Course Props, the Flagstick and the Crossing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put something at the cup. Then dress the course with the rest of the eight-prop sheet, and give the water crossings a route around them.

**Architecture:** Three independent phases in three PRs. The **flagstick** is a procedural-TypeScript entity with a Rapier body, because it has a collider and a sim-owned felled state — `ASSET_PIPELINE.md` §2.2's route rule puts it with the ragdolls, not with the rider. The **five decorative props** are Blender graphs merged to one draw call each by a new `mergeGraph()` path, placed by pure functions of `HoleSpec` in `src/render/**` so they cannot reach the sim. The **crossing** is a raised causeway baked into the heightfield carrying a new `SurfaceId.Bridge`, derived after a hole validates so routing never moves.

**Tech Stack:** TypeScript 7 (strict, `noUnusedLocals`, `noUnusedParameters`), Three.js 0.185, Rapier 0.20 (`@dimforge/rapier3d-compat`), Vite 8, Vitest 4 (node environment), Puppeteer 25.

**Spec:** `docs/superpowers/specs/2026-09-08-course-props-and-the-drivable-crossing-design.md` — read it first, and read `docs/concept/reference/README.md`'s deviation list for `prop-silhouettes-01.jpg` before opening Blender.

## Global Constraints

Copied from `AGENTS.md` and the spec. Every task's requirements implicitly include this section.

- **Never put AI-session metadata in git.** No assistant co-author trailers, no `Co-Authored-By: Claude`, no session or chat URLs, no prompt text, no "generated with" footers — not in commit messages, not in PR titles or bodies, not in code comments. History was rewritten once already to remove exactly this. Commit messages describe the change and its reasoning; where a decision came from a conversation, write the decision, not the conversation.
- **Every commit needs a DCO sign-off** (`git commit -s`).
- **`src/sim/**` and `src/physics/**` stay DOM-free and three-free.** Vitest's node environment enforces it; a stray import fails the suite.
- **No `Math.random()` reachable from `src/sim/**` or `src/physics/**`.** Seeded PRNG only, via `src/sim/rng.ts`. Phase B needs no RNG at all — placement is derived (spec D8).
- **`src/render/**`, `src/entities/**`, `src/ui/**` never mutate `Sim` state.** They read snapshots and public fields; they never touch a Rapier body.
- **No per-frame allocation in the fixed tick or the render loop.** Reuse scratch objects.
- **Every `THREE.Mesh`'s geometry and material must be `.dispose()`d** when discarded.
- **Every Rapier body/collider created outside `Sim.create()`'s one-time setup needs a removal path** (`AGENTS.md`). The pin is created in setup *and* rebuilt by `loadHole`, exactly as `buildGround()` is — copy that shape.
- **No `.glb`/`.obj`/`.fbx` in the playable path, ever.** `tools/decorBoundary.test.mjs` enforces it.
- **Never add a second source of truth.** `terrain.cupPosition` and `CUP_RADIUS` are canonical for where the hole is; the flagstick reads them and never carries its own copy.
- **Never launch Puppeteer bare.** `tools/sceneGate.mjs` and `tools/smoke.mjs` already pass the no-sandbox flags.
- **`npx tsc --noEmit` must be clean.** Do not relax `strict`, `noUnusedLocals` or `noUnusedParameters` to make an error go away.

## Baseline at the start of this work

Verified on `cart-rider-and-swing` at `23308e5`, not assumed. Re-run these before Task 1 and record any drift rather than working around it.

- `npx tsc --noEmit` — clean.
- `npm test` — **613 tests across 40 files**, all passing.
- `npm run build` — **gate 8/8 PASS**, mean signature delta 0.00.
- `npm run smoke` — PASS, including all four memory gates.
- `npm run plan` — output is the committed `docs/course/plans/`; `git status` on that directory must be empty.
- `npm run probe` — exits 1 on **one** check and only one: `driver distance FAIL - 106.7 m total (65.3 carry + 41.4 roll) vs REFERENCE_CARRY_M 129, drift 17.3% (limit 15%)`. **That failure is not this plan's to fix.** Keep it the only one.

## Decisions taken before writing this plan

Settled with the user. Do not relitigate them mid-task.

1. **All eight props ship**, including the crossing. The footbridge ships as *decoration* over water nothing drives across (spec D6), because §2.2's arithmetic rules it out as drivable geometry.
2. **The pin is solid and knock-downable**, felled by a struck ball or a cart, down for the hole, upright on the next. It is **not** a scoring target — no `stats.targetsDown`, no hit marker, no coins.
3. **`validateHole` is not touched.** Crossings are derived after validation. Routing must not move.
4. **The crossing is a causeway, not the sheet's arched footbridge.** Forced by the 1 m heightfield cell and the KCC's autostep — see spec §2.2. Do not attempt a narrow deck; it is either a ramp or an invisible wall, and both were rejected.
5. **H17 measures distance from the ball**, not the cart, in metres.

## Stated departures from the source documents

- **`ASSET_PIPELINE.md` §10 step 8 says "Eight props, primitive graph".** The flagstick is not; §2's own manifest row (`Flag + pin | primitive`) and §2.2's route rule both put it in procedural TypeScript. Task 12 amends §10 step 8 rather than leaving the two contradicting.
- **`HANDOFF.md` says "the bridge is not a prop, it is a design change".** Correct, and it is in scope anyway. Task 12 rewrites that entry.

## Confirmed test seams

Tests go at these boundaries and nowhere else.

| Seam | Where | Why here |
|---|---|---|
| Pin state, collider lifecycle, deflection | `src/sim/world.props.test.ts` (new) | Driven through real `Sim.step()`/`loadHole()`, never by reaching into Rapier bodies. |
| Flagstick geometry and its cup agreement | `src/entities/Flagstick.test.ts` (new) | Needs three; render-layer test, same precedent as `Trees.test.ts`. |
| `mergeGraph` | `src/entities/primitiveGraph.test.ts` | Pure function of a graph. |
| Derived prop placement | `src/render/props.test.ts` (new) | Pure functions of `HoleSpec`; no Sim, no Rapier. |
| Backdrop coverage | `src/render/backdrop.test.ts` (new) | The only place that catches spec criterion 6. |
| `SurfaceId.Bridge` and the deck height | `src/sim/surfaces.test.ts`, `src/sim/terrain.test.ts` | DOM-free, reachable from node. |
| **Not** unit-tested: silhouettes | — | `npm run gate`. |
| **Not** unit-tested: DOM writes | — | `npm run smoke`. |

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/entities/Flagstick.ts` | Pole, ferrule, cup ring and a vertex-animated pennant. A `THREE.Group` with `setFelled()` and `dispose()`. |
| `src/entities/Flagstick.test.ts` | Geometry, cup agreement, felled pose. |
| `src/sim/entities/Pin.ts` | The pin's sim half: standing/felled state and its collider handle. |
| `src/sim/world.props.test.ts` | Pin lifecycle and deflection, through a real `Sim`. |
| `src/render/props.ts` | `createProps(terrain, surfaces)` → `{ objects, dispose }`. Derived placement for the five decorative props plus the footbridge. |
| `src/render/props.test.ts` | Placement derivation, one assertion per prop kind. |
| `src/render/backdrop.test.ts` | Every static factory reaches the title screen. |
| `src/render/PinMarker.ts` *(or extend `src/ui/`)* | H17's DOM element, following `nameplates.ts`. |
| `src/entities/graphs/props.json` | The seven Blender-authored props, one graph. |
| `src/sim/crossing.ts` | Derives causeway segments from `HoleSpec` centreline vs water. Pure. |
| `src/sim/crossing.test.ts` | Derivation, including the no-water no-op. |

**Modified:**

| Path | Change |
|---|---|
| `src/entities/primitiveGraph.ts` | Add `mergeGraph()`. |
| `src/render/scene.ts` | Flagstick + props fields, construct, add, dispose; H17 projection. |
| `src/render/backdrop.ts` | Same, minus anything needing a `Sim`. |
| `src/sim/world.ts` | Pin body in `create()` and `loadHole()`; felled state; contact dispatch. |
| `src/sim/surfaces.ts` | `SurfaceId.Bridge`, its `SURFACES` row, a `bridge` weight, the priority-chain entry. |
| `src/sim/terrain.ts` | Causeway shaping in the last pass. |
| `src/ui/hudState.ts`, `src/ui/hud.ts`, `index.html` | H17 state, element and markup. |
| `tools/gate/gateScene.ts`, `tools/sceneGate.mjs` | Eight new subjects — **both files**. |
| `tools/holePlan.ts` | A plan colour for `SurfaceId.Bridge`. |
| `art/clubhouse-and-cart.blend` | A `props` collection. |
| `art/README.md`, `docs/ASSET_PIPELINE.md`, `docs/UI-SPEC.md`, `docs/BACKLOG.md`, `docs/HANDOFF.md` | Record what landed. |

---

# PR 1 — The flagstick

Ships the highest-value object alone. The only PR that adds a Rapier body.

## Task 1: The flagstick's geometry

- [ ] Write `src/entities/Flagstick.test.ts` **first**, asserting: overall height ≈ 2.1 m; the pole's world base is at the group origin; the pennant hangs from the top third; `dispose()` frees every geometry and material. Watch it fail against a file that does not exist yet.
- [ ] Write `src/entities/Flagstick.ts` — a `THREE.Group` built from procedural primitives: a tapered pole, a ferrule band, a low cup ring, and the pennant as a plane whose vertices are displaced per frame on a fixed cycle (spec D4; there is no wind system and this does not add one).
- [ ] Size it against the cart, not against the sheet: `prop-silhouettes-01.jpg` draws every prop scaled to its own cell, so the 0.3 m tee marker and the 2.1 m flagstick appear the same height. The cart canopy is at 2.05 m and the turret pivot at 2.6 m.
- [ ] Expose `setFelled(felled: boolean)`, which lays the pole down rather than hiding it.
- [ ] **Verify:** `npx vitest run src/entities/Flagstick.test.ts`, `npx tsc --noEmit`.

## Task 2: Draw it at the cup, in both scenes

- [ ] Add to `src/render/scene.ts` beside `createGround`/`createTrees` (fields, construct-and-add, `dispose()`), positioned from `terrain.cupPosition` — never from a copied constant.
- [ ] **Add it to `src/render/backdrop.ts` too.** This is the predictable miss: the title screen builds a live hole with no `Sim` and disposes everything it adds.
- [ ] Write `src/render/backdrop.test.ts`, asserting the backdrop's scene contains the flagstick. **Confirm it fails** by wiring only `scene.ts` first — that is the whole point of the test.
- [ ] Write the cup-agreement test (spec criterion 1): the flagstick's world base against `terrain.cupPosition`, to 1 cm, on `fixedHoleSpec()` whose cup is at (45, 8) rather than the origin. **Confirm it fails** with the flagstick left at the group origin.
- [ ] **Verify:** `npx vitest run`, `npx tsc --noEmit`.

## Task 3: The pin as a sim object

- [ ] Write the failing test in `src/sim/world.props.test.ts`: a `Sim` on `fixedHoleSpec()` reports a standing pin, and the world's collider count is one higher than before the pin existed.
- [ ] Add `src/sim/entities/Pin.ts` — standing/felled state only, no three, no DOM.
- [ ] In `src/sim/world.ts`, build the pin's fixed body and thin collider in the same place and shape as `buildGround()`, and **remove and rebuild it in `loadHole()` exactly as the ground collider is**. Radius must stay well under 0.40 m; spec §2.1 is the arithmetic and 0.02–0.03 m is the intent.
- [ ] Publish `pinStanding` on `Sim` for the renderer to read. Do not publish a Rapier handle.
- [ ] **Verify:** `npx vitest run src/sim`, `npx tsc --noEmit`.

## Task 4: Deflection, and holing out with the pin in

Spec criteria 3 and 4. This is the task where the design is proved rather than described.

- [ ] Test: a ball fired off-centre at a standing pin does **not** hole out. Confirm red before the collider exists.
- [ ] Test: a ball rolled into the cup at putting speed **does** hole out with the pin standing. This is what spec §2.1's arithmetic promises. **Confirm it goes red when the pin radius is temporarily raised past 0.40 m** — that turns the arithmetic into a test instead of a comment.
- [ ] Test: the same off-centre shot holes out once the pin is felled.
- [ ] `isInCup` is **not** modified. If it seems to need modifying, re-read §2.1 before touching it.
- [ ] **Verify:** `npx vitest run src/sim`, and `npm run probe` — expect it byte-identical, one known-red line.

## Task 5: Knocking it down

- [ ] Test: a struck ball hitting the pole fells it; a cart driving into it fells it; a felled pin stays felled for the hole and stands after `loadHole`.
- [ ] Wire the contact into the existing dispatch in `src/sim/combat.ts` alongside the cart/target handling. Felling removes the collider — assert the collider count drops, **not** merely that a boolean flipped.
- [ ] Test spec criterion 12: a cart cannot drive over a standing pin and can over a felled one.
- [ ] Renderer reads `pinStanding` and calls `Flagstick.setFelled`.
- [ ] **Verify:** `npx vitest run`, `npx tsc --noEmit`.

## Task 6: H17 — the pin marker

- [ ] Add the element to `docs/UI-SPEC.md` §2's inventory as **H17 | Pin marker | prop sheet | 4 | `terrain.cupPosition`, ball position**, noting it reuses H13's projection and persists per frame.
- [ ] Markup and styles in `index.html`, following `.nameplate`.
- [ ] Derivation in `src/ui/hudState.ts` (DOM-free, testable in node): metres from the ball to the cup, rounded.
- [ ] Presentation following `src/ui/nameplates.ts` exactly — `translate3d`, never `left`/`top`, **every write guarded against its current value**, hidden rather than parked when off-screen, and edge-clamped when the pin is behind or outside the frustum. `projectToScreen` (`src/render/scene.ts:230`) already returns `false` for both cases.
- [ ] Assert the distance derivation in `src/ui/hudState.test.ts`.
- [ ] Add a smoke assertion in `tools/smoke.mjs` that H17 exists and carries a number.
- [ ] **Verify:** `npm run smoke`, `npx vitest run`.

## Task 7: Gate and PR 1 close-out

- [ ] Add a `flagstick` subject to **both** `tools/gate/gateScene.ts`'s `SUBJECTS` record and `tools/sceneGate.mjs`'s array. The subject must build with no Rapier, no terrain and no seed — so the flagstick's geometry must be constructible without its placement.
- [ ] Add a `flagstick-felled` subject: the two poses are indistinguishable in every numeric check and obviously different in the PNG, which is exactly what a gate picture is for.
- [ ] `npm run gate -- --update-baseline`, then **look at the PNGs** before committing.
- [ ] Full verification: `npx tsc --noEmit` · `npm test` · `npm run build` · `npm run smoke` · `npm run plan` (must be byte-identical — nothing in PR 1 touches terrain) · `npm run probe` (one known-red line).
- [ ] Commit with sign-off; open the PR.

---

# PR 2 — The five decorative props

Touches no `src/sim/**` at all. `npm run plan` and `npm run probe` must both be untouched, and that is the easiest claim in the plan to check.

## Task 8: `mergeGraph()`

- [ ] Write the tests in `src/entities/primitiveGraph.test.ts` first: same triangle count as `buildGraph`, exactly one `Object3D` where `buildGraph` gives many, and **per-node colours preserved as baked vertex colours**. The colour assertion is the one that will actually catch a bug.
- [ ] Implement `mergeGraph(graph, slotOverrides?)` using `mergeGeometries` from `three/examples/jsm/utils/BufferGeometryUtils.js` — the same import `src/render/Trees.ts` already uses — baking each node's slot colour into a `color` attribute and returning a single mesh with `vertexColors: true`.
- [ ] Dispose every source geometry after merging, as `Trees.ts:86` does.
- [ ] **Leave `buildGraph` untouched and keep the cart on it.** Merging bakes colours, so a merged cart loses per-slot repainting and the clubhouse loadout with it. Say so in the doc comment.
- [ ] **Verify:** `npx vitest run src/entities`, `npx tsc --noEmit`, and `npm run gate` — the cart subjects must be unchanged, which is the proof `buildGraph` was not disturbed.

## Task 9: Author five props in Blender

- [ ] Open `art/clubhouse-and-cart.blend`, add a `props` collection, and load the authoring helper: `exec(bpy.data.texts['ttt_authoring.py'].as_string(), globals())`.
- [ ] Model tee marker, bunker rake, ball washer, distance post and cart-path sign against `prop-silhouettes-01.jpg`, **sizing each against cart height** — the sheet's scale is per-cell and gives proportion within a prop only.
- [ ] Give them their own material slots, sharing no names with the cart's eight or the rider's four, so `cartGraph.test.ts`'s exact-eight-slots assertion keeps holding.
- [ ] Follow `art/README.md`'s conventions: 1 unit = 1 m, −Y forward, +Z up, scale `(1,1,1)` on anything with children, and rotations using X plus at most one of Y or Z.
- [ ] `bpy.context.view_layer.update()` before exporting, then export to `src/entities/graphs/props.json`.
- [ ] Screenshot each prop and compare against its cell on the sheet.
- [ ] **Verify:** a graph test asserting the expected node names and slot list, mirroring `cartGraph.test.ts`.

## Task 10: Derived placement

- [ ] Write `src/render/props.test.ts` first, one assertion per prop kind tying it to the feature it derives from — a rake within a metre of a bunker rim, distance posts on the centreline, tee markers flanking `spec.tee`. **Confirm each fails** when the corresponding `HoleSpec` field is moved.
- [ ] Write `src/render/props.ts` exporting `createProps(terrain, surfaces)` returning `{ objects, dispose }`, matching `createGround`/`createTrees`' shape. Pure functions of `HoleSpec` — **no RNG at all** (spec D8; trees already own channel 3).
- [ ] Sit every prop on `terrain.heightAt`, and reject placements on water or sand the way `Trees.ts:132-146` does.
- [ ] Add the footbridge as decoration over water **off** the driving corridor (spec D6).
- [ ] Wire into `src/render/scene.ts` **and `src/render/backdrop.ts`**, and extend `backdrop.test.ts` to cover the props too.
- [ ] Assert spec criterion 11: the object count the factory adds stays under 20 on every hole.
- [ ] **Verify:** `npx vitest run`, `npx tsc --noEmit`.

## Task 11: Gate and PR 2 close-out

- [ ] Six new subjects — five props plus the footbridge — in **both** gate files.
- [ ] `npm run gate -- --update-baseline`, review the PNGs.
- [ ] Full verification, with two claims stated explicitly in the PR body: **`npm run plan` byte-identical** and **`npm run probe` byte-identical**, because nothing in PR 2 is allowed to reach the sim.
- [ ] Commit with sign-off; open the PR.

## Task 12: Amend the two contradictions

Do this in PR 2, where the route split becomes visible in the tree.

- [ ] `docs/ASSET_PIPELINE.md` §10 step 8: record that the flagstick is procedural TypeScript and the other seven are graphs, with §2.2's reasoning — the pin has a collider and a sim-owned state, so the code that builds the body owns the shape.
- [ ] `docs/ASSET_PIPELINE.md` §2 manifest: update the `Course props` and `Flag + pin` rows with what shipped.
- [ ] `docs/HANDOFF.md`: replace "the bridge is not a prop, it is a design change" with what was decided.
- [ ] `art/README.md`: the `props` collection and its re-export line.

---

# PR 3 — The crossing

The only PR that changes terrain. Read spec §2.2 before starting: the 1 m cell and the KCC's autostep are what make this a causeway and not a bridge, and the temptation to narrow it will be strong.

## Task 13: `SurfaceId.Bridge`

- [ ] Write the failing test in `src/sim/surfaces.test.ts`: `surfaceAt` returns `Bridge` on a deck cell and `Water` a metre off its shoulder, and `SURFACES[Bridge].isHazard` is `false`.
- [ ] Add the enum member, its `SURFACES` row — hard and fast per spec D5: rolling ≈ 0.05, high `bounceScale`, `cartSpeedScale` 1.0 — and a hard-edged `bridge` field on `SurfaceWeights` alongside `sand`.
- [ ] **Put the bridge test before the water test in `surfaceAt`'s priority chain** (`src/sim/surfaces.ts:188-193`). Confirm the test goes red with the two lines swapped; that ordering is the entire trick and it is one line.
- [ ] Update every exhaustive switch over `SurfaceId` the compiler flags — including `tools/holePlan.ts`'s colour map, which is Task 16.
- [ ] **Verify:** `npx vitest run src/sim`, `npx tsc --noEmit`.

## Task 14: Derive the crossings

- [ ] Write `src/sim/crossing.test.ts` first: a hole with no water yields no crossings (ten of the eighteen briefs have none, so this is the common case); a hole whose centreline crosses a pond yields one segment spanning it.
- [ ] Write `src/sim/crossing.ts` — a pure function of `HoleSpec` returning deck segments where the centreline crosses water. **It runs after `validateHole` and must not be reachable from it** (spec D9); a crossing may never change whether a hole is accepted.
- [ ] **Verify:** `npx vitest run src/sim`, then `npm run plan` — the routing lines must already be byte-identical at this point, since nothing shapes terrain yet.

## Task 15: The causeway in the terrain

- [ ] Write the failing test in `src/sim/terrain.test.ts`: on a hole with a crossing, `heightAt` on the deck centre is above `spec.waterLevel`; a metre off the shoulder it is below.
- [ ] Shape the deck inside `shapeHazards` (`src/sim/terrain.ts:340`), which is "applied last so it cuts through the corridor carving and the pads" — the deck must survive the water excavation that runs in the same pass, so **order it after the water loop**.
- [ ] Deck width 5–7 m with ramped shoulders. Spec §2.2 says why: at 1 m cells and 0.45 m autostep there is no narrow deck that behaves like a bridge, only ramps and walls.
- [ ] Give the shoulders a long, gentle run rather than a tidy short one — the shoulder/pond junction is the most likely place for the cart to catch or the ball to trip (spec §7).
- [ ] Test that a cart driven across a crossing headless **takes no water stroke**. This is the assertion that proves the design rather than describing it; confirm it red before the deck is shaped.
- [ ] Check a bot does not spawn inside a deck — bots spawn from `terrain.cupPosition` (`src/sim/world.ts:1179-1180`).
- [ ] **Verify:** `npx vitest run`, `npx tsc --noEmit`.

## Task 16: The crossing's geometry and the plan

- [ ] Author the boardwalk deck and railings in Blender as graph props; railings are **render-only decoration** and get no collider (spec D5).
- [ ] Draw them from `src/render/props.ts` along the derived crossing segments.
- [ ] Add a `SurfaceId.Bridge` colour to `tools/holePlan.ts`'s map so crossings are visible in the design plans.
- [ ] `npm run plan` and read the result carefully — this is spec criteria 7 and 8:
  - **Routing must be byte-identical**: every `par`, `corridor`, `field` and the acceptance-rate line, on all eighteen holes.
  - **SVGs are expected to change, and only around a crossing.** A hole with no water must produce a byte-identical SVG. Do not read the change as a regression and do not read the no-change as licence to skip looking.
- [ ] Commit the regenerated `docs/course/plans/`.
- [ ] **Verify:** `npm run plan`, `npm run probe` (one known-red line), `npm run gate -- --update-baseline` with the PNGs reviewed.

## Task 17: Whole-branch verification and the pull request

- [ ] `npx tsc --noEmit` clean.
- [ ] `npm test` — every new test confirmed red first, for the right reason. If any went green on its first run, break the thing it claims to check and watch it fail before trusting it. **Two assertions that are each true about different things is this repo's recurring defect** — the 0.26 m turret muzzle bug shipped behind exactly that, and spec criteria 1 and 2 are shaped to prevent the repeat.
- [ ] `npm run build` — gate green after a reviewed re-baseline.
- [ ] `npm run smoke` — PASS including all four memory gates.
- [ ] `npm run plan` — routing byte-identical; SVG changes confined to crossings and reviewed.
- [ ] `npm run probe` — one known-red line, byte-identical.
- [ ] Rewrite `docs/HANDOFF.md` as a baton, not a log. Carry forward: `validateHole` relaxation as the natural sequel; `CHASE_HEIGHT`; and the driver roll/carry ratio, **noting that loft interacts with the turret's swing clearance — the putter's 3° is what currently caps the follow-through.**
- [ ] Update `docs/BACKLOG.md` and `docs/UI-SPEC.md`.
- [ ] Confirm nothing session-related reached the diff: `git log origin/main..HEAD --format='%H%n%B' | grep -inE 'co-authored-by|claude|anthropic|generated with|session'`.
- [ ] Commit with sign-off; open the PR.

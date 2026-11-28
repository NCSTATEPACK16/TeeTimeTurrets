# Stage 9: the refactor

Written 2026-11-28. The spec for `docs/REVAMP-PLAN.md`, "Stage 9: refactor". As with Stages 5, 6
and 8, every question in §7 is built to its default; the user asked for the whole stage in one
larger PR.

A refactor changes no behaviour. **The golden fingerprint must not move in any slice**
(`2703140360`, Linux x64), `tools/simAllocation.test.mjs` must still find no allocation in the
tick, and `npm test` must stay green after every commit. That is the stage's acceptance; there is
no play-test beyond a short smoke match.

What the plan asked for, and where each item lands:

| Plan item | Here |
|---|---|
| Delete the generator: `courseRelaxation.ts`, `solveCourseLayout` and its lobe/circle helpers, `generate*`, `draftHole`, `derivePar` | §2, slice 1 |
| `validateHole` to `sim/holeValidation.ts` | §3, slice 2 |
| `feelProbe` becomes `turretProbe` | §3, slice 2 |
| Split `world.ts` into physicsWorld, rigs, hazardRules, respawn, shots, botDriver, pickups and snapshot, leaving about 300 lines | §4, slice 3 |
| `sim/vec.ts`, an import-direction test, dead members removed | §5, slice 4 |

---

## 1. What exists today

Read from `main` at `737f196`.

- **The course is authored** (`authoredCourse.ts`, `authoredLayout.ts`). The procedural generator
  that came before it is still in the tree:
  - `courseRelaxation.ts` (392 lines): `relaxNine` and `polishCourse`.
  - `courseLayout.ts`: `solveCourseLayout`, `loopRadius`, the lobe constants and their helpers.
    The same file also holds what the authored path uses: `toHoleFrame`, `boundsOf`, `Bounds`,
    `PlacedField`, `inspectLayout` (read by `tools/coursePlan.ts`) and the `courseGeometry.ts`
    re-exports.
  - `course.ts`: `generateCourse`, `generateHole`, `draftHole` and its routing helpers,
    `derivePar`, `DRAFT_BAND`, `FIELD_FOR_PAR`, `corridorBox`, `DOGLEG_MAX_TURN`, `MAX_ATTEMPTS`
    and `PAR_MIX`/`parForIndex`. The authored course reads `CORRIDOR_BAND`, `fieldSizeFor`,
    `biomeForIndex`, `defaultGreen` and `stripeAngleFor` from the same file.
- **Nothing shipped calls the generator.** Its callers are its own tests, the tests that build a
  generated course as a specimen (`courseDressing`, `courseGround`, `courseSurfaces`,
  `courseTerrain`, `routing`, `briefs`), and `tools/feelProbe.ts`.
- **`world.ts` is 1621 lines**: the `Sim` class with its construction, physics world, rigs, the
  fixed step, shots, combat callbacks, mortars, pickups, hazards (water and the zone), respawn,
  bot intent and routing, the render snapshot and the trajectory preview.
- **Import rules are tested in parts.** `tools/simIsolation.test.mjs` keeps `src/sim/**` and
  `src/physics/**` off `render`, `ui` and `app`. `tools/importCycles.test.mjs` forbids value-import
  cycles. Nothing checks the Apache-to-AGPL direction (`src/**` must never import `server/**`) or
  that the sim stays off `three`, `entities`, `input` and `audio`.

## 2. Delete the generator (slice 1)

- **Delete** `courseRelaxation.ts` and its test.
- **From `courseLayout.ts`:** `solveCourseLayout`, `loopRadius`, `COURSE_LOBES`,
  `COURSE_LOBE_DEPTH` and every helper only they reach. Kept: frames, `boundsOf`, `Bounds`,
  `PlacedField`, `HolePlacement`, `CourseLayout`, `inspectLayout` and the re-exports.
- **From `course.ts`:** `generateCourse`, `generateHole`, `GenerateOptions`, `draftHole` and its
  helpers, `derivePar`, `DRAFT_BAND`, `FIELD_FOR_PAR`, `corridorBox`, `DOGLEG_MAX_TURN`,
  `MAX_ATTEMPTS`, `PAR_MIX` and `parForIndex`, and anything else only they reach.
- **Tests** (Q1):
  - Tests of the generator itself go with it.
  - Tests that used a generated course only as a specimen move to the authored course
    (`authoredCourse(2026)` and `buildCourseWorld`), or to `fixedHoleSpec()` where one hole is
    enough. Each keeps its assertion; only the specimen changes.
  - `validateHole`'s own cases are kept (slice 2 moves them).
- **Docs:** comments that point at deleted functions are reworded to point at what exists.

## 3. Moves and renames (slice 2)

- **`sim/holeValidation.ts`** takes `validateHole`, `HoleRejection` and the constants only it
  reads (the grade limits, `MIN_HOLE_LENGTH`, `EDGE_MARGIN` and the centreline sample). Importers
  are updated; `course.ts` does not re-export it (Q2).
- **`tools/feelProbe.ts` becomes `tools/turretProbe.ts`**, and `npm run probe` runs it. With the
  generator gone, it probes the authored course's holes (Q3).

## 4. Split `world.ts` (slice 3)

`Sim` stays the one public class, with the same constructor, `create`, `step`, `reset`,
`dispose` and every public member. The work moves into modules beside it, as functions that take
the `Sim` (or the parts they need) and allocate nothing per tick:

| Module | Takes |
|---|---|
| `sim/physicsWorld.ts` | building and freeing the Rapier world: ground collider, carts' bodies and controllers, the ball pool, the obstacles |
| `sim/rigs.ts` | `CartRig`, building a rig, placing it on a spawn point, the cart transforms |
| `sim/hazardRules.ts` | water (the stroke, the drop) and the zone (warning and drain) |
| `sim/respawn.ts` | death (`killCart`), the respawn timer and the spawn draw |
| `sim/shots.ts` | firing, crediting hits, the mortar call and barrages, the trajectory preview |
| `sim/botDriver.ts` | each bot's intent: targets, ammo and heal seeking, routing over the nav graph |
| `sim/simPickups.ts` | pickup sites and loose balls (`sim/pickups.ts` already holds the site rules, so the per-tick driver gets its own name, Q4) |
| `sim/snapshot.ts` | the render snapshot: cart and pool transforms, interpolation buffers |

- **`world.ts` keeps** the class, its fields, `create`, the fixed step that calls the modules in
  the same order as today, `reset` and `dispose`. Target: about 300 lines; the class's field
  declarations and their doc comments may take it past that (Q5).
- **Order is behaviour.** Every call keeps its place in the tick, every RNG draw its order, and
  every event its push order. The golden is the check.
- **Private members** the modules need become package-internal: readable by the modules, marked
  `/** @internal */`, and not used outside `src/sim/**`. Tests that cast into `Sim` for `rigs`
  keep working.

## 5. Cleanup (slice 4)

- **`sim/vec.ts`** holds the plain `Vec2` and `Vec3` interfaces and the small 2D helpers the sim
  repeats in several files (distance, length, a dot product). The existing types become
  re-exports or imports of it, so no shape is declared twice. Hot-path code keeps its inlined
  arithmetic: a helper is used only where the code already called one.
- **The import-direction test** (`tools/importDirection.test.mjs`) replaces
  `simIsolation.test.mjs` and states the whole layering in one table:
  - `src/sim/**` and `src/physics/**` import nothing from `render`, `ui`, `app`, `entities`,
    `input`, `audio`, `three` or `server`, type-only imports included.
  - Nothing under `src/**` or `tools/**` imports `server/**` (Apache-2.0 must not depend on
    AGPL-3.0).
  - It is seen to fail on a planted import, and it reads the real tree (a premise on the file
    count).
- **Dead members.** A scan for exports that nothing imports outside their own file (tests
  included as importers). Each one is deleted, or kept with a reason in this spec's §8 when it is
  a public tool or a documented seam.

## 6. Checks

Per `docs/TEST-AND-SPEC-PITFALLS.md`, each slice's check is one the change could break:

- **Every slice:** `npx tsc --noEmit`, `npm test` green, the golden unchanged.
- **Slice 3:** the golden and `simAllocation.test.mjs` are the checks: a reordered draw moves
  the golden, and a closure built per tick fails the allocation test.
- **Slice 4:** `importDirection.test.mjs`, seen to fail on a planted `three` import in
  `src/sim/`.
- **The end:** a short smoke match in the browser where this container allows it (a headless
  match crashes here; `docs/HANDOFF.md`), else the play-test.

## 7. Questions (built to the default)

| # | Question | Default built |
|---|---|---|
| Q1 | Generator tests that used a generated course as a specimen | Move to the authored course or `fixedHoleSpec()`; keep the assertion. |
| Q2 | Keep a re-export of `validateHole` from `course.ts`? | No. Importers are updated. |
| Q3 | What does `turretProbe` probe once the generator is gone? | The authored course's holes. |
| Q4 | `pickups.ts` already exists | The per-tick driver is `simPickups.ts`. |
| Q5 | `world.ts` at "about 300 lines" | The logic is out; field declarations with their doc comments may run past 300. |
| Q6 | One PR or one per slice? | One larger PR, at the user's request, with a commit per slice. |

## 8. Built

Filled in as the slices land.

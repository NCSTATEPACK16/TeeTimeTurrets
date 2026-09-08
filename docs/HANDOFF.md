# Handoff — next session

Written 2026-09-08, at the end of the session that got a large uncommitted working tree into
history and fixed the bug that was sitting in it.
Rewrite this file at the end of each session; it is a baton, not a log.

---

## Where things stand

**The Blender pipeline and the cart are merged** (PR #9, `50babde`). Everything else is one open
PR on `phase-1-75-clubhouse-and-round`, four commits against `main`, meant to be read in order:

| Commit | What |
|---|---|
| `app/ui: a title screen, a scorecard…` | Phase 1.75: `ScreenManager`, title, round, results, the card |
| `ui/render: the clubhouse…` | The clubhouse, the first decorative GLB, the purse |
| `sim: one round for the session…` | The round-advance fix, and the double-payment it exposed |
| `docs: hand off…` | This file |

**Verified at the tip:** `tsc` clean · 575 tests / 38 files · `npm run build` gate 5/5 mean delta
0.00 · `npm run smoke` PASS including the Phase 1.75 memory gate, the clubhouse memory gate and the
new hole-advance check · `npm run plan` byte-identical · `npm run probe` red on the one known
driver-distance line only.

### What this session actually changed

Almost all of it already existed, uncommitted, on `main`. The session's work was splitting it into
reviewable pieces, bringing the documents back in line with the code, and fixing what the split
turned up.

**The bug, and the bug it was hiding.** `NEXT HOLE` replayed the second hole forever: `startRound`
read `round.holeIndex` and then replaced `round`, resetting the index and emptying the card. No
unit test could see it — `round.test.ts` asserts what `Round` does when used correctly, and the
defect was in the *using*, which lived in `main.ts` with no seam a node test could reach. The
advance is now `src/sim/session.ts`.

Fixing it exposed a second bug the first had been hiding: `earningsFor(round)` read cumulative
totals and was called after every hole, so hole 2 paid for hole 1 again. Invisible while the round
was being wiped, because the wipe made the round total accidentally equal to one hole's. The purse
now prices a hole.

**Three documents were lying** and are now corrected in the PRs that make them true:
`ASSET_PIPELINE.md` said the graph format and exporter were unbuilt, `ROADMAP.md` Phase 1.75 was
entirely unticked, and Phase 3.5's clubhouse and economy rows were open.

---

## Next session

### The Blender queue, which is the question this session opened with

**Done and shipping:** the cart (47 objects, primitive graph, `src/entities/graphs/cart.json`) and
the clubhouse interior (29 boxes, 324 tri, `public/models/clubhouse.glb`). Source for both is
`art/clubhouse-and-cart.blend`; read `art/README.md` before opening it, because the custom
properties are the export contract.

**Explicitly not Blender, so they are not waiting on anything:** the mannequin/ragdoll is
procedural TypeScript (`ASSET_PIPELINE.md` §2.2 — the physics rig is the character rig), and the
trees already ship instanced as `src/render/Trees.ts`. `ASSET_PIPELINE.md` §10 records both
decisions so they are not re-litigated.

**Next, and decided:** the eight-prop course set (`ASSET_PIPELINE.md` §10 step 8), all via
primitive graph, from `docs/concept/reference/prop-silhouettes-01.jpg`.

1. **Lead with the flagstick.** The cup renders as *nothing* today — `src/render/scene.ts` has no
   flag, no pin, no cup geometry — on all eighteen holes. It is the highest-value object in the art
   queue and the one a player notices first.
2. Then tee marker, bunker rake, ball washer, distance post, cart-path sign.
3. **The bridge is not a prop, it is a design change.** A crossing carts can drive on without
   damage is *playable* geometry under `ASSET_PIPELINE.md` §1, so it cannot be a GLB from any
   source, Poly.pizza included — that stays a wireframe proportion reference deleted before export.
   The real question is below.

**Read `docs/concept/reference/README.md` before modelling from the sheet.** Two deviations change
what a modeller does: scale is per-cell rather than uniform, so size every prop against cart height
and never against another panel; and the footbridge and boardwalk are drawn in three-quarter view,
so the deck width they imply is a perspective artefact rather than a measurement.

### The open question the bridge raises

Holes 2, 13 and 15 are forced carries and an island green — their whole design is a centreline
crossing water, and check 6 in `validateHole` is built around `DRIVER_CARRY_M`. **A drivable bridge
turns a forced carry into a route choice.** So: is a bridge placed by `src/sim/placement.ts` as
part of hole generation, in which case the validator has to know about it and the seven checks need
re-thinking — or hand-placed dressing that happens to be drivable? The first is right and is a real
chunk of sim work, not an afternoon's modelling.

### Smaller, and still open

- **`npm run smoke` is not part of `npm run build`,** and it now carries three things nothing else
  does: the Phase 1.75 memory gate, the clubhouse memory gate, and the hole-advance wiring check —
  plus it remains the only check that catches bundle-only breakage, the class of bug that shipped a
  blue rectangle. `npm run build` is `tsc && vite build && npm run gate`, and the gate renders five
  harness rigs, never a course. ~40 s. This has been deferred three sessions running.
- **The scene gate has five subjects and none is a screen or a prop.** Each new prop wants a
  baseline before it is called done. Note also that the cart graph weakened half the gate: all
  three club heads ship in `cart.json` and a swap toggles `visible`, so `cart-driver`, `cart-iron`
  and `cart-putter` now report identical vertex and triangle counts. Bounding box and perceptual
  signature still tell them apart; the counts do not (`ASSET_PIPELINE.md` §9).
- **Paint is only asserted to stay out of the sim at the data level**, in `loadout.test.ts`.
  Nothing drives a paint purchase end to end and confirms nothing in `Sim` moved. The tire half
  *is* checked end to end in smoke. Worth closing before the next cosmetic is added.
- **Coins and loadout are page-scoped** and reset on reload — BACKLOG #48.

---

## Loose ends carried forward

- **Driver roll/carry is 0.63 where real golf is ~0.15.** Open since Phase 0, carried in four
  handoffs now. The cause is loft, not damping: at 13° the trajectory is near-symmetric so the ball
  lands at a 13° descent angle and skips. Raising `loftDeg` toward 18–20° is the lever. It is club
  balance and wants a play session rather than more arithmetic — **worth actually scheduling.**

  `npm run probe` exits 1 on this one check alone: `driver distance FAIL - 106.7 m total
  (65.3 carry + 41.4 roll) vs REFERENCE_CARRY_M 129, drift 17.3% (limit 15%)`. Do not read a red
  probe as a regression without checking it is still only this line.
- **Cart health is `2 × par` and `Sim.loadHole` re-sizes it**, so advancing par 3 → par 5 heals the
  player. Still unanswered, and now reachable: hole advancement works. Decide it out loud rather
  than letting `setMaxHealth` decide it.
- **`RenderScene.loadHole` was never built and is no longer the blocker** the last handoff said it
  was. Hole advancement rebuilds the whole `RoundScreen` — sim, scene and all — which the screen
  manager makes correct and leak-free (the memory gate proves it). A `loadHole` path would make the
  transition cheaper, not possible. Reopen it only if the rebuild is measurably too slow.
- **Hazard outlines are rectangles.** Honest geometry, correct to the metre. Left undone on purpose:
  a rectangle makes a placement bug obvious in a plan and a lobed blob hides one.
- **A greenside bunker may end up on the other side** when neither bank at any sampled `t` is clear
  of water. A compromise on the brief's intent; the path still exists.
- **Narrow corridors are closer to the camber limit** — less headroom on holes 5, 12 and 17. First
  place to look if a future terrain change starts exhausting the sampler.
- **§9 step 8, the self-naming failed brief**, is still unbuilt. `generateHole` throws
  `exhausted 32 attempts; the last rejection was check N`, which names the last candidate's problem
  rather than the brief's. `CORRIDOR_BAND[5].max` (375 m) still exceeds what `FIELD_FOR_PAR[5]`
  (300 m) can hold straight even on the diagonal (342 m).
- **`terrainMobility.ts` port** (Phase 2, 159 lines, MIT) still open. Needs a `NOTICE` entry.
- **The 00–15 shot list is still not in the repo**, and `docs/concept/README.md` cites it as
  provenance for sixteen tracked images. Either check the prompts in or stop citing them.
- **`docs/course/plans/` is 2.9 MB of generated SVG**, committed as reviewable design docs.

---

## House rules that catch people

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. It is
  what lets `npm run probe`, `npm run plan` and the server import the sim unmodified — and it is why
  `session.ts` is in `src/sim/` rather than next to `main.ts`.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  physics; `npm run gate` and `npm run smoke` settle presentation.
- **`npm run plan` after every course change.** A change that does not show up in the plans either
  did nothing or did something you did not intend. A render-only change that *does* move a plan
  means something leaked into `src/sim/`.
- **Get a test to fail for the right reason before you make it pass.** This session added two that
  were green *before* the fix as well as after — the exact shape `TEST-AND-SPEC-PITFALLS.md` is
  about. Both were confirmed by deliberately restoring the broken pricing and watching them report
  `[25, 50, 75]` against `[25, 25, 25]`, and 300 coins against 100. The smoke hole-advance check was
  confirmed the same way: `hole 0 -> 0` when `startRound` is made to ignore the session.
- **Read `DECISIONS.md` before touching ragdolls.** Several plausible Rapier fields are inert
  no-ops in the JS bindings.

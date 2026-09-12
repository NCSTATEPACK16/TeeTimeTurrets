# Handoff — next session

Written 2026-09-12, at the end of the session that finished Stage C: arena is playable end to
end, from the title screen's ARENA button through a match to its own results screen. Rewrite
this file at the end of each session; it is a baton, not a log.

---

## Where things stand

**`arena-wiring` carries this session's work, uncommitted at the branch tip (`7fcc2f8`).**
Everything below assumes it lands; if it has not, check before building on it. This picks up
where the *previous* handoff (Stage B, the course as one heightfield) left off — that work
merged as `arena-course-terrain`, and a routing-relaxation detour (`procedural-course-generation`,
also merged) sits between it and this session in the log.

**Verified at the tip:** `tsc --noEmit` clean · **910 tests / 61 files, 909 pass and 1 expected
fail** (was 826/55 two handoffs ago) · `npm run gate` **19/19 PASS**, mean delta 0.00 including
`course-ground` · `npm run smoke` **PASS**, all arena checks included · `npm run plan` all 18
SVGs byte-identical · `npm run probe:terrain` **PASS**, unchanged control · `npm run probe` red
on the one known driver-distance line only.

### Stage C is done: mode, scoring, and now the scene

`docs/DECISIONS.md` § "Arena's scoreboard: two strokes that must never touch, and a flat health
number" has D1, D5, D9 and D12 — the decisions this stage answered rather than implemented from
a settled spec. Read it before touching `src/sim/match.ts` or either results screen.

**C1–C4 (the scoreboard, attribution, the mode switch, the HUD) were already committed** when
this session started — `938d00b` through `8170e52`, from an earlier session this handoff did not
write. This session's own work is C5, **the scene**, plus one piece of C4 that turned out not to
exist yet:

- **`src/sim/courseWorld.ts`** — the six-call sequence (route, place, blend terrain, blend
  surfaces) that used to be inlined twice, once in `main.ts` and once in the scene gate's
  `courseGroundSubject`. Now both call `buildCourseWorld(course, seed)`. Its own test
  (`courseWorld.test.ts`) is what found the bug below.
- **`RenderScene` learns a course by being handed one** (D13): an optional `arena?: ArenaSource`
  in the constructor. Present, it builds `courseGround` instead of the hole's `ground`/`trees`/
  `flagstick`/`props` — all four become nullable fields, null in arena — and the chase camera's
  ground-clearance probe switches from `terrain.heightAt` to the course's. Absent, stroke play is
  bit-for-bit what it was; the gate's 0.00 deltas across every subject are the evidence.
- **`RoundScreen` grew one optional field (`arena: ArenaSource`) rather than a parallel screen
  class.** The pin marker and the `M` map are not built when it is set — both read one hole's
  geometry and arena has none to give them.
- **`TitleScreen` gained an ARENA button**, second under PLAY. `main.ts`'s `startArena` builds
  (once, cached) the `CourseWorld`, creates a `Sim` on hole 1 purely so `loadCourse` has rigs to
  swap the ground under, and shows the `arena` screen.
- **`MatchResultsScreen` did not exist before this session, despite C4's plan and D12 both
  calling for it — but its DOM-free half did.** `src/ui/matchScoreboard.ts`'s
  `deriveScoreboard(match): ScoreboardState` (headline, both teams' strokes, the MVP, one row per
  player) shipped with C1–C4 at `8170e52`, before any screen called it. What was actually missing
  was only the writing half: `src/ui/screens/MatchResultsScreen.ts`, a real `Screen` built fresh
  in `enter()` like `ResultsScreen`, releasing pointer lock on the way in per D12, laying out
  `deriveScoreboard`'s headline/score/MVP/rows and PLAY AGAIN / MAIN MENU. What existed under a
  similar name (`matchResultsState.ts`/`matchResults.ts`) is a different module: the 3 September
  cart-combat mode's own overlay, reading `Cart.strokesTaken` and `Sim.matchOutcome()` — the
  *other* meaning of "stroke" (D1). Reusing it for arena would have shown hits-absorbed as the
  team score. `MatchResultsScreen` is registered in `main.ts` as `"arenaResults"`; `RoundScreen`
  now skips the old overlay outright whenever `arena` is set, so the two endings can never both be
  on screen. PLAY AGAIN calls `Sim.reset()` (already arena-aware — re-tees every cart, resets the
  spawn stream and the clock) and returns to `"arena"` rather than rebuilding the course again.
  **Caution for whoever reads this next: an early pass this session nearly destroyed
  `matchScoreboard.ts`** — wrote a second, narrower module under the same filename without reading
  the existing one first, because a symbol search for `MatchResultsScreen` and for HUD-style field
  names did not surface `deriveScoreboard`/`ScoreboardState` under their actual names. Caught
  before anything was committed by `git status` showing the file as modified rather than new, and
  restored with `git checkout`. See `docs/DECISIONS.md`'s D12 entry for the full account. The
  general lesson: a clean `search_symbols` miss is not proof a module does not exist — check
  `git status`/`ls` for the exact path you are about to `Write` before trusting a search result.

**A real, pre-existing bug surfaced by `courseWorld.test.ts`, not by this session's changes.**
Three of eighteen cups read a neighbouring hole's surface material rather than their own — hole 9
`fairway`, hole 18 `rough`, hole 17 `water` — all inside `CLUBHOUSE_APRON_M` where the returning
nines crowd. `courseSurfaces.surfaceAt` is not at fault; it asks the owning hole correctly. The
bug is ownership, in `courseTerrain.weightsInto`. Recorded as `it.fails`, not skipped and not
loosened — see the test's own comment for why. **Next session should either fix
`weightsInto`'s ownership near the apron or explicitly decide three misdrawn cups are acceptable
and change the test's framing**, but should not touch this without reading Stage B's assembly
first (`docs/DECISIONS.md` § "Assembling the course: influence, not a mosaic").

---

## Next session — Stage D, pickups

`src/sim/entities/Pickup.ts` is 33 lines defining one hardcoded ammo `Bucket`. It becomes a typed
collection — bucket = ammo, drink = shield, hot dog = health, per concept sheet `06` — scattered
course-wide from a seeded PRNG (**never `Math.random()` in `src/sim/**`**), re-rolled per match,
weighted near flags and valid anywhere drivable. Plus the striped food cart as a prop that spawns
pickups around itself. `Sim.pickups` already exists as a readonly getter and the map already
draws whatever it returns. `CourseTerrain.weightsInto` is how to ask which hole a candidate point
belongs to — the same method the cup-ownership bug above lives in, so whoever picks this up
should read that loose end first rather than build pickup placement on top of a known-wrong
ownership answer near the clubhouse.

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

**`courseWorld.test.ts`'s `it.fails` is the pattern to copy for a known bug, not a workaround.**
Three of eighteen cups are wrong (above); the test asserts the **correct** behaviour and is
expected to fail until `weightsInto` is fixed. `it.skip` would have hidden a cup under water;
asserting the wrong values would have locked them in. When the bug is fixed, delete `.fails`
rather than the test — it inverts to a plain red the moment that happens, which is the signal
the fix landed.

**Two smoke checks this session added could only pass because the real code ran, not because of
a placeholder.** `#hud-team-score`/`#hud-points` ship empty and hidden in `index.html`
(`TEST-AND-SPEC-PITFALLS.md` §1, instances 5–6's own lesson, applied again); the "non-empty team
score after ARENA" check can only pass if `deriveHudState`/`drawHud` actually ran with
`source.arena === true`. `MatchResultsScreen` ships **no** markup in `index.html` at all — it is
built fresh in `enter()`, like `ResultsScreen` — so there was nothing to ship empty in the first
place and nothing a placeholder could satisfy.

**The gate's `course-ground` subject still does not exercise routing or relaxation** — carried
from the Stage B handoff, unchanged this session. `GATE_COURSE_HOLES` is 3, which falls back to
`placeNineOnCircle` rather than the relaxed layout the real 18-hole course uses. The subject is a
true, green geometry baseline; it just isn't evidence about the routing. `courseLayout.test.ts`
alone covers that. Still a trade against legibility, not an oversight — see the subject's own
comment.

---

## Loose ends this session added

- **`courseTerrain.weightsInto`'s cup-ownership bug**, above. Pre-existing, first visible via
  `courseWorld.test.ts`'s `it.fails`.
- **Six carts in arena (`ARENA_BOTS = 5` plus the player) is untested at the frame-time scale
  `docs/HANDOFF.md` used to measure stroke play at.** `smoke` boots it and runs a match to
  completion but does not profile it. Draw calls: `docs/HANDOFF.md`'s carried-forward note below
  measured 78/cart in stroke play; six carts is ~470 before the course ground's 54 tiles. Worth a
  real playtest before Stage D adds pickups on top.
- **The course ground's tiles are now actually reachable in a played mode, not just built and
  gated.** The carried-forward "tiles are never freed" note below was true in Stage B when
  nothing drew `courseGround`; now arena drives on it for up to three minutes a match. Whether
  that is a problem wants a play session, not a guess.
- **`MatchResultsScreen`'s pointer-lock release (D12) has no smoke coverage of its own.** Puppeteer
  never establishes real pointer lock in this suite (nothing clicks the canvas to request it), so
  a check for `pointerLockElement === null` after entering the screen would be true whether or not
  `exitPointerLock()` ran — the exact shape of check `TEST-AND-SPEC-PITFALLS.md` warns against.
  The line is there, matches the existing overlay's identical guard, and is unverified by anything
  but reading it.

---

## Loose ends carried forward

- **Driver roll/carry is 0.63 where real golf is ~0.15.** Open since Phase 0, carried in ten
  handoffs now. The cause is loft, not damping: at 13° the trajectory is near-symmetric so the
  ball lands at a 13° descent angle and skips. Raising `loftDeg` toward 18–20° is the lever.
  **Worth actually scheduling.** `npm run probe` exits 1 on this one check alone (17.3% drift vs
  a 15% limit this session). Do not read a red probe as a regression without checking it is still
  only this line. Raising `loftDeg` moves the swing clearance — the putter's 3° currently caps
  the follow-through.
- **Whether a bridged carry should count as playable in `validateHole`.** Relaxing the wet-run
  check regenerates the whole course — par, corridor, field size and acceptance all move. Own
  spec, own play session.
- **The ball still leaves at the top of the backswing, not at impact.** `SWING.downswingSeconds`
  is the knob; making it literally true buys accuracy with input latency on every shot.
- **`CHASE_HEIGHT` is 3.6 m and the rider is hidden under the roof.** Wants a play session.
- **`npm run smoke` is still not part of `npm run build`.** Run and passed this session (~45 s
  with the arena additions). Still the only check that catches bundle-only breakage.
- **Draw calls per cart are 78** (52 cart + 26 rider), player and every bot. Arena at six carts is
  the number to profile first — see this session's loose end above.
- **Railings are decoration and a cart drives through them.** Consistent with D5 (the physics
  ownership one, not the arena-attribution D5 — `docs/DECISIONS.md` reuses letters across specs).
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
- **The course rough is flat overall** — every hole's field sits at its own local zero, so there
  is no course-scale macro relief between holes. A low-frequency term added to the rough and to
  every hole's height would fix it and would move every corridor grade, so it is a decision.
- **Bridge is still not in the ground splat.** The mask's four channels are green, corridor, sand
  and water; a fifth in a shared channel puts a false ring of sand around every pond under a
  linear filter. A second sampler is the honest fix. `weights.bridge` is still computed and read
  by nobody.
- **Hole 9's corridor crosses hole 1's near the clubhouse.** Inside the apron, so the clearance
  rule forgives it by design. Now actually driveable in arena — worth a look.
- **Teams are hardcoded `enemy` in `Nameplates`** for every bot regardless of `teamOf`. Real team
  colouring on the plates is unbuilt; `hud.ts`'s team score is correct, the plates are not.

---

## House rules that catch people

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. It
  is what lets `npm run probe`, `npm run probe:terrain`, `npm run plan`, `npm run plan:course` and
  the server import the sim unmodified. `src/ui/matchScoreboard.ts` follows the same split for the
  same reason `hudState.ts` does — the DOM-free half is what gets a real test.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  physics; `npm run gate` and `npm run smoke` settle presentation.
- **`npm run plan` after every course change**, `npm run plan:course` after every layout change,
  and **`npm run probe:terrain` after any change to the assembly** — the sampling cost is the part
  that moves, and it is what the renderer's tiling is sized against.
- **Get a test to fail for the right reason before you make it pass — and where the code came
  first, mutate it.** `courseWorld.test.ts` is this session's example: nine of its assertions were
  confirmed red against a stub before `courseWorld.ts` existed.
- **Before writing a file with `Write`, confirm it is actually new** — `git status`, not just a
  symbol search. This session's near-miss on `matchScoreboard.ts` (above) happened because a
  search for the wrong names came back empty and was trusted as proof of absence; `git status`
  after the fact showed the file as modified, not created, which is what caught it.
- **`mergeGraph` bakes colours into vertices**, so a merged graph cannot be recoloured by slot.
- **`Box3.setFromObject` walks the subtree.** Both cart test files carry an `ownBox` helper.
- **Read `DECISIONS.md` before touching ragdolls**, and now before touching `src/sim/match.ts` or
  either results screen too — the two-strokes and screen-split reasoning above is easy to
  half-remember and get backwards.
- **`.glb` is forbidden for anything with a collider**, enforced by `tools/decorBoundary.test.mjs`.
  This is the rule that shapes Stage E's clubhouse, and it is not negotiable by convenience.

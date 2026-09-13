# Implement three plans, in this order, one task at a time

Everything below is specced, planned and reviewed. **Nothing is implemented.** The session that
wrote these (12 September 2026) deliberately produced no code — the whole point was to settle
decisions before they got buried in implementation. Your job is to execute, not to re-decide.

**If you find yourself re-opening a decision, stop and read the spec's "Implementation Decisions"
section.** Every rejection is recorded there with its reason. If the reason is wrong, say so to the
user — do not quietly pick the other branch.

---

## The order, and why it is not negotiable

### 1. `docs/superpowers/plans/2026-09-12-hazard-aware-ownership-tie-break-implementation.md`
2 tasks · small · a bug fix that stands on its own.

`influenceLocal` writes `lastCentredness` from the spline before its hazard loops run, so a point
deep inside a pond can lose an ownership tie to a better-centred neighbouring corridor. **8,824 m²
— 22% of the course's reported water — currently reads as dry ground**, and `checkCartWater` gates
drowning on that same lookup, so carts drive across it without drowning.

First because it is independent of everything else, and because plan 3 asks `surfaceAt` whether a
point is water.

### 2. `docs/superpowers/plans/2026-09-12-authored-course-routing-implementation.md`
6 tasks · large · the biggest change of the three.

The eighteen holes get re-traced from a real plat map at real White-tee yardages (par 72, 6,215 yd),
the clubhouse moves from the world origin to the southern boundary, and the road behind it becomes a
barrier. **The user's judgement was that the generated layout does not look like a golf course. The
measurement that backs it: not one of the eighteen holes on a real scorecard is legal under
`CORRIDOR_BAND`** — every real hole is longer than the band's maximum for its par, and the par-4
minimum (148 yd) is shorter than every real par 3.

Second because plan 3 scatters pickups across the course, and verifying a scatter over a routing
about to be replaced is work thrown away.

### 3. `docs/superpowers/plans/2026-09-12-stage-d-pickups-implementation.md`
6 tasks plus one blocked · medium.

Roughly fifty ammo-bucket and hot-dog pickups scattered by seeded variable-radius blue noise across
drivable ground, collected by a per-tick distance poll, each visible as a floating item in a glow
cylinder that stays standing and goes dark for sixty seconds after it is taken.

---

## Read these before you start, in this order

1. **`AGENTS.md`** — house rules.
2. **`docs/TEST-AND-SPEC-PITFALLS.md`** — this repo's named recurring defects. §1 and §2 bear
   directly on every plan here. Six tests on this repo have been green while the bug they were named
   for was fully present.
3. **The spec for whichever plan you are on.** Each plan names its spec in the header. The plan
   argues from the spec; the spec records what was rejected and why.
4. **`docs/DECISIONS.md`** — before touching `src/sim/courseTerrain.ts`, `src/sim/match.ts` or
   either results screen.
5. **`docs/HANDOFF.md`** — the baton. Rewrite it at the end of your session.

Use jCodemunch MCP for code navigation per `CLAUDE.md` — `resolve_repo` first; this repo indexes as
its own root, not as part of the parent folder. Use `Read` only on a file you are about to edit.

---

## How to run a task

Each plan's tasks are bite-sized and ordered. **Do one task, verify it, commit it, then move on.**
Do not batch. The plans use `- [ ]` checkboxes; tick them as you go.

Use **`superpowers:subagent-driven-development`** (fresh subagent per task, review between) or
**`superpowers:executing-plans`** (inline, checkpointed). Either is fine. Ask the user which if they
have not said.

**Red before green, every time.** Every plan has explicit "run it and confirm it fails" steps with
the expected failure text. If a test passes before you have written the implementation, that is a
finding — stop and work out why, because it usually means the assertion is satisfied by something
other than the behaviour it is named for.

**Where the code came first, mutate it.** Several tasks carry a mutation table — change one line,
confirm the named test goes red, revert. Two of those tables have entries that are expected to
*fail to fail*, and say so; that is not an error, it is a recorded limit of the test.

---

## What you need that is not in the repo

**The plat map image.** Plan 2 Task 2 traces eighteen hole centrelines off it, and Task 3 traces
eighteen placements. **You cannot do either without the image open.** Ask the user for it at the
start of Task 2 — they have it.

**It is deliberately not committed**, and should stay that way. It is a third-party plat drawing of
a real course, and this repo takes its licence surface seriously (`LICENSES.md`, `NOTICE`, and the
Reserved-Content analysis in `AGENTS.md`). The coordinates you derive are geometry; the drawing is
somebody's copyrighted work. Keep it out of the tree the same way
`concept-originals-fullres/` keeps the full-resolution art out.

Worth raising with the user once, not repeatedly: the routing being traced is a real, named course.
Layout facts are weakly protected and a drawing is not, but shipping a real club's routing under
another name is the user's call to make knowingly rather than by drift.

---

## The specific traps this session found

Each is written into the plan that needs it. Listed here because a cold session will hit them.

**`arenaSim()` in `src/sim/world.course.test.ts` is not what you would guess.** It is `async`,
returns `{ sim, terrain, holes }` rather than a bare `Sim`, builds a **six-hole** course at 8 m
cells rather than eighteen, and runs with `botCount: 0`. Stepping goes through
`play(sim, [{ ticks, intent }])` — there is no `idleIntent` helper. An earlier draft of plan 3's
tests was written against the shape you would assume and would not have compiled.

**`SPAWN_CLEARANCE_M = 60` makes some contention tests impossible.** Two carts can never be inside
one pickup's 3 m radius on the same tick, because `loadCourse` never spawns them that close. Plan 3
records that rig-order precedence is therefore unasserted, and tests the mechanism one level down
instead. Do not "fix" this by writing a test that teleports carts — writing `cart.position` directly
is fought by `moveCartBody` on the next tick.

**A loop over an empty list passes every assertion inside it.** Several tests here iterate over
holes, ponds, bunkers or sites. Every one of them carries a `expect(checked).toBeGreaterThan(0)`
guard. Keep those guards when you write the code; they are not padding.

**Search, do not trust a line number.** Three steps direct you to `grep` rather than naming a line —
`loadCourse(`, `ArenaSource`, and everything that assumes the clubhouse is at the origin. Those
numbers will have moved. Plan 2 Task 3 Step 4 in particular is a *search*, not an assumption:
`Math.hypot(x, z)` as distance-to-clubhouse is correct only while the clubhouse is at `{0, 0}`.

**Three signatures to verify before trusting plan 2**, each named at the step that needs it:
`createSpline`'s arc-length accessor, `inspectLayout`'s signature and return shape, and whether
`generateHole`'s hazard and green code is separable from its drafting.

**`props.test.ts` will fail on purpose in plan 2 Task 1.** `MARKER_DISTANCES_M` was `[137, 91, 46]`
— the 150/100/50 yard posts converted and rounded. The exact conversions are 137.16, 91.44, 45.72.
**Update the test's expected values; do not round the constants back to match the test.**

---

## Hard constraints on all three plans

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment.
- **Never `Math.random()` in `src/sim/**`.** `PICKUP_CHANNEL = 5` is verified free; 0–4 are taken.
- **No allocation in query paths.** Closure-owned scratch is the existing pattern.
- **`YARD_M = 0.9144`, defined once.** The simulation stays metric — authoring and display convert
  at the boundary. Do not convert `topSpeed`, `CART_COLLIDER`, `COURSE_CELL_M`, any Blender
  dimension, any gate baseline or any probe control.
- **Every `THREE.Mesh` disposes its geometry and material**, and every Rapier body or collider made
  outside `Sim.create()` needs a removal path.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  behaviour; `npm run gate` and `npm run smoke` settle presentation. Both plan 1 and plan 2
  re-baseline the gate, and in both cases its acceptance is a human looking at the picture — in
  plan 2, specifically at whether the course looks like the plat.
- **`npm run plan` after every course change**, `npm run plan:course` after every layout change,
  `npm run probe:terrain` after any change to the assembly.
- **Before `Write`ing a file, confirm it is new** — `git status` or `ls`, not a symbol search. A
  clean `search_symbols` miss is not proof a module does not exist; this repo nearly lost
  `matchScoreboard.ts` that way.
- **`npm run probe` is expected to be red** on the one known driver-distance line. Do not read that
  as a regression without checking it is still only that line.

---

## State you are inheriting

**Branch:** `hole-ownership-near-the-apron`. Everything from the 12 September planning session is
**uncommitted** — three specs, three plans, five reference sheets, `ASSET_PIPELINE.md` §8.5, and two
updated `.scratch` decision logs. Commit or branch as the user prefers before you start writing code.

**The art is done.** Five orthographic modelling sheets are filed in `docs/concept/reference/` at
2048 px with their deviation lists, and their prompts are checked into `ASSET_PIPELINE.md` §8.5.
Two deviations that survived into the shipped sheets and will mislead you if you model from the
images rather than the briefs:

- **`pickup-items-01.jpg`: cross-object scale is wrong by about a quarter.** The bucket and cup are
  each drawn filling a 1.00 m bar when they are 0.80 m and 0.90 m.
- **`clubhouse-exterior-01.jpg`: the windows have mullions and divided panes**, explicitly banned in
  the prompt. That is the largest triangle cost on a 2,500 budget. Simplify in Blender.

**Plan 3 Task 7 is blocked on a Blender session**, not on code: it swaps authored primitive graphs
in for the placeholder geometry Task 5 ships. `src/entities/graphs/pickups.json` does not exist yet.
Task 5 is written so nothing waits on it.

**Stage E has two decisions still open** and is not planned yet. See
`.scratch/blender-landmarks/prd.md`: sign placement against `MAX_PROPS_PER_HOLE = 20`, and whether
the model or `CLUBHOUSE_APRON_M` owns the clubhouse footprint. Eleven of its thirteen questions are
settled.

**Two findings for the backlog, neither belonging to any task:**

- **The installed Rapier binding is built without enhanced determinism.**
  `@dimforge/rapier3d-compat@0.20.0`; the deterministic flavour is a separate published package,
  `@dimforge/rapier3d-deterministic-compat`, not a runtime flag. Nothing in these three plans touches
  physics — but the project's "same seed, same match" promise for a future server is currently made
  on a build documented not to provide it.
- **`decorBoundary.test.mjs` assertion 4 matches mesh extensions as substrings** in `src/sim/**`. A
  comment mentioning `.glb` fails it, and `.obj` would match a member access like `.objects`.
  Currently unstruck.

**One number goes stale during this session.** Plan 1's acceptance figure — 8,824 m² of restored
water, measured at seed 2026 on the current routing — measures a course plan 2 replaces. The *rule*
is unaffected, because its test is per-polygon and structural. **Re-measure and amend the
`DECISIONS.md` entry after plan 2 lands.**

---

## Done when

All three plans' tasks are ticked, each committed separately, and:

```
tsc --noEmit          clean
npm test              green
npm run gate          19/19 PASS
npm run smoke         PASS
npm run probe:terrain PASS at its new control
npm run probe         red on the driver-distance line only
```

Plus the two things no command checks: **all eighteen regenerated hole plans reviewed against the
plat**, and `docs/HANDOFF.md` rewritten as a baton for whoever is next.

Tell the user plainly if executing any of this surfaces something that makes a plan wrong. All three
were written by the same session that specced them, which is exactly the conflict of interest that
makes a fresh reader valuable.

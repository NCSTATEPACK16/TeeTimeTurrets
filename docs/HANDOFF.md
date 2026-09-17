# Handoff — next session

Written 2026-09-16, at the end of the session that took the authored routing from a draft to a
mergeable branch. Rewrite this file at the end of each session; it is a baton, not a log.

---

## Where things stand

**`hole-ownership-near-the-apron` (PR #26) carries the authored eighteen-hole routing and is ready
to merge.** The routing itself was reviewed against the plat by the repository owner and accepted —
that was the branch's one blocking item and it is closed. This picks up from Stage C (arena playable
end to end), which merged as `arena-wiring`.

**Verified at the tip:**

```
tsc --noEmit           clean
npm test               950 passed, 66 files
npm run gate           19/19 PASS
npm run smoke          PASS
npm run probe:terrain  PASS
npm run probe          red on the one known driver-distance line only
```

`npm test` wants `--testTimeout=30000`. At the default 5 s a different two or three Rapier tests
time out each run; this is pre-existing and `main` is flaky the same way. Whether to raise
`testTimeout` in `vitest.config.ts` is still an open decision — deliberately not taken, because
raising it would also hide that flakiness rather than settle it. One test carries its own 30 s
timeout for a stated reason (`world.course.test.ts`'s barrier test: `Sim.create` on an eighteen-hole
heightfield is ~2.7 s locally and ~7 s on CI, and the driving is 0.2 s of that).

## What this branch did

The eighteen holes stopped being discovered by a solver and started being described. Read
`COURSE_PIPELINE.md` §10 before touching anything that builds a course, and `DECISIONS.md`'s last
four sections before touching the barrier or the bots.

Two things landed that are worth knowing about before you read any of it:

**`buildCourseWorld` now rejects anything but the authored holes**, and that guard has already cost
one session. `tools/gate/gateScene.ts` kept handing it `generateCourse(...)`, so the subject threw,
the gate harness never reached `ready`, and `npm run gate` died on a bare 20-second Puppeteer
timeout with no subject named. **If a course-building tool starts timing out rather than failing,
check this first.**

**Arena combat was dead on this routing and two green tests were asserting it.** Bots idled beyond
`BOT_ENGAGE_RANGE`, the authored routing deals carts one to a hole with the closest two tees 74 m
apart, and so no bot ever engaged. `TEST-AND-SPEC-PITFALLS.md` §1 instance 12 is the more useful
record of this than the fix is, and it names the rule that would have caught it: at least one test
per system that takes its inputs from the thing that ships rather than from the test's own hand.

## Pick up here

In the order I would take them.

1. **A bot at the standoff lands nothing.** `BOT_STANDOFF` is 12 m, the bot's club is a driver, and
   a driver is lofted: five bots at ~10 m for eighty seconds took the player from 8 HP to 8 HP
   across 10,321 fire ticks. Not a regression from this branch — `bot.ts`'s ballistics,
   `Ballistics.ts` and `health.ts` are untouched by it — just invisible until bots started arriving.
   **This is the next thing between the arena and a match that can be won or lost.** It wants its own
   measurement pass: standoff against loft, and possibly a different club for bots.
2. **The hazard-aware ownership tie-break.** A work-in-progress patch sits in
   `.superpowers/sdd/2026-09-12-hazard-aware-ownership-tie-break-implementation/` (gitignored). It
   halted on a defect in the generated routing this branch deletes and is expected to pass now.
   **Its recorded water figures — 8,824 m² over 9,993 cells — describe a course that no longer
   exists and must be re-measured.** Check hole 13 first if anything goes red: its cup sits at the
   exact centroid of its own water polygon, safe only because the pond belongs to its own hole.
3. **Stage D pickups.** `docs/superpowers/plans/2026-09-12-stage-d-pickups-implementation.md`, not
   started. Three traps recorded in advance: `pickupScatter.ts` must read the clubhouse from the
   layout and never `Math.hypot(x, z) < CLUBHOUSE_APRON_M`, because `AUTHORED_CLUBHOUSE` is at
   `{ x: -243.4, z: -533.3 }` and not the origin; `PICKUP_CHANNEL = 5` is free while 0–4 and 6 are
   taken (6 is the treeline); and `SPAWN_CLEARANCE_M = 60` makes some contention tests impossible,
   because `loadCourse` never spawns two carts inside one pickup's 3 m radius — rig-order precedence
   is recorded unasserted and tested a level down, and the answer is **not** to teleport carts. Task
   7 is blocked on a Blender session rather than on code; Task 5 ships placeholder geometry so
   nothing waits on it.
4. **The generated solver.** `solveCourseLayout` falls back to the circle construction on six of ten
   seeds since `PAR_MIX` moved to the real card's order. Nothing the player drives on goes through
   it, so it is recorded on `courseLayout.test.ts` rather than fixed. Anyone who wants generated
   courses back wants this first; the fix is teaching the lobe construction about unequal legs.
5. **The half-disc apron**, if it ever earns itself. `DECISIONS.md` has the measurement that says it
   is currently a no-op: all 11 pairs the apron forgives lie north of a clubhouse that sits on the
   southern boundary.

## Traps that have cost sessions in this repo

- **Search, never trust a line number.** Plans and docs here carry stale ones.
- **`npm run probe` is expected RED** on the one driver-distance line. Only a second red line is a
  regression.
- **Confirm a file is new before `Write`ing it** (`git status` or `ls`). This repo nearly lost
  `matchScoreboard.ts` that way.
- **`git checkout <file>` discards uncommitted work.** Restoring a file after a mutation check threw
  away an unstaged fix in this session. Commit before you mutate, or copy the file aside.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  behaviour; `gate` and `smoke` settle presentation.
- **Do not accept an unevidenced green.** Regenerate red/green yourself if a worker dies.
- **Verify "pre-existing" against `main`, not against your own branch tip.** Stashing working
  changes and re-running tests the branch, not the baseline. This session called three smoke
  failures pre-existing on exactly that mistake; a clean `main` worktree said `SMOKE PASS` and they
  turned out to be the visible edge of the dead-bots regression.
- **`art/clubhouse-and-cart.blend` is modified and uncommitted, and no session has touched it.** Its
  state is unexplained. Ask before doing anything with it.

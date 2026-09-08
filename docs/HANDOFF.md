# Handoff — next session

Written 2026-09-08, at the end of the session that implemented the turret spec. Rewrite this file
at the end of each session; it is a baton, not a log.

---

## Where things stand

Two branches are open against `main`, and they are independent:

| Branch | What |
|---|---|
| `phase-1-75-clubhouse-and-round` | Phase 1.75 — screens, scorecard, clubhouse, the round-advance fix. Four commits, read in order. |
| `cart-rider-and-swing` | The rider, the swing rig, and the turret spec on top of it. Branched from the tip of the above. |

**Verified at the tip of `cart-rider-and-swing`:** `tsc` clean · **613 tests / 40 files** (was 595)
· `npm run build` **gate 8/8 PASS** mean delta 0.00, re-baselined · `npm run smoke` PASS including
all four memory gates · `npm run plan` **byte-identical** · `npm run probe` red on the one known
driver-distance line only, and byte-identical to before.

### What this session changed

`docs/superpowers/specs/2026-09-08-turret-geometry-and-swing-plane-design.md`, implemented whole —
both phases, all six decisions. Its own header now lists the three things the spec got wrong.

**`TURRET_GEOMETRY.pivotHeight` names the club's pivot instead of the yaw ring.** It moved 2.05 →
2.60, and `barrel_pitch` is authored to sit exactly there. That closes the 0.26 m muzzle defect
**by construction** rather than by adjustment: the constant now describes something real. The check
that would have caught it in the first place is new — `GolfClub.test.ts` compares `computeMuzzle`
against the world position of `head_slot` and asserts nothing in between, which is precisely what
the two old green assertions could not do between them.

**`pivotForward` is new, and it is why `computeMuzzle` reads `heading`.** The ring is bolted to the
roof 0.45 m ahead of the chassis origin, so the chassis carries the pivot round while slewing the
turret only spins it in place. Those two angles are equal exactly when the turret is centred, which
is why the agreement test insists on a case where they are not.

**The swing is a golf swing.** 0.25 rad off vertical rather than 1.15, a 100° backswing per the
sheet, and a 0.65 rad follow-through. A 0.55 m pedestal under the trunnion is what pays for it —
`art/README.md` carries the arithmetic, and the short version is that the club's *length* does not
appear in it, only how high and how far forward the pivot is.

**The housing pitches back on its trunnion** as `swing-sequence-01.jpg` draws it. `housing_pitch`
is a **sibling** of `barrel_pitch`, so no bug in that animation can reach the muzzle; there is a
test that rotates it to something absurd and checks the club head does not move.

**The club heads have hosels and hang at the heel**, from `club-heads-01.jpg` — the thing its
prompt never asked for and the most useful thing on the sheet.

**The rider has ball joints, a neck and fists.** Eleven new parts, placed in Blender by reading
each limb capsule's own axis endpoints rather than by eye, so a re-posed limb carries its joints.

### The two things that made this session slower than it looks

Both are the same shape: an assumption that was true of one case and got applied to all of them.

- **The binding club is the putter, not the driver.** The spec's arithmetic is the driver's, and at
  3° of loft the putter's head sits 10° lower at the same swing angle and reaches the roof first.
  The clearance test had only ever built a driver. It now runs all three, with a 3 cm margin rather
  than mere non-intersection — the shipped geometry clears by 4.7 cm, and at 0.71 rad it touches.
- **`npm run probe` cannot see the muzzle.** `tools/feelProbe.ts` sets the free ball's velocity
  directly; it never calls `computeMuzzle`. Do not expect a muzzle change to move it, and do not
  read that as the change having done nothing.

---

## Next session

### The flagstick, and now genuinely without a caveat

**Next, and now unblocked in the way it was not before:** the eight-prop course set
(`ASSET_PIPELINE.md` §10 step 8), from `docs/concept/reference/prop-silhouettes-01.jpg`.

1. **Lead with the flagstick.** The cup renders as *nothing* today — `src/render/scene.ts` has no
   flag, no pin, no cup geometry — on all eighteen holes. Highest-value object in the queue and the
   one a player notices first.
2. Then tee marker, bunker rake, ball washer, distance post, cart-path sign.
3. **The bridge is not a prop, it is a design change.** A drivable crossing is *playable* geometry
   under §1, so it cannot be a GLB from any source. And it turns holes 2, 13 and 15's forced
   carries into route choices, which means `validateHole`'s seven checks need re-thinking. That is
   sim work, not an afternoon's modelling.

**Read `docs/concept/reference/README.md` before modelling from the sheet.** Scale is per-cell, so
size every prop against cart height and never against another panel; the footbridge and boardwalk
are three-quarter views, so their deck width is a perspective artefact.

**The turret is settled.** That was the whole argument for doing the spec before the flagstick —
it was the last art work that would move a simulation constant, and it has moved it. Everything in
the prop queue now sits on top of a turret that will not shift under it, so there is no second
gate re-baseline and no second `probe` read waiting.

### Two knobs this session left deliberately unturned

- **The ball still leaves at the top of the backswing, not at impact.** Unchanged and re-affirmed
  by the spec's D4, recorded so it is not re-litigated. The sim fires on the release edge, so the
  downswing plays over the ball's first ~0.09 s of flight; at ~5 frames, with the ball 3 m out by
  the time the club arrives, it reads as "just struck" from 6.5 m. Making it literally true means a
  pending-shot timer in `Cart.fire`, buying accuracy with input latency on every shot.
  `SWING.downswingSeconds` is the knob.
- **`CHASE_HEIGHT` is still 3.6 m and the rider is still hidden under the roof.** Explicitly out of
  scope in the spec, and raising the turret did not change it — the canopy is what hides him, not
  the turret. It is a camera-feel decision, it wants a play session, and there is now noticeably
  more under that roof to see.

### Smaller, and still open

- **Draw calls per cart went from 51 to 78** — the cart's 52 plus the rider's 26, on the player's
  cart and all four bots. Within budget; the fix when it stops being is merging static nodes per
  slot in `primitiveGraph.ts`, not deleting riders.
- **`npm run smoke` is still not part of `npm run build`.** It was run and passed this session, so
  the five-session deferral is broken — but the wiring is still not automatic, and it remains the
  only check that catches bundle-only breakage. ~40 s.
- **Paint is only asserted to stay out of the sim at the data level**, in `loadout.test.ts`. Nothing
  drives a paint purchase end to end. The rider makes this slightly more interesting: his slots are
  disjoint from the cart's by design, and `driverGraph.test.ts` asserts the disjointness but nothing
  drives a repaint and checks he did not change colour.
- **Coins and loadout are page-scoped** and reset on reload — BACKLOG #48.

---

## Loose ends carried forward

- **Driver roll/carry is 0.63 where real golf is ~0.15.** Open since Phase 0, carried in six
  handoffs. The cause is loft, not damping: at 13° the trajectory is near-symmetric so the ball
  lands at a 13° descent angle and skips. Raising `loftDeg` toward 18–20° is the lever. It is club
  balance and wants a play session — **worth actually scheduling.**

  `npm run probe` exits 1 on this one check alone: `driver distance FAIL - 106.7 m total
  (65.3 carry + 41.4 roll) vs REFERENCE_CARRY_M 129, drift 17.3% (limit 15%)`. Do not read a red
  probe as a regression without checking it is still only this line. **And note that raising
  `loftDeg` moves the swing clearance**: loft is what decides how far below horizontal a given
  swing angle puts the club head, and the putter's 3° is currently what caps the follow-through.
- **Cart health is `2 × par` and `Sim.loadHole` re-sizes it**, so advancing par 3 → par 5 heals the
  player. Still unanswered, and reachable. Decide it out loud rather than letting `setMaxHealth`
  decide it.
- **`RenderScene.loadHole` was never built and is not the blocker** an older handoff said. Hole
  advancement rebuilds the whole `RoundScreen`, which the screen manager makes correct and
  leak-free. Reopen only if the rebuild is measurably too slow.
- **Hazard outlines are rectangles.** Honest geometry, correct to the metre. Left undone on purpose.
- **A greenside bunker may end up on the other side** when neither bank at any sampled `t` is clear
  of water. A compromise on the brief's intent; the path still exists.
- **Narrow corridors are closer to the camber limit** on holes 5, 12 and 17.
- **§9 step 8, the self-naming failed brief**, is still unbuilt. `CORRIDOR_BAND[5].max` (375 m)
  still exceeds what `FIELD_FOR_PAR[5]` (300 m) can hold straight even on the diagonal (342 m).
- **`terrainMobility.ts` port** (Phase 2, 159 lines, MIT) still open. Needs a `NOTICE` entry.
- **The 00–15 shot list is still not in the repo**, and `docs/concept/README.md` cites it as
  provenance for sixteen tracked images. Check the prompts in or stop citing them.
- **`docs/course/plans/` is 2.9 MB of generated SVG**, committed as reviewable design docs.

---

## House rules that catch people

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. It is
  what lets `npm run probe`, `npm run plan` and the server import the sim unmodified.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  physics; `npm run gate` and `npm run smoke` settle presentation.
- **`npm run plan` after every course change.** A change that does not show up either did nothing or
  did something you did not intend. A render-only change that *does* move a plan means something
  leaked into `src/sim/`.
- **Get a test to fail for the right reason before you make it pass.** This is the rule that found
  the muzzle defect and the putter, and it has now caught something in three sessions running:
  - a rider-reach assertion measured along z alone, so a rider sitting 0.4 m too low passed it;
  - an impact assertion sampled the boundary between the downswing and the follow-through, where
    the follow-through returns 0 on its own;
  - **two assertions that were each individually true about different nodes** — the yaw ring *was*
    at `pivotHeight` and the head *was* `barrelLength` from `barrel_pitch` — and nothing checked
    they were the same origin. That one shipped a 0.26 m bug for a release. The lesson is not
    "write more assertions", it is that **a test which never compares the two ends cannot see a gap
    between them.**
  - a clearance test that only ever built a driver, so a driver-shaped assumption about loft went
    unchallenged.
- **`Box3.setFromObject` walks the subtree.** Every node in both graphs hangs off a single root, so
  it answers "where is the whole cart" for any node you ask about. Both test files carry an
  `ownBox` helper; use it.
- **Read `DECISIONS.md` before touching ragdolls.** Several plausible Rapier fields are inert
  no-ops in the JS bindings.

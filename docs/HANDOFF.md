# Handoff — next session

Written 2026-09-09, at the end of the session that finished the drivable crossing. Rewrite this file
at the end of each session; it is a baton, not a log.

---

## Where things stand

One branch is open against `main`: **`course-props-crossing`**, carrying the props spec's Phase B and
Phase C. The spec is now **implemented whole** — all ten decisions, all three phases — and its header
carries the one thing it got wrong.

**Verified at the tip:** `tsc` clean · **724 tests / 46 files** (was 613) · `npm run gate`
**17/17 PASS** mean delta 0.00 · `npm run smoke` PASS including all four memory gates ·
`npm run plan` routing unmoved, par 72 · `npm run probe` red on the one known driver-distance line
only, acceptance 84.0% (168/200) unchanged.

### What this session changed

**The crossing became visible.** The sim half of Phase C — `crossing.ts`, `SurfaceId.Bridge`, the
causeway in `terrain.ts`'s shaping pass — was already drivable, classified and tested when this
session opened, and shaded as **turf**. A raised green strip across a pond reads as a bug rather
than as a crossing. `boardwalk_section` is the eighth prop and it closes that.

**It is the first prop with *length*, and that is the whole design.** A crossing spans whatever its
pond is wide, so the deck is authored as one 2 m module and tiled along the segment
`deriveCrossings` returns. Tiling it with `mergeGraph` would have been fifteen draw calls on a
thirty-metre crossing — most of `MAX_PROPS_PER_HOLE`'s twenty spent on one object. So `mergeGraph`
was split at the seam into a shared `bakeInto`/`meshFrom` pair, and **`mergeGraphInstances`** merges
n placed copies of one graph into one draw call. The spec's Phase C bullet does not mention it; it
is what Phase C actually needed.

**Each section carries its own matrix, not a shared stride.** The deck runs onto dry bank at both
ends (`DECK_ABUTMENT_M`) and `terrain.ts` keeps the higher of bank and deck, so a level run would
bury its last sections in the abutment or float them over it. `boardwalkSections` samples the
terrain per section; the matrices are built in the mesh's **local** frame so the boardwalk keeps the
same position/rotation shape every other prop has.

**`atan2(dx, dz)`, and every other prop uses `atan2(dz, dx)`.** A marker faces along its local +X; a
section's *length* runs along its local +Z. Swapped, the decking is a row of six-metre planks laid
broadside down the causeway. Asserted against the crossing's own direction rather than restated.

### The two tests worth reading before you write another one

- **An assertion went green against a function that did not exist.** `expect(() =>
  mergeGraphInstances(...)).toThrow(/instance/i)` passes on `TypeError: mergeGraphInstances is not a
  function` — the word is in the message. Caught only by running it red first and *reading* the red
  rather than counting it. The message is now matched tightly. This is the repo's recurring defect
  in miniature and it took thirty seconds to produce by accident.
- **The section-length guard was proved by breaking it.** `BOARDWALK_SECTION_M` decides where
  section n goes and the `.blend` decides how long section n is; re-author the deck at 2.5 m and
  every crossing gets 0.5 m gaps with nothing else failing. The test measures the shipped graph's
  own geometry, and it was confirmed red by temporarily setting the constant to 2.5.

---

## Next session

### The ground under the deck is still turf-coloured

The one real loose end this session leaves, and it is written up as spec §8's first bullet.
`weights.bridge` is computed by `surfaces.ts` and **read by nobody**: `ground.ts` packs its splat
texture as RGBA = green, corridor, sand, water, and all four channels were spoken for before
`SurfaceId.Bridge` existed.

The planks now cover the deck, so this is cosmetic rather than misleading — but a cart leaving the
deck crosses six metres of **shoulder** that is `Bridge` underfoot and fairway-green to look at.
Closing it means re-encoding the splat, sand/water/bridge as an enum in one channel rather than a
flag each. That touches every branch of the ground shader and **will** move the gate baseline. It is
a decision, not a chore — take it on its own merits.

### And then the sequel D9 named

**Whether a bridged carry should count as playable in `validateHole`.** Crossings are derived after
a hole validates, which is what kept routing bit-for-bit identical through all of this. Relaxing the
wet-run check regenerates the whole course — par, corridor, field size and the acceptance rate all
move. It wants its own spec and its own play session.

### Two knobs still deliberately unturned

- **The ball still leaves at the top of the backswing, not at impact.** Re-affirmed by the turret
  spec's D4. `SWING.downswingSeconds` is the knob; making it literally true means a pending-shot
  timer in `Cart.fire`, buying accuracy with input latency on every shot.
- **`CHASE_HEIGHT` is still 3.6 m and the rider is still hidden under the roof.** A camera-feel
  decision that wants a play session.

### Smaller, and still open

- **Railings are decoration and a cart drives through them.** Consistent with D5 — "leaving the deck
  is a choice you make down a shoulder, not a fall you suffer" — and with the spec's explicit
  exclusion of invisible walls anywhere. Recorded so it is not read as an oversight.
- **`npm run smoke` is still not part of `npm run build`.** Run and passed this session. Still not
  automatic, still the only check that catches bundle-only breakage. ~40 s.
- **Draw calls per cart are 78** (52 cart + 26 rider), on the player's cart and all four bots. The
  fix when it stops fitting is merging static nodes per slot — and `mergeGraphInstances` is now the
  second half of that tool, since bots are n copies of one graph. It still costs slot recolouring,
  so the *player's* cart cannot use it without losing the clubhouse loadout.
- **Paint is only asserted to stay out of the sim at the data level.** Nothing drives a paint
  purchase end to end.
- **Coins and loadout are page-scoped** and reset on reload — BACKLOG #48.

---

## Loose ends carried forward

- **Driver roll/carry is 0.63 where real golf is ~0.15.** Open since Phase 0, carried in seven
  handoffs. The cause is loft, not damping: at 13° the trajectory is near-symmetric so the ball
  lands at a 13° descent angle and skips. Raising `loftDeg` toward 18–20° is the lever. It is club
  balance and wants a play session — **worth actually scheduling.**

  `npm run probe` exits 1 on this one check alone: `driver distance FAIL - 106.7 m total
  (65.3 carry + 41.4 roll) vs REFERENCE_CARRY_M 129, drift 17.3% (limit 15%)`. Do not read a red
  probe as a regression without checking it is still only this line. **And note that raising
  `loftDeg` moves the swing clearance**: loft decides how far below horizontal a given swing angle
  puts the club head, and the putter's 3° is currently what caps the follow-through.
- **Cart health is `2 × par` and `Sim.loadHole` re-sizes it**, so advancing par 3 → par 5 heals the
  player. Still unanswered, and reachable. Decide it out loud rather than letting `setMaxHealth`
  decide it.
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
  leaked into `src/sim/`. This session's boardwalk is render-only and moved no plan, which is the
  check working.
- **The plan SVGs changed on five holes and that is correct.** Holes 2, 7, 13, 15 and 18 carry
  crossings; their surface fills and contour lines move because a raised causeway moves pixels. Every
  `<circle>`, `<ellipse>`, `<polygon>` and `<text>` — tee, cup, hazard outlines, par and corridor
  labels — is byte-identical, and the other thirteen holes are untouched. That is D9's claim, and it
  is how to check it rather than eyeball it.
- **`npm run probe` gained one line** (`bridge 0.0%` in the surface mix) and is otherwise unchanged.
  Criterion 9 asked for byte-identical; that line is the honest deviation.
- **Get a test to fail for the right reason before you make it pass.** It has now caught something
  in four sessions running. The newest instance is the cheapest to reproduce and the most alarming:
  an assertion matched `/instance/i` against a *missing function's* TypeError. **Read the red, do
  not count it.**
- **`Box3.setFromObject` walks the subtree.** Every node in both cart graphs hangs off a single root.
  Both test files carry an `ownBox` helper; use it.
- **`mergeGraph` bakes colours into vertices**, so a merged graph cannot be recoloured by slot. Props
  and bots can use it; the player's cart cannot without losing the clubhouse loadout.
- **Read `DECISIONS.md` before touching ragdolls.** Several plausible Rapier fields are inert no-ops
  in the JS bindings.

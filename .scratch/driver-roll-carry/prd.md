# Driver roll-to-carry ratio — working stub

**Status: pre-grilling.** Feature statement, what the codebase already provides, and the decisions
that are still open. No user stories, no implementation decisions, no acceptance criteria.

Item 4 of 4 in this session's queue.

---

## The feature, as stated

From `docs/HANDOFF.md:160-166`:

> Driver roll/carry is 0.63 where real golf is ~0.15. Open since Phase 0, carried in ten handoffs
> now. The cause is loft, not damping: at 13° the trajectory is near-symmetric so the ball lands at
> a 13° descent angle and skips. Raising `loftDeg` toward 18–20° is the lever. **Worth actually
> scheduling.** `npm run probe` exits 1 on this one check alone (17.3% drift vs a 15% limit this
> session). Raising `loftDeg` moves the swing clearance — the putter's 3° currently caps the
> follow-through.

---

## What the codebase already provides

**One club table, `src/physics/Ballistics.ts:41-45`**, and `AGENTS.md` forbids a second copy:

| Club | `loftDeg` | min/max | charge | reload | spread |
|---|---|---|---|---|---|
| Putter | 3 | 2/9 | 0.5 | 0.4 | 1 |
| Iron | 22 | 8/24 | 0.9 | 1.1 | 3 |
| Driver | 13 | 14/40 | 1.4 | 2.2 | 5 |

**The probe's baselines are inline constants, not golden files, and not self-baselining.**
`tools/feelProbe.ts:328-337` — `driverDistanceCheck` computes
`drift = |totalM − REFERENCE_CARRY_M| / REFERENCE_CARRY_M` and fails above `0.15`.
`REFERENCE_CARRY_M = 129` (`src/sim/carry.ts:26`), `DRIVER_CARRY_M = 69.5` (`carry.ts:38`). These
are fixed targets — a loft change moves the measurement, not the target, so the probe genuinely
grades the change rather than re-recording it.

**The flight model has no spin.** `computeLaunchVelocity` (`Ballistics.ts:70-81`) splits `maxSpeed`
by loft; the magnitude is loft-invariant. `computeDragForce` (`Ballistics.ts:109`) exists but its
own docstring says it is never called. Real flight is Rapier gravity plus `LINEAR_DAMPING 0.05` /
`ANGULAR_DAMPING 0.6` (`world.ts:71,84`). Bounce is collider `BALL_RESTITUTION 0.35` averaged with
ground `0.15` → 0.25 (`world.ts:109,569`), plus per-tick `Sim.applySurfaceResistance`
(`world.ts:1283-1295`). Roll is purely restitution, friction and rolling resistance.

**Per-surface rolling / bounceScale** (`src/sim/surfaces.ts:111-120`): Green .06/.9, Fairway
.11/.7, Rough .22/.45, Sand .55/.12, Water .9/.05, Bridge .04/.95. Roll terminates in finite time
via constant deceleration; rest is `REST_SPEED_THRESHOLD 0.25` held `REST_HOLD_TICKS 12`.

**Other `loftDeg` readers:** `GolfClub.ts:297` (render pose), `Cart.ts:492` `computeMuzzle` (muzzle
position for **both** ball paths), `clubhouseState.ts` `vacuumRange` (the clubhouse RANGE bar,
`v²sin(2θ)/g`). `RoundScreen.ts:589` reads only `reloadSeconds`; HUD and aim read nothing.

**`DECISIONS.md` has no loft entry.** `BACKLOG.md:27` item 7 logs *"Backspin / descent-angle model
— IDEA — would fix the ratio at source rather than via loft."*

---

## Load-bearing facts that reshape the design

1. **The handoff's swing-clearance warning is backwards.** `applyLoft` (`GolfClub.ts:296-298`) sets
   `barrelPitch.rotation.x = −loft` and the swing nodes sit *below* the loft node, so loft offsets
   the whole arc. The putter at 3° is 10° **lower** than the driver at equal `swing_arm` angle and
   is the club that hits the canopy at 0.71 rad — `followThroughRadians 0.65` (`GolfClub.ts:73`)
   leaves it 4.7 cm. **Raising the driver alone relaxes the driver's clearance and does not touch
   the putter's cap.** The cap is a putter fact. This removes the constraint the handoff treats as
   the main risk.
2. **The real blast radius is `npm run gate`, which the handoff does not mention at all.**
   `tools/gate-baseline/metrics.json` holds per-club bbox goldens (`cart-driver`, `cart-iron`,
   `cart-putter`, `cart-backswing`, `cart-empty`, `cart-followthrough`) at **0.5% tolerance**
   (`gateCompare.mjs:22`), plus perceptual signatures at threshold 6. `ASSET_PIPELINE.md:753` states
   the bbox **is** the loft signal. `npm run gate` runs inside `npm run build` (`package.json:8,11`),
   so changing driver loft **turns `npm run build` red** until `npm run gate -- --update-baseline`
   is run and the PNGs are reviewed. These are the only true golden files in play.
3. **`REFERENCE_CARRY_M` and `DRIVER_CARRY_M` are not probe-only.** `REFERENCE_CARRY_M` drives
   `derivePar` (`course.ts:247`) and the three-driver reach limit (`:272`); `DRIVER_CARRY_M` drives
   water-carry check 6 (`:376`). Re-recording either **regenerates par and the entire nine**.
   Ceilings exist: `course.test.ts:289` breaks above `REFERENCE_CARRY_M` 153.3, `:221` breaks above
   `DRIVER_CARRY_M` 100.
4. **Arena combat shares the launch path.** `world.ts:1244-1251` fires pooled balls through
   `computeMuzzle` + `computeLaunchVelocity`. Launch *speed* is loft-invariant so speed-scaled
   damage (`combat.ts:35-37`) is unaffected, but **the aim and arc of every combat shot changes**.
   Pooled balls are not touched by `applySurfaceResistance`.
5. **The docs disagree on the number being fixed.** `HANDOFF.md:160` says 0.63; `ROADMAP.md:55`,
   `RESEARCH-NEEDED.md:117` and `BACKLOG.md:27` all say 0.86 (= 59.5/69.5). Nothing can be measured
   against a target until this is reconciled.
6. **Tests that stay green are self-referencing** (`GolfClub.test.ts:99`, `Ballistics.test.ts:51-69`,
   `Cart.test.ts:288-307`, `clubhouseState.test.ts:183-191`, `world.cart.test.ts:200-210` — putter
   < 0.6 × driver). They derive from the table rather than pinning values, so they would **not**
   catch a regression here. Only the probe and the gate would.

---

## Decisions this design needs

Open. None are mine to settle.

1. **Is the target realism (~0.15) or arcade feel,** and **is the ratio itself the acceptance
   criterion** — or is carry distance, or how the shot reads on screen?
2. **Loft, or the backspin / descent-angle model** in `BACKLOG.md:27`? Loft is a one-number tuning
   edit; spin is a new mechanism that fixes the cause rather than the symptom.
3. **Driver only, or all three clubs?** The 3 / 22 / 13 spread is currently the language that tells
   the clubs apart by feel.
4. **If all three move, what replaces the putter's 3° as the follow-through cap,** and does
   `followThroughRadians 0.65` get re-measured?
5. **Re-record `REFERENCE_CARRY_M` / `DRIVER_CARRY_M`** — regenerating par and the whole nine,
   against `course.test.ts` ceilings of 153.3 and 100 — **or hold them and accept a shorter driver?**
6. **Who approves the re-baselined gate PNGs,** given `AGENTS.md`'s Visual Critic protocol and that
   `npm run build` is red until it happens?
7. **Is arena combat aim allowed to change as collateral,** or does arena need its own launch path?
8. **Which number is real, 0.63 or 0.86** — and does reconciling the four docs land in this work or
   ahead of it?

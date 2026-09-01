# Reuse map — Claude of Tanks → TeeTimeTurrets

What we take from the reference project, what we take only the *shape* of, and what we
build from nothing. Reference repo: `../Claude-of-Tanks-main`.

## The licence line, first

Claude of Tanks is **MIT with a Reserved Content carve-out** (`LICENSE-POLICY.md`, © 2026
Kevin B. Liu). This is not a formality — the carve-out covers exactly the two subsystems a
golf game would most want to crib.

| Reference path | Licence | Can we use it? |
|---|---|---|
| `src/sim/**` | MIT | Yes, with attribution |
| `src/engine/**` | MIT | Yes, with attribution |
| `src/net/**`, `server/**` | MIT | Yes, with attribution |
| `src/game/**`, `src/ui/**` | MIT | Yes, with attribution |
| `src/vehicles/**` | **Reserved** | **No** |
| `src/world/**` | **Reserved** | **No** — this is terrain, maps, props, vegetation |
| `docs/research/**`, `docs/references/**` | **Reserved** | **No** — incl. `movement-physics.md` |

Three rules that follow, and they are binding:

1. **Never port from `src/world/**` or `src/vehicles/**`.** Terrain generation, course
   layout, props, and all cart/clubhouse geometry are ours from scratch. They already are.
2. **`docs/research/movement-physics.md` is Reserved even though the `movement.ts` that
   implements it is MIT.** Read the code, not the research doc, and do not lift its tuning
   constants — they are the Reserved artefact, the code is the MIT one.
3. **MIT still requires attribution.** Anything copied or closely derived keeps the
   copyright and permission notice and gets an entry in the root **`NOTICE`** — which is the
   Apache-2.0 convention and already has the entry template. (An earlier draft of this rule
   said `docs/ATTRIBUTION.md`; do not create a second attribution file — see BACKLOG #38.)
   Re-implementing to the same public interface is not a derivative work; a close port is.
   When in doubt, port and attribute — it is free.

## Take the code

Small, dependency-free, MIT, and directly applicable. Copy with attribution.

| Reference file | Lines | What it buys us |
|---|---|---|
| `src/sim/terrainMobility.ts` | 159 | **Zero imports.** Pure functions: (spec, ground type, slope) → drive acceleration, grip coefficient, slope margin, travel cost. This is the cart's tuning layer sitting on top of our `surfaces.ts`. The single highest-value file in the repo for us. |
| `src/game/consumables.ts` | 42 | Zero-dep cooldown model for kit items: `CONSUMABLE_RULES`, `startConsumableCooldown`, `cooldownRemaining`. This *is* the food/drink-cart pickup system — swap repair/first-aid/extinguisher for ammo/drink/snack. |
| `src/game/stateCore.ts` | 121 | `mulberry32` seeded RNG + a typed event bus. We already need the seeded RNG: `Ballistics.applyAimSpread` takes an injected `random` and currently has no seeded source to inject. |
| `src/sim/rollover.ts` | 65 | Rollover/auto-right lifecycle. Directly applicable to a cart that flips. |

## Take the shape, write the code

Too large, too tank-specific, or built on a different physics substrate — but the
decomposition is right and copying it saves real design time.

| Reference | Why not a direct port | What we copy |
|---|---|---|
| `src/sim/movement.ts` (2320 lines) | Hand-rolled integrator that owns the vehicle pose; we use Rapier's character controller | The four-way split: `MovementSpec` (static tuning) / `TankState` (mutable pose) / `MovementInput` (intent) / `MovementHeightField` (injected sampler). `Cart.ts` gets the same shape. |
| `src/engine/frameLoopScheduler.ts` (190) | Our `GameLoop.ts` already works | Idle cadence, input wakeups, backgrounded-tab rescue. Adopt when there is an idle state (i.e. the clubhouse) to be idle in. |
| `src/ui/garage.ts` (2440) + `src/game/garage*.ts` | Tank-specific presentation, and the *closest analogue to the clubhouse* | Garage = clubhouse. The pattern of a non-combat hub phase that owns loadout selection, upgrades, and a showroom camera, with its own residency/warm lifecycle so it does not fight the battle scene for GPU. |
| `src/game/equipment.ts` (435) | Tank modules | The equip-slot data model for club/cart upgrades bought at the clubhouse. |
| `src/net/protocol.ts`, `src/net/snapshot.ts` | We are using Colyseus, it is not | Snapshot shape and the discipline of replicating *events*, not per-frame state. |

## Take the invariants (highest value, zero code)

From the reference `AGENTS.md`. Already adopted in ours, and they are why the headless
`npm run probe` works at all:

- Fixed `SIM_DT = 1/60`; rendering may be variable-rate.
- Simulation randomness is seeded/injected — no `Math.random()`, no wall-clock, in
  authoritative logic.
- Simulation and network modules stay Node-runnable and free of DOM/WebGL.
- No per-frame allocation in hot loops; reuse scratch state.
- Colocated self-tests (`*.selftest.mjs`) run by a plain Node runner, no test framework.

## Build completely fresh

Nothing to reference — either Reserved, or the reference game has no equivalent.

| System | Status | Note |
|---|---|---|
| `src/sim/terrain.ts` — heightfield, pads, water level | **Built** | Reserved-adjacent; ours from scratch |
| `src/sim/surfaces.ts` — green/fairway/rough/sand/water | **Built** | No analogue: tanks have `groundType` but not a golf course |
| Ball physics: rolling resistance, bounce, hole-out | **Built** | Nothing in the reference rolls. Shells fly and hit. |
| Water as a stroke-and-distance hazard | **Built** | No analogue |
| Golf rules: strokes, penalties, par, scorecard | Partly built | `Sim.strokes` / `holedOut` exist; par and scorecard do not |
| Swing charge/release feel | **Built** | Tanks fire instantly; a charged swing is ours |
| Clubhouse geometry and layout | Not started | Reserved analogue — build fresh, reference only the *phase* pattern |
| Cart, club, flag, pickup geometry | Not started | Reserved analogue — procedural primitives only |
| CTF with a heavy physics flag-ball | Not started | No analogue; tanks capture zones, not objects you hit |

## Correction to an earlier recommendation

`DECISIONS.md` previously argued the cart should be hand-rolled rather than a Rapier body,
on the grounds that Phase 5 determinism required it. **The research settles this the other
way and the earlier recommendation is withdrawn.**

The reasoning: that argument was downstream of assuming replicate-from-seed netcode. The
research chose **snapshot interpolation** instead — the server runs the authoritative Rapier
sim and broadcasts state; clients interpolate and predict locally. That removes the
cross-platform determinism requirement entirely, which was the whole basis for hand-rolling.
With it gone, Rapier's `KinematicCharacterController` is the better choice: less code, and
it gives the hover/slide arcade feel directly.

Verified present in the installed Rapier 0.20:
`setSlideEnabled`, `enableSnapToGround`, `setMaxSlopeClimbAngle`, `setMinSlopeSlideAngle`,
`enableAutostep`, `setApplyImpulsesToDynamicBodies`, `setCharacterMass`, `computedGrounded`.

`terrainMobility.ts` survives the change unaffected — it is a tuning layer over whatever
integrates the movement, so it sits on top of the character controller just as well.

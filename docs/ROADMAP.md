# TeeTimeTurrets — Phased Implementation Plan

Each phase lists what must exist and what must pass before moving to the next. Don't start
a phase's work until the previous phase's gate is green — this is the same "de-risk before
you build on top" logic the original research doc argued for making Phase 0 come first.

**Visual target:** `docs/concept/` holds the concept art and `docs/UI-SPEC.md` translates it
into an element-by-element specification — which HUD element comes from which image, which
phase owns it, and which sim field feeds it. Phases 1.75 onward reference shots by number
(`image 08`); read `UI-SPEC.md` rather than re-deriving intent from the pictures. Nothing in
`docs/concept/` ships or is loaded by the game.

## Phase 0 — Physics/swing feel spike — ✅ DONE

**Built:** `src/sim/world.ts` (Rapier world, heightfield terrain, ball body with CCD),
`src/sim/terrain.ts` (noise heightfield shared by physics and mesh), `src/render/scene.ts`
(Three.js presentation), `src/engine/GameLoop.ts` (fixed-step accumulator), `src/physics/
Ballistics.ts` (launch math, club stat table), `src/main.ts` (wiring, keyboard input).

**Gate passed:**
- [x] `tsc --noEmit` clean.
- [x] Heightfield row/col ↔ world X/Z axis convention verified empirically against the
      installed Rapier build (not assumed from memory/docs).
- [x] Headless-browser trajectory check: launched a full-power shot, sampled live ball
      position for 3.6s — Y stayed bounded (no tunneling/free-fall divergence), X/Z showed
      terrain-consistent curving.
- [x] No console errors on load or through a full swing.

**Feel tuning pass — ✅ DONE.** Measured with `npm run probe` (`tools/feelProbe.ts`, a
headless harness that imports `src/sim/**` unmodified — the first real payoff of the DOM-free
rule). Before → after:

| | before | after | target |
|---|---|---|---|
| terrain mean slope | 19.1° | 4.3° | 2–5° (real fairway grade) |
| terrain max slope | 44.5° | 12.5° | <15° on playable ground |
| tee pad step | 1.1 m drop / 26° | flat (2°) | flat |
| putter settle time | 11.3 s | 3.2 s | <4 s |
| full driver | left the map in 0.95 s | 129 m, in bounds | in bounds |

Four causes, only two of which were numbers:

1. *Amplitude/frequency.* Slope, not height, is what the ball feels: for a noise octave it
   goes as `A · 2πf`, so amplitude and frequency are one knob. The detail octave was the
   bigger culprit — at 0.25 amplitude / 3× frequency it contributed 75% as much grade as the
   base layer.
2. *Field too small.* The field was 40 m; a full driver carries ~70 m. It left the map
   without ever touching the ground. Now 160 m at a 1.00 m cell.
3. *Tee pad blended toward absolute y=0* rather than the local terrain height, which pinned
   the tee to a pinnacle whenever the surrounding ground wasn't near zero. Now blends toward
   the terrain height at the tee, with a smoothstep so there's no slope discontinuity ring.
4. *Rolling resistance did not exist.* This was the settle-time bug and it was a missing
   mechanism, not a bad number — see `docs/ARCHITECTURE.md` §2b.

**Still open, needs playtesting (not a blocker):** the driver's roll/carry ratio is 0.86
(69.5 m carry, 59.5 m roll) where real golf is ~0.15. The cause is loft, not damping: at 13°
the trajectory is near-symmetric so the ball lands at a 13° descent angle and skips rather
than stopping. Raising driver `loftDeg` toward 18–20° is the lever; that's club balance, so
it wants a play session rather than more arithmetic.

## Phase 1 — Structural extraction, still single-club, still stationary

**Goal:** the refactor that makes every later phase additive instead of a rewrite. No new
gameplay.

- [x] Extract `Ballistics.ts` (club stats, launch math) out of `world.ts`.
- [x] Extract `GameLoop.ts` (fixed-step accumulator) out of `main.ts`.
- [x] Add a test runner (Vitest — fits the existing Vite toolchain) and colocate tests for
      every pure function in `Ballistics.ts`. Runs in the **node** environment, which turns the
      DOM-free rule for `src/sim/**` and `src/physics/**` into something the suite enforces
      rather than something a reviewer has to notice.
- [x] Add `tools/sceneGate.mjs` v1 (see `AGENTS.md` "Visual Critic / Scene Gate") — even a
      version that only checks the ball and ground mesh is worth having before Phase 2 adds
      more geometry to regress. **Built:** a fixed headless-Chrome harness page loads each
      subject and the gate diffs two independent halves against `tools/gate-baseline/` —
      structural metrics off the `BufferGeometry` and a downsampled perceptual signature off the
      canvas — exiting non-zero on drift in either. Five subjects are baselined: `cart-driver`,
      `cart-iron`, `cart-putter`, `ball`, `target`. Wired into `npm run build`, which now runs
      `npm run gate` after `vite build`, so a geometry regression fails the build rather than
      waiting to be noticed. `tools/smoke.mjs` (`npm run smoke`) remains a separate thing: it
      drives the real browser input path and asserts no console errors, with no geometry
      baseline and no perceptual diff.

**Gate:** `tsc --noEmit` clean; the Phase 0 headless trajectory check still passes
unchanged (regression check for the extraction, already re-run once after this refactor —
see `docs/ARCHITECTURE.md` for what changed); new Vitest suite green.

## Phase 1.5 — The golf loop — ✅ DONE

Inserted ahead of the cart because the project was named for a sport it did not yet
implement: a player could hit a ball 129 m and nothing happened. Small, unblocked, and
everything downstream (HUD, scoring, CTF, multiplayer scoring) needs it to exist.

- [x] `src/sim/surfaces.ts`: green / fairway / rough / sand / water as a pure function of
      (x, z), with per-surface `rolling`, `bounceScale`, `cartSpeedScale`. One surface table,
      replacing the unused `SURFACE_TUNING` stub in `Ballistics.ts`.
- [x] A cup, a green, and hole-out detection (`Sim.holedOut`).
- [x] Water as a stroke-and-distance hazard: penalty stroke, drop at the last safe position.
- [x] Stroke counting (`Sim.strokes`), including penalties.
- [x] Sand that plays like sand — high rolling resistance *and* a near-dead bounce. Per-surface
      restitution cannot live on the collider (one heightfield covers the whole course), so it
      is applied per tick in `Sim.step()`.

**Gate passed:** `npm run probe` reports a playable course — fairway 28% / rough 63% /
sand 5% / water 2.5% / green 1.4%, a 123 m hole with one water carry at 41 m that the driver
clears and the iron does not — and asserts both new rules fire (`water PASS`, `hole-out PASS`)
rather than inferring them from distance numbers.

**Found by that gate:** `ANGULAR_DAMPING` was still 3.8, the value tuned when it was the only
thing ending a roll. With real rolling resistance now doing that job, the leftover damping
stopped a 2 m putt 0.70 m short of the cup. Now 0.6. Velocity-proportional damping bites
hardest exactly where putting lives.

## Phase 1.75 — App shell, screens, and the scorecard

> **Status note (2026-09-02):** Deprioritized, not dropped — combat gameplay (cart-vs-cart
> shooting) is the current priority; see the ammo/pooled-ball spec below. STROKE mode stays a
> real future destination once combat has an audience.

Inserted ahead of the cart for the same reason Phase 5 is deferred rather than sprinkled in:
the game currently boots straight into a single always-live scene, and a screen manager
retrofitted onto that assumption is a rewrite, not an add. It is also small — three screens
and a tally — and it unblocks the economy, since image 13's four stat tiles are the only
plausible source of the round earnings Phase 3.5 spends.

Numbered 1.75 rather than renumbering everything: `AGENTS.md`, `BACKLOG.md` and `DECISIONS.md`
all cross-reference phase numbers, and breaking those references costs more than an awkward
decimal.

- [ ] `src/app/ScreenManager.ts`: a small finite set of screens, exactly one active, explicit
      `enter()`/`exit()`. **Every screen disposes its own geometry and materials on exit**
      (`AGENTS.md` resource-cleanup rule) — this is the whole reason the phase exists, and the
      thing a later clubhouse would otherwise get wrong. Screens registered now: Title,
      Round, Results, plus a Settings stub. Lobby and Clubhouse are reserved slots, not built.
- [ ] `src/ui/screens/TitleScreen.ts` — image 10. Logo, `PLAY` / `CLUBHOUSE` / `MULTIPLAYER` /
      `SETTINGS`, version string, and a **live course scene behind the panel**. The live
      backdrop is deliberate: it forces the screen manager to share the renderer with the
      round from day one instead of discovering that requirement at the clubhouse. Buttons for
      unbuilt screens are visibly disabled, not dead.
- [ ] Par per hole, and a round. `src/sim/round.ts` owns par, the per-hole card, and the
      running total; `Sim` keeps owning the *current hole* and its existing `strokes`.
      **Don't bolt the round onto `Sim`** — `Sim` is one hole's physics, a round is a list of
      them, and merging the two is what makes multi-hole (BACKLOG #2) expensive later. Stays
      DOM-free like everything in `src/sim/**`, so `npm run probe` can score a round.
      (BACKLOG #1, pulled forward — Results has nothing to display without it.)
- [ ] Round stats recorded from the start, even where three of four read zero:
      direct hits, longest drive, targets down, accuracy. Image 13 shows them, Phase 3 fills
      them in, Phase 3.5 spends them.
- [ ] `src/ui/screens/ResultsScreen.ts` — image 13. Nine columns plus `TOTAL`, `PAR` and
      `STROKES` rows, under-par ringed green and over-par boxed red, the four stat tiles,
      `MAIN MENU` / `NEXT HOLE`. **Ships nine-column with one hole live**: the layout is the
      expensive part and multi-hole (BACKLOG #2) then fills columns without touching it.
- [ ] `tools/sceneGate.mjs` baseline extended to cover screen transitions, once Phase 1 has
      built it.

**Gate:** enter and leave every registered screen 20× in a loop with no growth in
`renderer.info.memory` (geometries/textures) — the leak this phase exists to prevent, and the
one Phase 3.5's clubhouse gate later repeats; `npm run probe` plays a scripted round and the
Results screen's numbers match the probe's own tally exactly, rather than being eyeballed; the
title screen's course backdrop renders without stalling the first frame of a round.

## Phase 2 — The cart: movement, turret, club-swap

**Goal:** the "golf cart as tank chassis, turret swaps between putter/iron/driver with
different range/power/reload" mechanic, layered on top of the still-working stationary
swing (both modes coexist — see design decision below).

- [x] `src/sim/entities/Cart.ts`: authoritative chassis position/heading via Rapier's
      `KinematicCharacterController` (settled by research — see `DECISIONS.md`; the
      hand-rolled alternative is withdrawn), turret yaw (independent of chassis heading),
      equipped `ClubType`, reload timer gated by `CLUB_STATS[club].reloadSeconds`.
      Built as a Rapier-free state machine that emits a *desired* translation, with `world.ts`
      owning the controller and everything vertical. That split is what makes the whole thing
      unit-testable and is the same split Phase 5 replays intents through.
- [x] Recoil as self-propulsion: firing the driver backward boosts the cart. **A kinematic
      character controller receives no impulses** — recoil is a velocity term `Cart.ts` owns
      and decays itself. Budget for this; it is not `applyImpulse`.
      **Direction is settled: recoil opposes the shot**, so a forward-facing driver shoves the
      cart backward. Image 04 appears to show the opposite; `UI-SPEC.md` §7 explains why the
      image is read as a rear-end squat rather than a forward boost.
      **Now implemented, so `UI-SPEC.md` §7's note can be deleted.** It gained a rule the plan
      did not have: a shot only counts as a stroke if the cart is within `STRIKE_RANGE` of the
      ball, so firing away from your ball is *pure propulsion at no stroke cost*. One button is
      both the golf swing and the engine, and where you park decides which.
- [x] `src/input/InputSource.ts`: an input *interface* — throttle/steer as a normalised
      vector, brake, turret aim, fire, club select, mode toggle — with `KeyboardMouseSource`
      as the only implementation in this phase. **Write the interface against image 14's
      control inventory** (`UI-SPEC.md` §4), not against a keyboard. Touch lands in Phase 4;
      if the interface assumes key states now, that becomes a refactor of every input path
      instead of one new class. This is the cheap version of the same mistake Phase 5 warns
      about. Binding table is a pure function (`src/input/mapping.ts`) so it tests without a DOM;
      `KeyboardMouseSource` is listener bookkeeping only.
- [x] Consume `surfaces.ts` `cartSpeedScale` so sand and water bog the cart down.
- [x] Cart cosmetics as **data on the cart, not a clubhouse feature** (image 11, image 00):
      **tire type is a stat** — it scales grip and interacts with `cartSpeedScale`. `TIRE_TUNING`
      in `Cart.ts` is a genuine trade rather than a ladder: turf is fastest and grippiest on
      fairway and worst in a bunker, knobby gives up top speed to barely notice rough and sand.
      A tire scales how much of a surface's penalty *reaches* the cart, not the surface itself.
      **Partial:** turret skin and chassis paint (material parameters) are not built — no UI sets
      them until Phase 3.5 and nothing else reads them.
- [ ] Port `terrainMobility.ts` (159 lines, MIT, zero imports — see `REUSE-MAP.md`) as the
      slope/grip tuning layer over the controller. **Still open** — the KCC's own
      `setMaxSlopeClimbAngle`/`setMinSlopeSlideAngle` cover enough for the spike, so this is
      now a tuning refinement rather than a prerequisite. Needs a `NOTICE` entry when ported.
- [x] Wire `src/entities/GolfClub.ts` (already built, not yet wired) to read `Cart.ts`
      snapshots instead of its current standalone local state. Note the yaw-convention
      conversion this needed: sim yaw 0 is world +X, a Three object's local +Z is its forward,
      so the group's `rotation.y = PI/2 - heading` and the turret pivot (a child) is
      `heading - turretYaw`. Documented in `render/scene.ts`.
- [x] Input: throttle/steer for the cart, separate aim input for the turret, a club-select
      key/button, reload gauge feeding the existing power-bar-style HUD element. **Partial:**
      the power bar shows swing charge and reload state is a text readout, not a gauge — the
      proper meter is Phase 4's, built to image 08 rather than grown one span at a time.
- [x] Camera: third-person chase behind the cart (extend `RenderScene`'s existing lerp-follow
      camera, which already follows a moving target). Image 03 is the framing reference —
      cart low in frame, horizon high, enough lead to see the next hazard. Unblocks
      BACKLOG #31; the current fixed-offset camera will not survive a 160 m course.
      Tracks the *turret*, not the chassis, and clamps the eye above the terrain so reversing
      into a slope does not put the camera inside the heightfield.
- [x] `tools/sceneGate.mjs` baseline extended to cover the cart + all three club heads.
      Landed as part of Phase 1's `sceneGate.mjs` build, not a separate follow-up: the cart and
      all three club heads (`cart-driver`, `cart-iron`, `cart-putter`) are baselined subjects
      from the gate's first version, alongside `ball` and `target`.

**Gate:** drive the cart around the terrain patch without falling through it or getting
stuck on a slope it shouldn't; swap all three clubs and confirm each fires with visibly
different range/arc matching its stats; reload timer actually blocks re-firing until it
elapses; stationary-swing mode (Phase 0's mechanic) still works unmodified as an alternate
mode — both are being kept, not one replacing the other, per the user's explicit direction;
and the mode toggle moves between them cleanly, since `UI-SPEC.md` §1 shows the two modes
carry different HUDs rather than the same one with elements greyed out. A second
`InputSource` implementation that only replays a scripted array of intents drives the whole
gate headlessly — if it can't, the interface is still keyboard-shaped and Phase 4 will pay.

**Gate status — passed except the HUD split.** `src/sim/world.cart.test.ts` is the gate, and it
is driven entirely through `ScriptedInputSource` with no direct `Sim` calls, which is the part
that actually proves the interface. 82 tests green, `tsc --noEmit` clean, `npm run probe`
unchanged from Phase 1.5 (terrain 4.3°/12.5°, surface mix 27.9/63.2/5.0/2.5/1.4, water and
hole-out both PASS), `npm run smoke` green through the real browser input path.

One carve-out remains, deliberate:

1. **The two modes share one HUD**, where `UI-SPEC.md` §1 wants two. The current readout is a
   minimal mode/club/strokes/status line, not image 08. Splitting it belongs with Phase 4
   building the real HUD, not with growing this one.

### The turret carries the ball — corrected against the concept art

The first pass had the cart drive up to a ball lying on the course and strike it where it lay.
**That is not what images 03 and 04 show, and it is not the game.** Re-read against the art and
corrected in the same phase:

- **The turret sits on the cart's roof and its barrel *is* a golf club** — a shaft with the club
  head as the muzzle (image 03). Swapping clubs swaps the head, and the barrel's elevation is
  that club's own `loftDeg`, so the putter lies almost flat and the iron cocks up. One number
  drives both the silhouette and the ballistics, so they cannot disagree.
- **The ball rides on the turret and is fired out of the club head** (images 03, 04), not struck
  off the turf. `computeMuzzle` in `Cart.ts` is the single source for where that is; `world.ts`
  lifts the ball there before launching.
- **Strike range became pickup range.** Drive within `PICKUP_RANGE` of a settled ball and it is
  scooped onto the turret; fire with it loaded and you play a stroke; fire without it and you
  fire a blank that shoves the cart and costs nothing. Fire the ball down the fairway, then fire
  blanks to drive after it.
- **Turret aim is stored relative to the chassis**, so aiming is optional: a player who never
  touches the aim control always fires straight over the bonnet, and one who does aim keeps that
  angle through every turn. This replaced an absolute world yaw, and the test that asserted the
  old behaviour was rewritten rather than patched.
- **The chase camera tracks the chassis, not the turret.** Behind the turret the club-barrel is
  permanently foreshortened to a stub pointing away from the viewer — the one thing the shot has
  to show. Behind the chassis, swinging the turret sweeps the club across frame, which is image
  03's framing.

**Three things found by building it, all worth keeping:**

1. `CART_SPAWN_OFFSET` and `PICKUP_RANGE` are coupled. The cart first spawned 3.5 m behind the
   tee with a 3.0 m range, so every hole opened with the player unable to play their own tee
   shot. A human would have called that a bug in the strike rule rather than in the spawn point.
2. **Firing from a ~2.3 m muzzle adds substantial carry.** A full-charge *putt* from up there
   reaches the water at 41 m and takes a penalty — it plays nothing like the 13 m ground putt the
   probe measures. Cart-mode distances are their own tuning problem and `CLUB_STATS` was balanced
   for the ground game; this wants a play session before any numbers move.
3. **The tee ball spawns 0.3 m up and takes about half a second to settle** before it can be
   scooped. Firing in that window gets a blank. Harmless, but it is why the hole opens with a
   brief unloaded moment rather than a loaded turret.

## Phase 2.5 — The Course — ✅ DONE

Independent of Phase 1.75, so the two may land in either order.
Design: `docs/superpowers/specs/2026-09-01-procedural-course-design.md`.
Plan: `docs/superpowers/plans/2026-09-01-procedural-course-generation.md`.
Source research: `docs/RESEARCH-TERRAIN.md` — its architecture was adopted, its constants
rejected. `BACKLOG.md #2` (multi-hole course) is promoted into this phase.

**Built:** `src/sim/course.ts` (HoleSpec/Course, the seven playability checks, rejection
sampling), `src/sim/spline.ts` (centripetal Catmull-Rom corridor centreline), `src/sim/rng.ts`
(mulberry32 + channel hashing). `terrain.ts` and `surfaces.ts` became factories over one spec;
`world.ts` takes the hole it is playing.

**What deliberately did not change:** the Delaunay render mesh, hierarchical jitter, hexagonal
base grid and Voronoi biome colouring from the research's §1.2/§2/§3 are deferred. They produce
exactly the geometry `tools/sceneGate.mjs` exists to guard, and that gate is still unbuilt
(Phase 1) — so deferring buys time to build the gate before the geometry that needs it arrives.
The Blender primitive-graph prop exporter pairs with that deferred phase, not this one.

**The measured constant.** The per-octave max gradient `k` in `A = G / (f * k)` was measured
directly against the installed `simplex-noise` build: max ‖∇S‖ = **7.333** (rms 2.955, mean
2.672), over 1,002,001 samples (rms and mean as first measured in the original derivation
sweep; `npm run probe`'s own assertion re-derives and asserts only `max`, at a different PRNG
seed, and currently reports mean 2.712 for that run — the two means differ only because of the
seed, not a real discrepancy). Neither prior source was right — this module used 2π, and
the research's 2.5 is the *mean* gradient, not the max. The research's published amplitudes
(0.12 / 1.40 / 14.40 m) are 2.9× too large and would bust the green's budget on the micro octave
alone, so they were not used. `k` is asserted in `npm run probe` because a dependency bump can
silently invalidate all three amplitudes.

**Re-baselined figures.** Terrain changed (two octaves → three with budget masking and corridor
carving) and `crr` became continuous across surface boundaries, so these moved for stated
reasons. Phase 0 / Phase 1.5 → Phase 2.5:

| | Phase 0/1.5 | Phase 2.5 | cause |
|---|---|---|---|
| terrain mean slope | 4.3° | 4.9° | three-octave budget masking replaces the two-octave field |
| terrain max slope | 12.5° | 44.5° | the corridor-carving lerp in `terrain.ts`'s `heightAt` blends centreline height into free noise across the 10 m `BLEND_WIDTH` band, and that blend can approach a 45° gradient where macro relief is large (the rough itself stays inside its own `GRAD_ROUGH` budget everywhere measured) |
| driver total | 129 m | 106.4 m | terrain relief and continuous crr |
| driver carry / roll | 69.5 / 59.5 m | 65.3 / 41.0 m | as above |
| putter settle | 3.2 s | 2.85 s | crr no longer steps at the fairway edge |
| surface mix | 26 m hard corridor | green 1.5% / fairway 19.2% / rough 49.4% / sand 3.2% / water 26.7% | 15 m corridor + 10 m graded edge |
| candidate acceptance | — | 94.5% (189/200) | first measurement; research's 80–85% not applicable |

**Gate passed:**
- [x] All Vitest suites green (`npm test`).
- [x] `tsc --noEmit` clean.
- [ ] The four new probe assertions pass. Three do (noise gradient k, course playability, and
      the acceptance report, which only reports); the fourth, driver distance, fails on the
      pre-existing roll/carry gap named below — `npm run probe` exits 1 on that check alone.
- [x] A generated 9-hole course has every hole satisfy all seven checks.
- [x] The Phase 0 tunneling check still passes: full-power shot, ball Y stays bounded.
- [x] Re-baselined figures recorded above with their causes, not silently replaced.

**Still open:** the driver's roll/carry ratio is still the Phase 0 item — club balance wants a
play session, and changing `loftDeg` during this phase would have confounded the re-baseline.
Advancing through the nine holes needs Phase 1.75's screen transition: `Sim.loadHole` exists and
is tested, but the renderer's ground mesh is built once at construction.

## Phase 3 — Targets, ragdolls, pickups

- [x] `src/sim/entities/Target.ts`: primitive capsule ragdoll (no skinned meshes — matches the
      zero-external-asset constraint) — **done**, see `docs/superpowers/specs/2026-09-02-targets-health-combat-design.md` and
      `docs/superpowers/plans/2026-09-02-targets-health-combat-implementation.md`. Eleven capsules, Fixed at rest,
      whole rig flipped to Dynamic on impact; the pass conditions below are asserted in
      `Target.test.ts`. **Read `DECISIONS.md` "Ragdolls" before changing a line of it.** The plan that used to live here specified `JointData.stiffness`/`.damping`
      to hold a pose; those fields are inert in the JS bindings and tuning them does nothing.
      The corrected shape:
      - Parts are `Fixed`/`KinematicPositionBased` at rest and flip to `Dynamic` via
        `setBodyType` on the frame of impact. **Body type holds the pose, not joints.**
      - 7–11 capsules. Revolute joints at knees/elbows with limits set on the created joint
        object (not on `JointData` — silent no-op). Spherical at shoulders/hips/neck,
        accepting free twist (no angular limits exist) and suppressing it with high angular
        damping, higher on distal limbs than proximal.
      - Self-collision disabled between adjacent capsules via collision groups. Skipping this
        is the usual cause of a ragdoll that doesn't explode but permanently buzzes.
      - **No CCD on ragdoll parts** — it stays on the ball only.
      - Contact threshold for the rest→dynamic flip reads off
        `EventQueue.drainContactForceEvents` (verified present in Rapier 0.20).
- [x] Ball-to-heaviest-limb mass ratio ≤ 1:20, and post-impact linear/angular velocity clamped
      on ragdoll parts — **done, and it needed no density change.** The "46 g ball at ~1:100"
      figure is wrong for this project: `BALL_RADIUS` is 0.15 m (arcade scale, not a regulation
      0.021 m), so `BALL_DENSITY = 1130` already gives a **~16 kg** ball, and against a
      `TARGET_DENSITY = 400` torso (~21 kg) the ratio is ~1:1.3 — inside the bound with room to
      spare. Raising the density would only push the ball past the ragdoll. The ratio is asserted
      against the real bodies in `Target.test.ts`; the clamp is `MAX_PART_LINVEL`/
      `MAX_PART_ANGVEL`, applied on the impact frame and every tick while down. `npm run probe`
      output is byte-for-byte unchanged. See `DECISIONS.md` "Ball mass" (corrected).
- [x] Hit detection via Rapier collision events between ball and target — **done** as
      `src/sim/combat.ts`, the project's only `EventQueue` consumer. Dispatches ball↔target,
      ball↔cart and cart↔cart by collider handle; every other check in the codebase is still
      proximity polling, deliberately (a 40 m/s ball covers 0.67 m per tick).
- [x] **Health and damage** (`src/sim/health.ts`): HP per cart, damage from ball impact and
      from cart-vs-cart shunting, death and respawn — **done**, see `docs/superpowers/specs/2026-09-02-targets-health-combat-design.md`
      and `docs/superpowers/plans/2026-09-02-targets-health-combat-implementation.md`. Death costs a stroke and respawns at
      the tee-adjacent spawn point after `RESPAWN_DELAY_S`; shunting is a decaying velocity term,
      never an impulse. Round stats (`src/sim/stats.ts`) count shots, direct hits and targets
      down, and survive `Sim.reset()`. The HUD has shown a health bar in every
      cart-mode concept shot since the beginning (03, 07, 08, 09, 14) with nothing behind it;
      this is where it gets a model. The reference repo's `src/sim/damage.ts` is MIT but 83k —
      **take the shape, not the code**, and note it is not a `REUSE-MAP.md` entry precisely
      because it is too big to port cleanly (BACKLOG #16).
- [x] **Ammo** as a real resource — **done**, see
  `docs/superpowers/specs/2026-09-02-cart-ammo-design.md` and
  `docs/superpowers/plans/2026-09-02-cart-ammo-implementation.md`. Cart mode fires from a
  pooled-ball ammo counter; stationary/STROKE mode's ball model is untouched.
- [x] **Target rendering, pooled-ball rendering, and the H6/H7 HUD.** Targets and in-flight
      pooled balls now render (they existed in the sim since the entries above but had no
      presentation), and the health bar (H6) and ammo counter (H7) that every cart-mode concept
      shot has shown finally have a model behind them. See
      `docs/superpowers/specs/2026-09-02-combat-rendering-hud-design.md` and
      `docs/superpowers/plans/2026-09-02-combat-rendering-hud-implementation.md`.
- [ ] **Mode-scoping for both, and this is a rule rather than a preference.** Finite ammo in
      stroke play can strand a player mid-hole with no legal way to finish, which breaks golf
      outright. `STROKE` runs with damage and ammo **disabled**; `CTF` and `TARGETS` enforce
      both. The HUD hides those elements rather than showing them full — an inert full bar
      reads as a bug. See `UI-SPEC.md` §5.
- [ ] **Food & drink cart pickups** (image 06): sensor colliders scattered on the course,
      presented as an item floating and rotating inside a translucent glow cylinder, with a
      food-cart prop as the spawn anchor. Bucket of balls = ammo; drink = shield;
      hotdog = health. The glow cylinders are the one piece of UI that is legitimately scene
      geometry rather than DOM overlay. Port `consumables.ts` (42 lines, MIT, zero-dep — see
      `REUSE-MAP.md`) for the cooldown model rather than writing one.
- [ ] **Trees** (BACKLOG #25, promoted): procedural cone-stack over a cylinder trunk, per
      image 01's form-language sheet. Promoted out of the backlog because they are in every
      single environment shot and because they are **collision geometry** — a ball that passes
      through a tree is a bug a player will find in the first minute — so they belong with the
      entity work, not with decoration. Scatter from a seeded PRNG, never `Math.random()`, and
      keep them off the fairway corridor.
- [x] ~~Terrain material zones~~ — done early in Phase 1.5 as `src/sim/surfaces.ts`.

**Gate:** pass criteria are fixed in advance and asserted by `npm run probe`, not eyeballed —
a ragdoll dropped from 2 m settles with no joint separation inside 5 s, and a fixed-impulse
side shove produces no head interpenetration. Poses are recorded and diffed across runs so
this becomes a regression check instead of a re-inspection. Beyond that: a struck target flops
convincingly rather than exploding or buzzing; pickup triggers reliably and respects its
cooldown; no new tunneling at the higher entity count; a ball driven into a tree is stopped by
it; and — asserted, not assumed — a full round of `STROKE` completes with ammo and damage
inert, while the same course in `TARGETS` enforces both.

## Phase 3.5 — CTF and the clubhouse

Both are new systems with no analogue in the reference project's *content*, though the
clubhouse borrows its *phase pattern* from that project's garage (see `REUSE-MAP.md`).

- [ ] **CTF flag-ball**: a massive, distinctively coloured dynamic rigid body — a giant golf
      ball. It cannot be picked up by touch; players drive it toward their base by hitting it
      with clubs, which makes the objective a physics sandbox rather than a carry mechanic.
      Needs its own mass and rolling resistance, separate from the play ball.
- [ ] Base zones as sensor colliders, plus capture scoring.
- [ ] Cart-to-flag-ball shoving: the character controller needs
      `setApplyImpulsesToDynamicBodies(true)` and a real `setCharacterMass` or it will pass
      through the flag without moving it.
- [ ] **Clubhouse / HQ** (image 11): registers into the Phase 1.75 screen manager rather than
      inventing its own lifecycle — cart on a lit turntable, category list for turret skin /
      chassis paint / tire type, per-club `POWER` / `RANGE` / `RELOAD` stat cards read from
      `CLUB_STATS`, coin balance, `BACK` / `CONFIRM`. Its own scene residency so it does not
      fight the course for GPU. Build every piece of geometry fresh — the reference garage
      contributes its *phase pattern* only, and its geometry is Reserved Content.
- [ ] **Economy**: round earnings from the four Phase 1.75 stat tiles (direct hits, longest
      drive, targets down, accuracy), spent on the cosmetics above. Tire type is the one
      purchase that changes handling rather than looks, so price it as a stat and not a skin.
- [ ] Name the three modes in one place — `STROKE` / `CTF` / `TARGETS` (image 12,
      `UI-SPEC.md` §5). `TARGETS` is the Phase 3 ragdoll work promoted to a mode with its own
      scoring; `STROKE` already exists and is the safest thing to ship first.

**Gate:** the flag-ball can be driven the length of the hole by club hits alone and scores in
a base; it cannot be cheesed by simply driving into it faster than it can be struck;
entering and leaving the clubhouse does not leak GPU resources across the transition — the
same `renderer.info.memory` check Phase 1.75 established, now run against the heaviest screen;
a purchased tire type measurably changes cart handling in `npm run probe`, proving the
cosmetic/stat split is real and not decorative.

## Phase 4 — UI: hit markers, HUD

**Build to image 08.** It is the maximal case — stroke, par, surface, power meter, health,
reload, club selector, minimap *and* an event banner on screen at once. Lay it out so 08 fits
without overlap and every other shot becomes a subset that composes by hiding elements rather
than by relayout. Element-by-element inventory, with the sim field feeding each, is
`UI-SPEC.md` §2; the two-HUD split it depends on is §1.

- [x] H6 (health bar) and H7 (ammo counter) are done, landed ahead of the rest of this phase
      alongside target and pooled-ball rendering — see the Phase 3 note above and
      `src/ui/hud.ts`. H11 (hit markers), H12 (event banner), the minimap, and everything else
      in this phase's list remain.
- [ ] `src/ui/hitMarkers.ts`: world→screen projection (formula in `docs/ARCHITECTURE.md`
      §2c), one-shot DOM elements on ball-land/hit/hole events, CSS-driven drift+fade.
      Timing settled by research: **ease-out, 0.8–1.5 s** rise-and-fade.
- [ ] Marker cluster manager: when several hits land together, stack them vertically with a
      randomised X drift so they do not overlap and blind the player.
- [ ] HUD: club selector, reload gauge, power meter (extends the existing `#power-fill` bar),
      stroke count, par, health, ammo, and the surface the ball is lying on
      (`Sim.surfaceUnderBall` is already populated every tick).
- [ ] **Minimap** (BACKLOG #34, promoted): top-right hole overview with own heading arrow and,
      in multiplayer, a dot per cart. Promoted because it appears in *every single* in-game
      concept shot — 02, 03, 08, 09, 14 — while sitting unscheduled in the backlog as an idea.
      It renders from `surfaceAt` alone, so like `surfaces.ts` it needs no authored map data
      and there is nothing to keep in sync or replicate.
- [ ] **Trajectory preview arc** (image 02): solid arc through the air, dashed line on the
      ground. Needs a new **non-mutating** `Sim.previewTrajectory()` that integrates
      `computeLaunchVelocity` forward without touching the Rapier world or advancing the sim.
      Getting that boundary wrong is the one way this feature can corrupt play state, so it is
      the thing to test first.
- [ ] **Event banners** (image 08): full-width centred headline + consequence
      (`WATER HAZARD` / `PLUS ONE STROKE`) on water, out-of-bounds, and hole-out. A **separate
      component from hit markers** — screen-anchored not world-anchored, one at a time, longer
      dwell. Reusing the marker system for this is the obvious wrong turn.
- [ ] **Cart nameplates** (images 07, 09): team-coloured name pill with a health bar above
      each cart. Reuses the §2c projection but persists per-frame instead of being one-shot;
      budget for that difference rather than assuming marker code covers it.
- [ ] **Touch control layer** (image 14): left thumbstick, right cluster of brake, mode
      toggle, club swap, and fire. Implements Phase 2's `InputSource` interface — if it needs
      changes to that interface, Phase 2 got it wrong and the fix belongs there.
- [ ] Water splash and a visible water plane at `WATER_LEVEL`; sand tinting and fairway mow
      stripes driven by `surfaceAt` per mesh vertex, in one pass. The sim side of all of this
      already exists and is invisible. The splash is a ring of white angular shards (image 08),
      not a particle system — cheaper, and it matches the form language.

**Gate:** a hit marker appears at the correct screen position for a hit that happens off to
the side of the camera, not just dead-center; markers don't accumulate/leak DOM nodes over a
long play session (check with devtools node count before/after ~50 shots); the image-08
element set renders at 1280×720 and on a phone-sized viewport with no overlap and no
horizontal scroll; the preview arc's endpoint lands within a stated tolerance of where the
ball actually finishes for all three clubs — a preview that lies is worse than no preview; and
`Sim` state is byte-identical before and after a preview call.

## Phase 5 — Server-authoritative multiplayer (do not start early)

The research doc's strongest warning applies directly: deferring this to "later" on a
codebase not built for it is a rewrite, not an add. Phases 0–4 above were built sim-first
specifically so this phase is transport + reconciliation, not a redesign.

**Approach settled by research, and it is not what this phase originally assumed.** The
determinism spike is cancelled: rather than replicate-from-seed (every client re-simulating
the same shot), the server runs the one authoritative Rapier sim and broadcasts **snapshots**,
with clients interpolating between them. That sidesteps cross-platform float and
`Math.sin`/`Math.cos` divergence entirely instead of trying to defeat it.

- [x] ~~De-risking determinism spike~~ — **cancelled.** Snapshot interpolation does not
      require bit-identical simulation across clients, so there is nothing to de-risk.
- [ ] `server/`: Node process importing `src/sim/**` unmodified — the payoff of the DOM-free
      rule, already proven by `npm run probe` running the sim headlessly today.
- [ ] Colyseus room + `@colyseus/schema` state definitions, shared as TypeScript between the
      Vite client and the Node server.
- [ ] **Match lobby** (image 12): registers into the Phase 1.75 screen manager. Mode tabs
      `STROKE` / `CTF` / `TARGETS`, two team columns of slots with cart icon, name and ready
      tick, empty slots as dashes, `LEAVE` / `READY`, region and ping. Nothing about it is
      novel once the screen manager and the mode set already exist — which is the payoff for
      building both earlier.
- [ ] Snapshot interpolation for all remote entities; client-side prediction **for the local
      player's cart inputs only**. The ball is server-authoritative with no prediction — a
      shot resolves once, on the server.
- [x] ~~Split the licence before any server code lands~~ — **done ahead of this phase.**
      Apache-2.0 for `src/**` and `tools/**`, AGPL-3.0-or-later for `server/**`, DCO sign-off
      required. See `LICENSES.md`. Doing it here would have been too late: anything published
      permissively stays permissive forever, so the boundary had to exist before the code did.
      One rule to preserve when writing this phase — **AGPL code may import Apache-2.0 code,
      never the reverse.** Anything both halves need lives in `src/sim/**`.
- [ ] `Dockerfile` + `docker-compose.yml` at the repo root, with `docker compose up` as the
      path the README documents. Caddy in front for TLS and WebSocket proxying. `fly.toml` /
      `railway.json` may ship alongside as optional conveniences, never as the primary path —
      the self-host criterion is what ranks these, not DX. Reasoning in `DECISIONS.md`
      "Hosting"; note Railway is demoted there rather than recommended.
- [ ] Evaluate the `colyseus/vite` plugin (in `colyseus@0.17.9`) before hand-rolling the
      client/server integration: one port, one config, `/matchmake/*` as middleware, and a
      `vite build --app` producing `dist/client/` + `dist/server/server.mjs` for
      single-process deploy. Client SDK is `@colyseus/sdk` — the standalone `colyseus.js`
      repo was archived 15 Mar 2026.

**Gate:** two clients see the same shot land in the same place (guaranteed by construction —
there is one simulation — so what is actually tested is that interpolation hides the latency
without visible rubber-banding); a deliberately laggy client gains no authority-side
advantage; a contributor can `docker run` the server from a clean checkout with no account on
any platform.

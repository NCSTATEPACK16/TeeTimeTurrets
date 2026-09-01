# TeeTimeTurrets — Technical Architecture

Status: living document. Phase 0 (stationary swing on a Rapier heightfield) is built and
verified — see the root `README`-equivalent context in chat history / `docs/ROADMAP.md`.
Everything below the Phase 0 line in the file tree is scaffolding for Phases 1–5, not yet
wired into a running game.

## 1. Architectural breakdown & file tree

```
TeeTimeTurrets/
  index.html, package.json, tsconfig.json, vite.config.ts
  AGENTS.md                     project rulebook (this project's, not Claude-of-Tanks')
  docs/
    ARCHITECTURE.md             this file
    ROADMAP.md                  phased plan + pass/fail gates per phase
    UI-SPEC.md                  HUD + screen inventory derived from docs/concept/; element -> shot -> phase -> sim field
    RESEARCH-NEEDED.md          open questions that need investigation, not just decisions
    concept/                    concept art. Reference only -- never loaded by the game, never reaches dist/
  src/
    engine/
      GameLoop.ts                [BUILT] fixed-step accumulator + render interpolation, entity-agnostic
    app/
      ScreenManager.ts           [Phase 1.75] one active screen at a time; enter/exit own their own disposal
    input/
      InputSource.ts             [Phase 2] input intent interface (throttle/steer/brake/aim/fire/club/mode).
                                   KeyboardMouseSource now; TouchSource in Phase 4. Written against the
                                   control inventory in UI-SPEC.md §4, deliberately not against a keyboard.
    sim/                          DOM-free authoritative state. No THREE, no window, no DOM, no Math.random().
      world.ts                    [BUILT] Rapier world bootstrap, terrain collider, ball body, tick orchestration, golf rules (strokes, hole-out, water penalty)
      terrain.ts                  [BUILT] heightfield + shared noise function (physics and mesh read the same numbers), tee/green pads, cup, water level
      surfaces.ts                 [BUILT] green/fairway/rough/sand/water as a pure function of (x,z); per-surface rolling resistance, bounce, cart speed
      round.ts                    [Phase 1.75] par, per-hole card, running total, round stats. Sim owns one hole; round.ts owns the list of them.
      health.ts                   [Phase 3] HP, damage from ball impact and cart shunting, death/respawn. Mode-scoped: off in STROKE.
      entities/                   [Phase 2] Cart.ts (chassis position, turret yaw, equipped club, reload timer, ammo, tire-type grip),
                                   Ball.ts (extracted from world.ts once there can be >1 ball), Target.ts (Phase 3 ragdolls)
      snapshot.ts                 [Phase 5] serializable {tick, entities[]} struct for future net sync
    physics/
      Ballistics.ts               [BUILT] pure math: club stats, launch vector, aim spread, drag formulas. Zero engine deps -- unit-testable standalone, reusable verbatim on a future server.
    render/
      scene.ts                    [BUILT] Three.js scene/camera/lighting, ground mesh, ball mesh, aim indicator. Pure consumer of interpolated sim state.
    entities/
      GolfClub.ts                 [BUILT, not yet wired] render-facing cart+turret+club-head. Procedural primitives, no GLB/OBJ. See its file header for the sim/render boundary it's designed to respect once Cart.ts exists.
    ui/
      hitMarkers.ts                [Phase 4] DOM overlay: world->screen projection, floating "+100 FORE!" / "HOLE IN ONE!" text
      banners.ts                   [Phase 4] screen-anchored event cards ("WATER HAZARD / PLUS ONE STROKE"). Separate from hitMarkers:
                                     one at a time, longer dwell, not world-anchored. See UI-SPEC.md §2 H12.
      minimap.ts                   [Phase 4] top-right hole overview rendered from surfaceAt alone -- no authored map data
      screens/                     [Phase 1.75] TitleScreen.ts, ResultsScreen.ts, SettingsScreen.ts (stub);
                                     ClubhouseScreen.ts (Phase 3.5), LobbyScreen.ts (Phase 5)
    net/                           [Phase 5] protocol.ts, snapshot encode/decode, ws client adapter
    main.ts                       [BUILT] boot: creates Sim, RenderScene, GameLoop; wires keyboard input
  server/                          [Phase 5] authoritative Node process that imports src/sim/* unmodified
```

### Keeping sim state decoupled from Three.js objects

This is the single highest-leverage rule in the project, confirmed as real, load-bearing
practice in the reference repo's own `AGENTS.md` (not just its README): *"Keep simulation
and network modules Node-runnable and free of DOM/WebGL."* Concretely, enforced here as:

- **`src/sim/**` and `src/physics/**` never import `three` or reference `window`/`document`.**
  They take numbers in, return numbers out. `Sim.step()` in `world.ts` and every function in
  `Ballistics.ts` already satisfy this — verify with `grep -L three src/sim/*.ts` staying
  empty as the codebase grows.
- **`src/render/**` and `src/entities/**` (the visual layer) never mutate sim state directly.**
  They read a `previous`/`current` pair of plain-data transforms each tick and interpolate
  between them (`main.ts`'s `interpolate()` function is the only place this happens today).
  Input is the one exception: user input becomes an explicit *intent* call into sim
  (`sim.launch(yaw, power)`, `sim.reset()`) — never a direct mutation of a THREE object that
  the sim then has to read back.
- **Why this matters now, not just at Phase 5:** a server-authoritative multiplayer model
  (the research doc's recommendation, and the reference repo's actual `src/net/` shape) only
  works cheaply if the exact same sim code can run headless in Node. If rendering concerns
  leak into `sim/`, "adding multiplayer later" becomes a rewrite instead of running the
  existing module on a server and adding transport — this is the reference repo's own
  documented #1 risk, and the reason Phase 0 was built this way from the first commit rather
  than deferred.

## 2. Math & physics specifications

### 2a. Fixed 60Hz tick with accumulation and interpolation

Implemented in `src/engine/GameLoop.ts`, driven by `main.ts`. Given fixed tick duration
`Δt_fixed = 1/60`:

```
accumulator += clamp(frameDeltaSeconds, 0, maxFrameDt)   // maxFrameDt guards a stall/tab-switch spiral of death

while accumulator >= Δt_fixed:
    step()                    // advance sim exactly one tick (Rapier world.step() at Δt_fixed)
    accumulator -= Δt_fixed

alpha = accumulator / Δt_fixed                            // in [0, 1)
renderState.position = lerp(sim.previous.position, sim.current.position, alpha)
renderState.rotation = slerp(sim.previous.rotation, sim.current.rotation, alpha)   // quaternion, not linear
```

This lets the render loop run at the display's native rate (60/120/144Hz) while the
simulation stays at a fixed, deterministic 60Hz regardless of frame rate — matching the
reference repo's own confirmed invariant (`SIM_DT = 1/60`, stated directly in its
`AGENTS.md`, not just inferred from its README).

### 2b. Golf ball launch vectors

Implemented in `src/physics/Ballistics.ts::computeLaunchVelocity`. Given a club's stats
(`loftDeg`, `minSpeed`, `maxSpeed`), a charge fraction `c ∈ [0,1]` from hold duration, and
aim yaw `θ`:

```
speed = lerp(minSpeed, maxSpeed, c)
loft  = loftDeg * π / 180
vHorizontal = cos(loft) * speed
vVertical   = sin(loft) * speed
vx = cos(θ) * vHorizontal
vy = vVertical
vz = sin(θ) * vHorizontal
```

This velocity is applied as an instantaneous impulse (`RigidBody.setLinvel`) rather than
computed as a continuous swept-collider strike — the research doc's "hybrid swing" §3(a)
recommendation: guarantees feel and trivial net-replication (only `{club, charge, yaw,
serverTick}` needs to cross the wire, not per-frame ball state) at the cost of the club not
*physically* pushing the ball. A swept kinematic club-head collider for trick-shot knockback
is optional future work (§3(c) in the research doc), not required for core play.

**Gravity and bounce** are Rapier's, not hand-rolled: world gravity `(0, -9.81, 0)`, and
each collider's `restitution`/`friction` (currently: ground 0.15/0.8, ball 0.35/0.55) govern
bounce and roll. Both coefficients combine by averaging, so effective restitution is 0.25.
Per-*surface* material comes from `src/sim/surfaces.ts` instead, applied per tick — see below.

**Deceleration is three separate mechanisms, deliberately.** One coefficient was previously
doing all three jobs and doing none of them well:

| mechanism | knob | shape | job |
|---|---|---|---|
| air drag | `LINEAR_DAMPING` = 0.05 | `-k·v` | bleed speed in flight |
| turf drag | `ANGULAR_DAMPING` = 0.6 | `-k·v` (via spin) | shorten the tail of a roll |
| rolling resistance | `SURFACES[s].rolling` | `-crr·g` (constant) | actually *stop* the ball |

The third one is the important one, and it is why `Sim.step()` touches velocity directly
rather than leaving everything to Rapier. **Rapier has no rolling friction:** once a sphere
rolls without slipping, contact friction does no further work on it. Damping alone can't
substitute, because velocity-proportional decay has no static threshold — on a slope the ball
settles at a terminal creep speed where damping balances gravity instead of stopping. At this
terrain's 4.3° mean grade that creep is ~0.48 m/s, above any usable rest threshold, so the
ball rolls downhill forever (measured: a 7 m putt took 17 s to register at rest). A constant
deceleration `crr·g` *does* have a static threshold: it holds the ball on any grade shallower
than `atan(crr)` ≈ 6.3° and stops it in finite time. It's applied as a direct velocity change
rather than an impulse so the per-tick result is mass-independent and exactly reproducible —
which matters for Phase 5.

Angular damping is doing rolling-resistance-shaped work too: for a rolling sphere
(`I = 2/5·m·r²`, `v = ω·r`) a spin torque decelerates translation at `(2/7)·k_angular`. Launch
zeroes angular velocity, so it costs nothing in flight. **It must stay small.** It was 3.8
while it was the only thing ending a roll; once rolling resistance took that job over, the
leftover 3.8 stopped a 2 m putt 0.70 m short of the cup. Velocity-proportional damping bites
hardest at exactly the speeds putting happens at.

### 2b-ii. Per-surface material

`src/sim/surfaces.ts` classifies any (x, z) as green / fairway / rough / sand / water as a
pure function of the shared height field — no authored zone data, so nothing to keep in sync
and nothing to replicate in Phase 5. Water is simply terrain below `WATER_LEVEL`, which means
ponds form in the course's low ground on their own.

Each surface carries `rolling` (the crr above), `bounceScale`, `cartSpeedScale`, and
`isHazard`. **Per-surface restitution and friction cannot live on the collider:** one
heightfield collider covers the whole course, so a material that varies by position has to be
applied per tick in `Sim.step()`. `bounceScale` is what makes a bunker read as sand rather
than as slow fairway.

Water is a stroke-and-distance hazard rather than a material: on settling in water the sim
adds a penalty stroke and drops the ball at `lastSafePosition`. Combined with the cup and
`Sim.strokes`/`holedOut`, that is the whole golf loop.

`Ballistics.ts::computeDragForce` still provides the physically-correct quadratic model
(`F = -½ρC_dA|v|v`) if a later feel pass wants it in place of linear damping for the air
component — not wired in, since swapping it changes validated behavior and should be a
deliberate choice.

**Verification.** `npm run probe` builds `tools/feelProbe.ts` against the real `src/sim/**`
and reports terrain slope statistics, the tee-pad profile, and per-club carry / roll / apex /
settle time / out-of-bounds. Re-run it after touching any constant in `terrain.ts` or
`world.ts`; it is the cheapest regression check in the project and it only works because
`src/sim/**` is DOM-free.

**Aim spread** (`Ballistics.ts::applyAimSpread`) takes an injected `random: () => number`
rather than calling `Math.random()` itself — any code path that can run on an authoritative
server must use a seeded PRNG, per the same invariant the reference repo states explicitly:
*"Simulation randomness is seeded/injected. Do not use wall-clock time or `Math.random()` in
authoritative logic."*

### 2c. 3D world → 2D screen projection for DOM hit markers

For a world-space point `P` (e.g. ball impact position) and the active `THREE.Camera`:

```
clip = P.clone().project(camera)          // NDC, each axis in [-1, 1]; clip.z > 1 means behind camera -> hide marker
screenX = (clip.x * 0.5 + 0.5) * canvasWidth
screenY = (1 - (clip.y * 0.5 + 0.5)) * canvasHeight     // NDC is Y-up, DOM is Y-down: flip
```

Position the marker element with `transform: translate3d(screenX, screenY, 0)` (GPU-composited,
avoids layout thrash) rather than `left`/`top`. Hit markers are one-shot DOM elements created
on an event (ball-lands / bucket-pickup / hole-in-one), not tracked every frame after their
initial placement — they animate (drift up, fade) via a CSS transition, decoupled from the
render loop entirely once spawned. This mirrors the reference repo's own `src/ui/` role
(DOM-overlay presentation layer, separate from the WebGL canvas) and keeps the render loop
from doing per-frame DOM writes for anything except the markers actively being placed.

# Backlog

Running list of features and improvements, kept deliberately separate from `ROADMAP.md`.
The roadmap is the committed critical path with pass/fail gates; this is everything else.
Nothing here is scheduled. Add freely; promote to the roadmap only when it is next.

Status key: `IDEA` not designed · `READY` designed, unblocked · `BLOCKED` waiting on
something named · `PARKED` deliberately deferred · **`→ Phase N`** promoted, now owned by that
phase in `ROADMAP.md` — the row stays for its notes, but the roadmap is authoritative.

Revised 31 Aug 2026 against `docs/concept/`. Reading the concept art promoted eight rows and
added twelve, most of them UI the art had always shown and no document had ever claimed. The
element-level detail lives in `docs/UI-SPEC.md`; this file keeps the one-line notes.

---

## Core loop and rules

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Par per hole + scorecard | **→ Phase 1.75** | `Sim.strokes` and `holedOut` exist. Needs `par` on the hole and a per-round tally. Pulled forward: image 13's results screen has nothing to display without it. |
| 2 | Multi-hole course (front 9) | DONE | Delivered by Phase 2.5. `generateCourse(seed, 9)` returns nine independently-specified holes; `main.ts` plays hole 0. Advancing between them needs Phase 1.75's screen transition, because the renderer's ground mesh is built once at construction — `Sim.loadHole` is the sim-side half and already exists. See `docs/superpowers/specs/2026-09-01-procedural-course-design.md`. |
| 3 | Club selection wired to the swing | **DONE** | Phase 2. `Sim.launch` takes a `club` param; the cart owns the equipped club and 1/2/3 select it. |
| 4 | Reload timers gating re-fire | **DONE** | Phase 2. Owned by `Cart`. Club-swap deliberately does *not* cancel a reload, or swapping away and back would be the game's fastest fire rate. |
| 5 | Aim spread wired with a seeded RNG | READY | `applyAimSpread` takes an injected `random` and nothing injects one. The port is done — `mulberry32` and `hashChannel` are in `src/sim/rng.ts` as of Phase 2.5 — so this is now just wiring a per-shot channel into the call. Still true after Phase 2: the cart fires with no spread at all. |
| 6 | Lie affects the shot, not just the roll | IDEA | Ball in rough/sand should lose launch power. Natural extension of `surfaces.ts`. |
| 7 | Backspin / descent-angle model | IDEA | Would fix the driver's 0.86 roll/carry ratio at the source rather than via loft. |
| 8 | Mulligan / undo last stroke | IDEA | Cheap with `lastSafePosition` already tracked. |

## Cart and combat

| # | Item | Status | Notes |
|---|---|---|---|
| 9 | Kinematic cart controller | **DONE** | Phase 2. KCC in `world.ts`; `Cart.ts` stays Rapier-free and emits a desired translation. Gravity and ground-follow are the controller's, not the cart's. |
| 10 | **Recoil as self-propulsion** | **DONE** | Phase 2, and it grew a rule: a shot only counts as a stroke inside `STRIKE_RANGE` of the ball, so firing away from it is free propulsion. Same button, two uses. |
| 11 | `cartSpeedScale` per surface | **DONE** | Phase 2. Tire type scales how much of the penalty reaches the cart, which is what makes tire choice a trade. |
| 12 | Turret yaw independent of chassis heading | **DONE** | Phase 2. Chase camera tracks the turret, not the chassis. |
| 13 | Ragdoll targets | READY | Unblocked, and the previous shape was **wrong** — joint stiffness/damping are inert in this binding. Pose is held by body type (`Fixed`→`Dynamic` via `setBodyType`), joints only shape the collapse. Read `DECISIONS.md` "Ragdolls" first. |
| 13a | Raise `BALL_DENSITY` for the ragdoll mass ratio | READY | Blocks #13 landing well. 46 g vs a multi-kg limb is ~1:100 and unfixable by joint tuning; target ≤ 1:20. Free in ball flight (mass-independent) — confirm with `npm run probe`. See `DECISIONS.md` "Ball mass". |
| 14 | Cart rollover + auto-right | READY | Port `src/sim/rollover.ts` (65 lines, MIT). |
| 15 | Cart-vs-cart collision and shunting | IDEA | `setApplyImpulsesToDynamicBodies` makes the KCC push dynamic bodies. |
| 16 | Damage / health model | **DONE (sim)** | Phase 3. `src/sim/health.ts` (pure HP), `src/sim/combat.ts` (contact dispatch, damage tuning), cart death → stroke penalty → respawn. Shape only was taken from the reference `damage.ts`; no code. See `docs/superpowers/specs/2026-09-02-targets-health-combat-design.md` and `docs/superpowers/plans/2026-09-02-targets-health-combat-implementation.md`. The HUD health bar those concept shots show is still unbuilt — sim only, matching every prior phase's ordering. |
| 16a | Ammo per club | **→ Phase 3** | **Superseded in scope**: implemented as one shared pool per cart, not per-club, per explicit user simplification. See `docs/superpowers/specs/2026-09-02-cart-ammo-design.md` §1. |
| 16b | Input abstraction (`InputSource`) | **DONE** | Phase 2. Binding table is a pure function (`input/mapping.ts`); `ScriptedInputSource` is the second implementation and drives the whole Phase 2 gate headlessly, which is what proves the interface is not keyboard-shaped. |
| 16c | Cart cosmetics: turret skin, chassis paint, tire type | **PART DONE** / **3.5** (UI) | Phase 2 landed `TIRE_TUNING` as a real trade (turf fastest on fairway, worst in sand; knobby the reverse). Turret skin and chassis paint are still unbuilt — no reader and no UI until 3.5. |
| 16d | Cart-mode `sim.ballLoaded`/`view.ballLoaded` reads are stale | READY | The ammo/pool fork (`docs/superpowers/specs/2026-09-02-cart-ammo-design.md`) replaced cart mode's "drive over the ball to load it" mechanic that `ballLoaded` used to describe, but `src/render/scene.ts` and `src/main.ts` still read it in cart mode for ball visibility, the turret-riding render, and HUD strings like "fire to play it". `docs/superpowers/plans/2026-09-02-cart-ammo-implementation.md`'s Task 4 notes flagged this as a known gap, out of scope for that plan; needs fixing whenever ammo-aware rendering/HUD work is scoped. |

## CTF and modes

| # | Item | Status | Notes |
|---|---|---|---|
| 17 | Heavy flag-ball as a dynamic body | READY | Giant golf ball, high mass, own rolling resistance. Cannot be picked up — must be struck. |
| 18 | Base zones + capture scoring | READY | Sensor colliders. |
| 19 | Flag-ball reset on stalemate | IDEA | If it ends up somewhere unreachable. |
| 20 | Stroke-play race mode | READY | Non-combat: first to hole out wins. Good low-risk mode to ship first, and the one already playable. Named `STROKE` in image 12. |
| 20a | `TARGETS` mode | IDEA | The third tab in image 12's lobby — Phase 3's ragdoll work promoted to a mode with its own scoring. Image 13's `TARGETS DOWN` tile is its round stat. Named for the first time in `UI-SPEC.md` §5. |
| 20b | Mode-scoped rulesets | **→ Phase 3** | One switch deciding whether damage and ammo are live. `STROKE` off, `CTF`/`TARGETS` on. Cheap now; retrofitting a mode concept after three modes exist is not. |

## Course features

| # | Item | Status | Notes |
|---|---|---|---|
| 21 | Water surface rendering | READY | Sim side done (`WATER_LEVEL`, hazard rule). Needs one translucent plane + a splash effect. |
| 22 | Sand visual distinction | READY | Sim side done. `surfaceAt` can drive per-vertex mesh colour. |
| 23 | **Clubhouse / HQ hub** | IDEA | Main screen, upgrades, loadout (image 11). Registers into the Phase 1.75 screen manager rather than inventing a lifecycle; build all geometry fresh — the reference garage contributes its *phase pattern* only (see REUSE-MAP). |
| 24 | **Food & drink carts (pickups)** | **→ Phase 3** | The ammo bucket half is **in progress**, see `docs/superpowers/specs/2026-09-02-cart-ammo-design.md`. Drink/hotdog pickups remain unbuilt and out of this spec's scope. |
| 24a | **Knockable targets / ragdolls** | **DONE (sim)** | Phase 3. `src/sim/entities/Target.ts`: eleven capsules held rigid by body type, whole rig flipped to Dynamic on a ball contact, revolute limits on the created joint, self-collision off via groups, post-impact velocity clamped. Three are hardcoded along the tee→cup corridor, the same interim placement the ammo bucket uses. No auto-recovery: a target stays down until the next hole. |
| 25 | Trees / obstacles | **→ Phase 3** | Procedural cone-stack + cylinder trunk per image 01. Promoted because they are **collision geometry** in every environment shot, not decoration — a ball passing through a tree is a first-minute bug. Seeded scatter, off the fairway corridor. Reference `src/world/**` is Reserved — do not look at it. |
| 26 | Dog-leg holes | IDEA | `surfaces.ts` fairway corridor is currently a straight tee→cup segment; make it a polyline. |
| 27 | Wind | IDEA | Cheap and very golf. A constant force in the ball integrator. |
| 28 | Elevated tees / greens | IDEA | Pads already support arbitrary height; currently they inherit local terrain. |
| 28a | Blend-band gradient cap | IDEA | The corridor's 10 m blend band (between `HALF_WIDTH` and `HALF_WIDTH + BLEND_WIDTH`) — the carving lerp in `terrain.ts`'s `heightAt`, between centreline height and free noise — can locally exceed 40° of gradient where macro-noise relief is large. Measured on a shipped nine-hole course, roughly 6–7% of fairway-classified ground in that band is steeper than its own blended `crr` (surfaces.ts) can arrest, so a ball landing there never settles there. Found in the final whole-branch review of Phase 2.5; not an explicit design target of the Task 9 slope-budget system, which only bounds the green and corridor interior — the blend band was never budgeted or tested. Accepted as-is for now (arguably desirable "fairway edges roll you toward the rough" flavor), not a bug to fix. Needs its own design decision later: either a dedicated blend-band gradient cap, or formally accepting the current behaviour. |
| 28b | Bucket placement validity checks for the full course map | BLOCKED | Analogous to `course.ts`'s `validateHole` playability checks. Blocked on the multi-hole map (`docs/RESEARCH-TERRAIN.md` / the procedural course generator). See `docs/superpowers/specs/2026-09-02-cart-ammo-design.md` §7. |

## Presentation

| # | Item | Status | Notes |
|---|---|---|---|
| 29 | Hit markers / floating text | **→ Phase 4** | Ease-out, 0.8–1.5 s, rise-and-fade. Projection formula in `ARCHITECTURE.md` §2c. Copy from image 00: `+100`, `DIRECT HIT!`, `HOLE IN ONE!`, `CRITICAL HIT!`, `SAND TRAP!`. |
| 30 | Marker cluster manager | **→ Phase 4** | Vertical stacking + randomised X drift when several land together. |
| 31 | Chase camera behind the cart | **DONE** | Phase 2. Tracks the **chassis**, not the turret: behind the turret the club-barrel is permanently foreshortened to a stub, and the club is the read. Clamps the eye above terrain so reversing into a slope does not put the camera inside the heightfield. Stationary mode keeps Phase 0's ball-follow framing. |
| 32 | Ball-flight tracer | IDEA | A fading line behind the ball reads well on a long drive (images 00, 04, 15). Optional inside Phase 4; first thing to cut if it runs long. |
| 33 | Shot-power HUD showing the club | **→ Phase 4** | `#power-fill` exists; needs club identity and reload state. Vertical orientation per images 02/08, not 00's horizontal. |
| 34 | Minimap / hole overview | **→ Phase 4** | `surfaceAt` renders a top-down course map for free — no authored data, nothing to sync or replicate. Promoted from `IDEA` because it is in **every** in-game concept shot (02, 03, 08, 09, 14) while sitting unscheduled here. |
| 34a | Event banners | **→ Phase 4** | Image 08's `WATER HAZARD` / `PLUS ONE STROKE`. A separate component from #29 — screen-anchored, one at a time, longer dwell. Fires on water, out-of-bounds, hole-out. |
| 34b | Cart nameplates | **→ Phase 4** | Images 07, 09. Team-coloured name pill + health bar over each cart. Same projection as #29 but persistent per-frame, not one-shot. |
| 34c | Trajectory preview arc | **→ Phase 4** | Image 02. Needs a non-mutating `Sim.previewTrajectory()` that never touches the Rapier world. A preview that lies is worse than no preview. |
| 34d | Touch control layer | **→ Phase 4** | Image 14. Implements #16b's interface. If it needs interface changes, Phase 2 got the interface wrong. |
| 34e | Fairway mow stripes | **→ Phase 4** | In every course shot. Alternating bands along the fairway axis, per-vertex from `surfaceAt` in the same pass as sand tinting. Cheap, and it is most of what makes the art read as golf. |

## Screens and shell

New section. The concept art has always shown a title screen, a lobby, a results screen and a
clubhouse; until now no document contained the idea that the game has screens at all.

| # | Item | Status | Notes |
|---|---|---|---|
| 42 | `ScreenManager` | **→ Phase 1.75** | One active screen, explicit enter/exit, each disposing its own geometry and materials. The reason the phase exists — a screen manager retrofitted onto a single always-live scene is a rewrite. |
| 43 | Title screen | **→ Phase 1.75** | Image 10. Logo, `PLAY`/`CLUBHOUSE`/`MULTIPLAYER`/`SETTINGS`, version string, **live course backdrop**. The live backdrop is deliberate: it forces the renderer-sharing requirement out into the open in the cheapest phase. |
| 44 | Results screen | **→ Phase 1.75** | Image 13. Nine columns + `TOTAL`, par/strokes rows, under-par ringed green and over-par boxed red, four stat tiles, `MAIN MENU`/`NEXT HOLE`. |
| 45 | Round stats | **→ Phase 1.75** | Direct hits, longest drive, targets down, accuracy. Recorded from the start even while three read zero — Phase 3 fills them, Phase 3.5 spends them. |
| 46 | Settings screen | IDEA | Not drawn anywhere. Ships as a stub in 1.75 so the title screen has no dead button. |
| 47 | Match lobby | **→ Phase 5** | Image 12. Mode tabs, two team columns of ready-slots, region/ping. Novel only if the screen manager and mode set don't already exist — which is the point of building both earlier. |
| 48 | Coin economy | **→ Phase 3.5** | Earnings from #45's four tiles, spent on #16c. Price tire type as a stat, not a skin. |

## Platform

| # | Item | Status | Notes |
|---|---|---|---|
| 35 | Colyseus room + schema | PARKED | Phase 5. Do not start early. |
| 36 | ~~Dual licence~~ | **DONE** | Enacted 31 Aug 2026: Apache-2.0 `src/**`+`tools/**`, AGPL-3.0-or-later `server/**`, DCO in `CONTRIBUTING.md`. See `LICENSES.md`. Apache over MIT for the patent grant. |
| 37 | Self-test runner | **PART DONE** | Vitest landed in Phase 2 (`npm test`, node environment, colocated `*.test.ts`) and Rapier runs inside it, so `Sim`-level integration tests are cheap. Still open: recorded, diffable **pose baselines** for Phase 3's ragdoll gate — a runner exists now, the baseline format does not. |
| 38 | ~~`docs/ATTRIBUTION.md`~~ | **DONE** | Superseded by root `NOTICE`, which is the Apache-2.0 convention and already has the entry template. Fill it in on the first port; do not create a second attribution file. |
| 41 | `Dockerfile` + `docker-compose.yml` | READY | The documented self-host path, per `DECISIONS.md` "Hosting". Caddy for TLS/WS proxy. `fly.toml`/`railway.json` optional alongside, never primary. |
| 39 | Trademark search for "TeeTimeTurrets" | IDEA | Flagged in `RESEARCH-NEEDED.md`; needs a real search, not a guess. **Downgraded** by the 31 Aug 2026 rename from "CallofGolf" — the ordinary pre-users check now, not an urgent one. |
| 40 | Bundle size | IDEA | Currently 3.4 MB (1.2 MB gzip), dominated by the Rapier WASM. Code-split the clubhouse from the course. |

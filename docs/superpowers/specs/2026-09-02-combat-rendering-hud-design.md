# Combat Rendering, the Scene Gate, and the Cart HUD — Design

**Date:** 2 Sep 2026 · **Status:** approved, not yet implemented · **Roadmap slot:** Phase 1 (the
gate), Phase 3 (targets on screen), Phase 4 (H6/H7 only)

Makes Phase 3's combat visible. The sim side is done and tested — `src/sim/entities/Target.ts`,
`src/sim/combat.ts`, `src/sim/health.ts`, `src/sim/stats.ts`, ammo and `BallPool` — and none of it
is on screen. See `docs/superpowers/specs/2026-09-02-targets-health-combat-design.md` and
`docs/superpowers/specs/2026-09-02-cart-ammo-design.md` for what already exists; this document
does not re-litigate any of it.

Also builds `tools/sceneGate.mjs`, which `AGENTS.md` has specified since Phase 1 and which has
never existed. Targets are the first new procedural geometry since it was written; the cart and
the three club heads have been unguarded since Phase 2 and `ROADMAP.md` already calls that
overdue.

Closes `BACKLOG.md` #16d.

## 1. Decision

Four pieces, one slice, in this order:

1. **`tools/sceneGate.mjs`** — the full gate `AGENTS.md` specifies: structural geometry metrics
   *and* a perceptual screenshot diff, both baselined and both failing non-zero on drift. Built
   first so the geometry that follows is guarded from birth rather than baselined after the fact.
2. **Target rendering** — eleven instanced capsules per ragdoll, posed from a sim snapshot,
   interpolated so the collapse reads.
3. **Pooled ball rendering** — cart-mode shots are currently invisible. Without them the
   projectile never connects the turret to the ragdoll and "combat is visible" is not true.
4. **The Cart HUD's health bar and ammo counter** (`UI-SPEC.md` H6, H7), plus honest
   `ballLoaded` reads (#16d) and a smoke script rewritten to the mechanic that exists.

**Explicitly out of scope**, each with the reason it is out rather than forgotten:

- **Hit markers (H11).** `UI-SPEC.md` §2 gives H11 phase `4` flat, with no `3 /` state-ownership
  half — unlike H6 and H7, which are both `3 / 4`. It also needs the §2c projection, the cluster
  manager, and Phase 4's own gate (correct screen position for a hit off the camera axis; no DOM
  node growth over ~50 shots). The sim-side event surface it will consume already exists in
  `combat.ts` and `stats.ts`, so nothing here blocks it.
- **The event banner (H12), and therefore a death banner.** H12 is Phase 4, screen-anchored, one
  at a time, longer dwell, and §2 warns in as many words that it is a distinct component from
  H11. A cart death is exactly H12's shape — `WATER HAZARD` / `PLUS ONE STROKE` and a cart death
  cost the same penalty by the same rule — so building a bespoke death banner now would either be
  thrown away when H12 lands or pre-empt Phase 4's layout. §6 covers what ships instead.
- **A targets-down HUD readout.** `TARGETS DOWN` appears nowhere in §2's HUD inventory. It is an
  S2 Results-screen stat tile (§3), owned by Phase 1.75, which §3 says to record "from Phase 1.75
  even while three of the four read zero." `Sim.stats.targetsDown` already records it. Adding it
  to the HUD would invent an element the spec does not have, in the same change where §5 is
  arguing for discipline about what the HUD shows.
- **Mode-scoping (`STROKE` / `CTF` / `TARGETS`).** Still does not exist; still out of scope for
  the same reason the targets/health spec gave. §6 explains why H6/H7 can nonetheless be hidden
  correctly today without it.
- **The rest of Phase 4's HUD** — power meter, club selector, reload gauge, minimap, surface
  chip, stroke/par chip, trajectory preview, nameplates, touch layer, water plane, mow stripes.
  Phase 4 builds those to image 08 as one layout. Growing them one span at a time is the mistake
  Phase 2's gate notes already recorded.
- **Target auto-recovery, food/drink pickups, trees.** Untouched Phase 3 items.
- **Any change to sim physics.** This slice adds read-only snapshot buffers and nothing else on
  the sim side. `npm run probe` must be byte-for-byte unchanged, and that is asserted rather than
  assumed (§10).

## 2. Current state (grounding facts)

Established by reading the code, not from the prior specs' summaries.

- **`RenderScene` draws exactly one ball**: `this.ball`, fed from `sim.current`, which is
  `Sim.ball` — the stationary-mode ball. Cart-mode shots spawn from `BallPool`, and
  `Sim.ballPool` is `private`. **Nothing visibly leaves the muzzle in cart mode today.**
- **Cart-mode shots are not strokes.** `Sim.strokes` increments in exactly three places:
  `killCart` (the death penalty), the water hazard in `step()`, and `launch()` — which only the
  stationary branch of `resolveShot()` calls. The cart branch sets `lastShotWasStrike = true` and
  nothing consumes it for stroke accounting.
- **`ballLoaded` in cart mode is actively harmful, not merely stale.** `world.ts:522` still runs
  the pre-ammo pickup mechanic (`driving && ballInReach && isResting() && !holedOut`). The
  renderer honours it by hiding the course ball and drawing it on the club head — but
  `resolveShot()`'s cart branch never touches `Sim.ball`, so a ball scooped that way can never be
  played. Driving near the tee ball makes it disappear.
- **`ballLoaded` and `ballInReach` are read only by `main.ts`, `render/scene.ts` and
  `tools/smoke.mjs`.** No Vitest suite references either, so removing them costs no test rewrite.
- **`npm run smoke` fails three assertions today**, all in its `FIRE FROM THE MUZZLE` block, and
  all three read fields the ammo fork retired: `sim.strokes` (cart shots are not strokes),
  `sim.current` (the fired ball is a pooled body, not `Sim.ball`), and `sim.ballLoaded`. Verified
  by running it: `loaded shot counts a stroke (strokes 0)`, `ball leaves from above the cart
  (ball y=0.23 vs cart y=1.03)`, `ball unloads after being fired`.
- **`npm run probe` fails its `driver distance` check**, pre-existing and unrelated — the
  roll/carry ratio `ROADMAP.md` Phase 0 and Phase 2.5 both leave open pending a play session.
- **Baseline at the start of this work:** 232 Vitest tests pass across 16 files;
  `tsc --noEmit` is clean.
- **`GolfClub.ts` is the established render-entity pattern**: a `THREE.Group` subclass, owning no
  Rapier body and no authoritative state, posed each frame from a sim snapshot, with a
  `dispose()` that traverses and frees every geometry and material. It already imports
  `TURRET_GEOMETRY` from `sim/entities/Cart` so the club head the player sees is where
  `computeMuzzle` says the ball leaves from — one set of numbers, not a visual copy.
- **`Target.ts` holds its capsule dimensions in a private `RIG` table** of eleven `PartSpec`s
  (name, radius, halfHeight, pose offset, damping, joint). `TargetPart` exposes `body`,
  `collider` and `restOffset`; `Target` exposes `parts`, `isDown`, `knockDown`, `step`, `reset`,
  `dispose`.
- **`Sim.targets` is a public readonly array**, rebuilt by `loadHole` and stood back up by
  `reset`. Three targets are placed along the tee→cup corridor.
- **`tools/probe.vite.config.ts` already establishes the pattern** for a tool getting its own
  Vite entry point separate from the game.
- **Puppeteer is already a devDependency** and `tools/smoke.mjs` already drives headless Chrome
  with `--enable-unsafe-swiftshader`, so software rasterisation is the proven path in this
  environment.
- **Render interpolation already exists** for the ball and the cart: `Sim` keeps `previous`/
  `current` transforms, `main.ts` lerps position and slerps rotation into a reused `FrameView`.

## 3. Scene Gate — `tools/sceneGate.mjs`

`AGENTS.md`'s five steps, built as an independent design. Its "Visual Critic / Scene Gate
protocol" section is explicit that the reference repo's comparator internals are Reserved Content
and must not be reverse-engineered; nothing below is derived from them.

### 3a. A harness page, not the game

The game is the wrong subject: its camera chases the cart, its course is generated per seed, and
its lighting is fixed but its framing is not. `AGENTS.md` step 1 asks for a fixed camera, fixed
lighting and a seeded RNG for the entity under test, which is a rig, not a level.

- `tools/gate/index.html` and `tools/gate/gateScene.ts` — a page that builds exactly one subject
  against a fixed `PerspectiveCamera` and a fixed light pair, with no `Sim`, no terrain and no
  input. The subject is chosen by query string: `?subject=cart-driver` | `cart-iron` |
  `cart-putter` | `target` | `ball`. It exposes `window.__gate` with a `metrics()` and a
  `signature()` call.
- `tools/gate.vite.config.ts`, alongside the existing `tools/probe.vite.config.ts`.
- Subjects are framed by their own bounding box so a geometry change moves the metrics rather
  than silently walking the subject out of shot.

Every subject is first-party procedural geometry constructed by the same code the game uses —
`GolfClub` for the cart variants, `TargetRig` for the ragdoll, the ball mesh for the ball. The
gate measures shipped geometry, not a copy of it.

### 3b. What is captured

Per subject, two artefacts:

1. **Structural metrics**, read directly off the `THREE.BufferGeometry` per `AGENTS.md` step 2 —
   summed vertex count, summed triangle count, and bounding-box width/height/depth from
   `Box3.setFromObject`.
2. **A perceptual signature** — the rendered canvas downsampled in-page to a 64×36 RGB grid,
   returned as JSON. A full-resolution PNG is written beside it for a human to look at when a
   diff fails.

### 3c. Why a downsampled signature rather than a full-resolution pixel diff

This is the one real design call in the gate, so it is argued rather than asserted.

`AGENTS.md` step 3 asks for a "perceptual diff (pixel-delta threshold, not exact match —
antialiasing/driver differences are expected noise)." Downsampling is the standard way to buy
that tolerance: it averages away exactly the high-frequency edge noise that antialiasing and
rasteriser differences produce, while preserving the shape, mass and colour distribution a
silhouette regression would move.

It also costs nothing. A full-resolution diff needs `pngjs` to decode the baseline and
`pixelmatch` to compare it — two new devDependencies in a repo that has five, to do a job a
64×36 average already does. And a JSON signature diffs legibly in git where a PNG does not, so a
reviewer approving `--update-baseline` can see *what* moved.

**The trade, stated so it is not discovered later:** a downsampled signature will not catch a
small high-frequency change — one facet on a club head, a bevel on the turret ring. The metrics
half catches precisely that, because triangle and vertex counts are compared exactly. The two
halves cover different failure modes, which is why both exist rather than either alone.

### 3d. Comparison, failure and baseline update

Baselines live in `tools/gate-baseline/`: one `metrics.json`, one `signatures.json`, and one
`<subject>.png` per subject.

- Vertex and triangle counts must match **exactly**. Procedural geometry is deterministic; a
  changed count is a changed model, and there is no noise to tolerate.
- Bounding-box dimensions must be within **±0.5%**, which absorbs float variation without
  admitting a real silhouette change.
- The signature must be within threshold on mean absolute per-channel delta.
- Any breach exits non-zero, printing the subject, the metric and the delta.
- `--update-baseline` rewrites all three artefacts. It is a deliberate human action: the PNG is
  written on every run into `tools/.gate-out/` so the diff can be reviewed before rebaselining.

### 3e. Wiring

`npm run gate` is added. Per `AGENTS.md` step 5, `build` becomes
`tsc --noEmit && vite build && npm run gate`.

**Cost, flagged rather than hidden:** `npm run build` now launches headless Chrome and takes
roughly 30 s longer. That is the price of the rule as written, and the rule was written knowing a
geometry regression is otherwise caught by a human happening to notice.

## 4. Target rendering — `src/entities/TargetRig.ts`

Follows `GolfClub.ts` exactly: a `THREE.Group` subclass, render-facing only, owning no Rapier
body and no authoritative state, posed each frame from a snapshot, with a traversing `dispose()`.

### 4a. One source of truth for the capsules

`Target.ts`'s private `RIG` table is exported as shape data — name, radius, half-height — and
`TargetRig` reads it. This is the same rule `GolfClub` already follows for `TURRET_GEOMETRY`, and
the same rule `AGENTS.md` states for `CLUB_STATS`: a visual capsule that disagrees with its
collider is the same class of bug as a club head that disagrees with its ballistics. The export
is shape data only; no Three type crosses into `src/sim/**`.

### 4b. Eleven `InstancedMesh`es, one per part name

Not thirty-three plain meshes, and not one instanced mesh. The eleven parts have eleven distinct
radius/half-height pairs, and a capsule under non-uniform scale stops being a capsule — its caps
distort. One `InstancedMesh` per part name, with instance count equal to the number of targets on
the hole, gives eleven draw calls no matter how many targets a hole later grows to.

`AGENTS.md` already anticipates `InstancedMesh` for Phase 3 targets and extends the
resource-cleanup rule to its buffers: `dispose()` frees every geometry and material on teardown,
following `GolfClub.dispose()`'s traverse pattern.

Materials follow `UI-SPEC.md` §6 — flat-shaded, saturated, untextured, silhouette-first. No
down-state tint: the collapse is what reads, and a colour change would be a second signal for a
state the pose already communicates.

### 4c. The collapse is interpolated

`Sim` gains `previousTargets` / `currentTargets` transform buffers, filled by a new
`syncCurrentTargets()` beside the existing `syncCurrent()` and `syncCurrentCart()`. `main.ts`
lerps position and slerps rotation into pre-allocated `FrameView` storage, the same way it
already does for the ball and the cart.

Uninterpolated, a ragdoll collapsing over roughly a second steps visibly at any refresh rate
above 60 Hz — and the collapse is the thing this slice exists to show. Applying the treatment
uniformly to standing parts as well as fallen ones costs a copy of thirty-three transforms per
tick and keeps the code one path instead of two.

All buffers are allocated at construction and rebuilt on `loadHole`; the frame path reuses scratch
`Vector3` / `Quaternion` / `Matrix4` objects, per the no-allocation-in-the-hot-loop rule.

### 4d. The boundary

`src/render/**` and `src/entities/**` read the snapshot and nothing else. They never touch a
Rapier body, never hold a `Target`, and never mutate `Sim`.

## 5. Pooled ball rendering

One `InstancedMesh` of `POOL_SIZE` (32) instances. `Sim` publishes pooled-ball transforms plus a
per-slot active flag through the same previous/current snapshot mechanism as §4c; inactive slots
are scaled to zero rather than removed, so the instance count never changes.

This is not decoration. Cart-mode shots are the only projectiles in the game, and today they are
invisible: the player fires, and a ragdoll falls over some distance away with nothing having
visibly travelled between them.

## 6. HUD — `src/ui/hud.ts`

`AGENTS.md` already reserves `src/ui/**` as a pure consumer of sim state, and `main.ts` is
currently doing HUD work inline. The HUD moves out; markup is added to `index.html` beside the
existing power bar.

**What ships:**

- **H6 — health bar.** Heart icon plus bar, fed by `Cart.health.hp` and `.max`.
- **H7 — ammo counter.** Bottom-left card, fed by `Cart.ammo`.

Those are the only two elements `UI-SPEC.md` §2 assigns to this phase. Both are marked `3 / 4`,
which the table's own preamble defines as "the first owns the state and the second owns the
presentation" — Phase 3 built the state; this is the presentation.

**The hiding rule, and why it works without the mode switch.** §5 says an inert full bar reads as
a bug and that the HUD hides H6/H7 rather than showing them full — and scopes that to
`STROKE` versus `CTF`/`TARGETS`, a switch that does not exist and is out of scope. §1 does not
need it: §1's table assigns Health to the **Cart HUD** and marks it absent from the **Swing
HUD**, and that split maps directly onto `SwingMode.Cart` / `SwingMode.Stationary`, which exists
today. So **H6 and H7 are hidden whenever `sim.mode === SwingMode.Stationary`.** When
STROKE/CTF/TARGETS lands, these elements gain a second hiding condition rather than a new
mechanism.

**Death and respawn feedback ships as a status-line case, not a new component.** `stepRespawn`
ignores every intent — drive, steer, aim, fire, club select, mode toggle — for `RESPAWN_DELAY_S`,
so an uninformed player sees the game freeze for three seconds. That is a playability hole, not
missing polish. `#hud-status` is already the slot for exactly this kind of transient state
(`RELOADING 1.2s`, `WATER HAZARD — plus one stroke`), so death becomes one more case in it:
`DESTROYED — RESPAWNING 2.4s`. H12 proper, and a real death banner, stay Phase 4's.

**State derivation stays DOM-free.** The functions that turn `Sim` into HUD values live apart
from the functions that write them into elements, so Vitest's node environment can test the
first half without a DOM.

## 7. Backlog #16d — honest reads

- **`Sim.ballLoaded` and `Sim.ballInReach` are deleted.** The mechanic they described is gone
  (§2), no test references them, and leaving a field nothing honestly reads is the disease #16d
  names.
- **`FrameView.ballLoaded` becomes `turretLoaded`**, derived as `mode === SwingMode.Cart &&
  cart.ammo > 0`. What rides the club head in cart mode is a round of ammo — that is what images
  03 and 04 show and what actually fires. `GolfClub.setBallLoaded` keeps its name and its job:
  show a ball on the club head.
- **The course ball stays visible in cart mode.** It is the stroke-play ball, it is still lying
  there, and cart fire no longer consumes it.
- **Status strings.** `BALL LOADED — fire to play it`, `BALL SETTLING…` and `NO BALL — fire a
  blank to boost` go; ammo state is H7's job now. `NO AMMO — fire a blank to boost` replaces the
  last of them, which is the one rule that survived the fork intact.

## 8. The smoke rewrite

`tools/smoke.mjs`'s three failing assertions are rewritten to the mechanic that exists, not
patched to pass. Its `FIRE FROM THE MUZZLE` block asserts instead that firing in cart mode with
ammo available:

- decrements `cart.ammo` by one,
- spawns a pooled ball, and
- that pooled ball leaves from above the cart, not from the ground.

It reads none of `sim.strokes`, `sim.current` or `sim.ballLoaded` for a cart-mode shot. The
`BALL ON THE TURRET` block is rewritten against `cart.ammo` for the same reason. Everything
earlier in the script — boot, mode toggle, drive, steer, turret, club select, blank fire — is
correct today and is left alone.

## 9. Error handling / edge cases

- **A hole with zero targets.** `InstancedMesh` count zero is legal; the rig renders nothing and
  disposes cleanly.
- **`loadHole` and `reset`.** `buildTargets` disposes and rebuilds `Sim.targets`, so the snapshot
  buffers and the eleven instanced meshes are rebuilt on the same signal. `reset()` stands targets
  back up without changing their count, so only the buffer contents change.
- **Interpolating across a rebuild.** The tick after `loadHole` or `reset` has a `previous` that
  belongs to the old pose. Both are already discontinuities for the ball and cart; targets snap
  the same way, by seeding `previous` from `current` at rebuild time rather than lerping through
  a teleport.
- **A pooled ball released mid-flight** (despawn timer, or scooped as ammo): its slot's active
  flag goes false on the tick it is released, and the instance scales to zero. No interpolation
  is attempted from an active slot to an inactive one.
- **Gate subject framing.** If a geometry change moves a subject's bounding box enough to clip
  the frame, the metrics check fails on the bbox before the signature check reports a meaningless
  diff — which is the intended order.
- **Gate rasteriser drift.** Software rasterisation via `--enable-unsafe-swiftshader` is what
  makes the signature portable. If the baseline is ever captured under hardware GL it will not
  compare; the gate asserts the flag is in effect rather than trusting the invocation.
- **A dead cart's HUD.** H6 shows zero rather than hiding — an empty bar is the true reading, and
  §5's rule is about elements with *nothing behind them*, not about a real value of zero.

## 10. Testing

Three layers, per `AGENTS.md`, answering different questions and not substituted for one another.

**`npm test`** — 232 tests currently pass and must keep passing. New colocated suites:

- `world.targets.test.ts` (or additions to `world.cart.test.ts`): the target snapshot buffers
  match `Sim.targets[i].parts[n]` positions after a step; `previous` seeds from `current` across
  `reset()` and `loadHole` rather than retaining a stale pose; the pooled-ball buffers' active
  flags follow acquire/release.
- `src/ui/hud.test.ts`: the pure state-derivation half — H6 and H7 hidden in
  `SwingMode.Stationary` and shown in `SwingMode.Cart`; health fraction from `hp`/`max`; the
  status line returning the death case while `cart.dead`, and its precedence against reloading and
  the hazard cases. No DOM; this runs in the node environment like everything else.
- No test asserts "it renders." Per `AGENTS.md`, a render check is never evidence about
  simulation.

**`npx tsc --noEmit`** — clean, with `strict`, `noUnusedLocals` and `noUnusedParameters` left on.

**`npm run smoke`** — green, after §8's rewrite. This is the layer that proves the real browser
path, and it is the only one that will notice if the HUD elements are wired to nothing.

**`npm run probe`** — output byte-for-byte identical to the current run, including its
pre-existing `driver distance` failure. This slice adds read-only snapshot buffers and changes no
physics; that claim is verified by diffing the output, not asserted. The pre-existing failure is
not this slice's to fix.

**`npm run gate`** — green against baselines captured in this slice, covering the cart with each
of the three club heads, the target rig, and the ball. Capturing a baseline is not evidence the
geometry is right; it is evidence the geometry has not silently changed since a human looked at
it. The PNGs are reviewed once, by a human, before they are committed.

## 11. Open parameters for the implementation plan

- **Signature grid size** — 64×36 is a starting value chosen for the 16:9 viewport, not a
  measured one. The plan should confirm it discriminates a real geometry change from run-to-run
  noise by capturing two runs of an unchanged subject and one of a deliberately altered subject.
- **Signature and bbox thresholds** — the ±0.5% bbox band and the signature's mean-delta
  threshold need the same two-run measurement before they are fixed. A threshold that has never
  seen its own noise floor is a guess.
- **Target material palette** — `UI-SPEC.md` §6 fixes the language (flat, saturated, silhouette
  first) but not the colours. Image 05's caddie is the reference.
- **HUD geometry** — H6 and H7's exact placement is Phase 4's layout problem. This slice places
  them so image 08's full set can later be laid out without moving them, and no further.

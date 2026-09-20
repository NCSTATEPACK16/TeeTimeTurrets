# Handoff — next session

Written 2026-09-20, at the end of the session that made the bot arena winnable and started the
Phase 4 presentation pass. Rewrite this file at the end of each session; it is a baton, not a log.

---

## Where things stand

**The single-player-vs-bots arena is now an actual game, and it has been eyeballed in a browser.**
Before this session the arena was reachable (Title → ARENA) but not winnable: bots fired the lofted
driver from a 12 m standoff and every shot sailed over the target, so matches never resolved on
kills. That is fixed, and the Phase 4 HUD/presentation layer — which the docs had badly undersold —
is now most of the way done.

The committed goal is a **polished single-player release you play against bots, with assets**. Real
server-authoritative multiplayer (Phase 5: Colyseus, lobby, docker) stays **deferred** — the
MULTIPLAYER title button is intentionally disabled. See `docs/ROADMAP.md` for the phase gates.

**Verified at the tip (`b3ed7b4`, before merge):**

```
tsc --noEmit    clean
npm test        965 passed, 69 files   (use --testTimeout=30000; see below)
npm run build   vite build OK (chunk-size warning is the pre-existing Rapier WASM)
npm run probe   red on the one known driver-distance line only (expected; a 2nd red line is a regression)
```

`npm test` still wants `--testTimeout=30000`: at the default 5 s a few Rapier tests flake, pre-existing
on `main`. **`npm run smoke` and `npm run gate` cannot run in the Claude-Code-on-web sandbox** — headless
Chrome times out loading the preview page (confirmed identical on clean `main`, so it is the environment,
not a regression). Run those, and any visual sign-off, in a real browser env.

## What this session shipped (four commits over `main`)

Each is `git commit -s` (DCO) with **no AI-session metadata** — see the commit rule below.

1. **Winnable bots.** Bots equip the **putter** (flat, 3°) and stand off at **7 m**, the distance a
   fired ball actually returns to cart height (measured against the real Rapier world; the driver
   only comes back down near 63 m). Added `BOT_FIRE_RANGE` so a bot holds fire until the target is in
   the putter's ~9 m reach instead of emptying its magazine while closing. `src/sim/bot.ts`,
   `src/sim/world.ts` (bot construction). Regression: `src/sim/arenaCombat.test.ts` drives the real
   bot AI through the real world and asserts a bot kills an idle player.
2. **`Sim.previewTrajectory()`** — a non-mutating forward integration of the current shot for the aim
   arc (UI-SPEC H10). Byte-identical sim state asserted; predicts landing within 0.02 m of a real
   shot. `src/sim/world.ts`, `src/sim/previewTrajectory.test.ts`. **The render arc that draws it is
   not built yet** — that is the top of the pick-up list.
3. **Event banners (H12)** — `WATER HAZARD` / `OUT OF BOUNDS` in stroke play, `ENEMY DOWN` /
   `DESTROYED` in the arena. DOM-free tested feed in `src/ui/bannerFeed.ts`, thin writer
   `src/ui/banner.ts`, container in `index.html`, wired in `RoundScreen`.
4. **Hit markers (H11)** — player-attributed `+50` / `ENEMY DOWN` callouts at the hit's world point.
   Sim keeps a per-tick pool of player-attributed events (`Sim.hitEvents` / `hitEventCount` /
   `hitEventEpoch`); `combat.ts`'s `onBallHit` now carries the impact position. Render layer
   `src/ui/hitMarkers.ts` spawns one-shot DOM nodes at `RenderScene.projectToScreen` points.

**M2 is ~90% done.** Already existed (docs lag the code): HUD, nameplates (`src/ui/nameplates.ts`),
full-course map (`src/ui/courseMap.ts`, `M` key), pin marker, and the surface shader's water tint +
fairway/green mow stripes (`src/render/groundShader.ts`).

## Pick up here (in order)

1. **Trajectory-preview render arc.** The sim core (`Sim.previewTrajectory`, `createPreviewBuffer`,
   `PREVIEW_MAX_POINTS`) is done and tested. What is left is drawing it: a fading arc (solid in the
   air) from the buffer points, updated each frame in `RoundScreen`/`RenderScene`, using
   `cart.charge` and `cart.turretYaw`. Pure render, so verify it in a browser.
2. **Touch control layer** (image 14): a second `InputSource` implementation (the interface and
   `KeyboardMouseSource` already exist). If it needs interface changes, the interface was wrong —
   fix it there, not around it.
3. **Water splash** — a ring of white angular shards at `WATER_LEVEL` on entry (image 08), not a
   particle system. The water plane and hazard rule already exist; this is the effect.
4. **Audio (M3), all new.** No audio exists anywhere. Build `src/audio/` — a WebAudio bus
   (master/SFX/music, mute, volume) plus event-driven SFX, ideally **synthesised** to match the
   zero-external-asset ethos. Subscribe to the same public state edges the banner does. Add a real
   Settings screen for volume/mute (it is a stub today). Audio quality needs to be *heard*, so do it
   where you can hear it.
5. **Authored 3D props (M4)** — clubhouse exterior, tee signs, course props via the Blender
   primitive-graph pipeline (`src/entities/primitiveGraph.ts`, `docs/ASSET_PIPELINE.md` §2). Needs
   Blender + visual review. **AGENTS.md geometry rules are hard:** nothing on the playable path ships
   as `.glb`; decorative-only GLB loads behind a null check that degrades to nothing; AI-generated
   geometry is never shipped. `art/clubhouse-and-cart.blend` is still uncommitted and unexplained —
   ask before touching it.
6. **Content (M5), sim-testable here.** Stage D pickups
   (`docs/superpowers/plans/2026-09-12-stage-d-pickups-implementation.md`, not started — traps: read
   the clubhouse from the layout, `AUTHORED_CLUBHOUSE` is at `{x:-243.4,z:-533.3}` not the origin;
   `PICKUP_CHANNEL = 5` is free; do not teleport carts to force contention). **Trees are visual only**
   — `createTrees` in `src/render/Trees.ts` has no sim collider, so a ball passes through a tree.
   Adding collision means moving the seeded scatter into `src/sim/**` (DOM-free) so both render and a
   Rapier collider read the same positions; **watch the collider count at arena scale** (18 holes ×
   up to 4000 trees) and cap it.

## Traps that cost time this session (and will again)

- **No AI-session metadata in git, ever** (`AGENTS.md`): no co-author trailers, no session/chat URLs,
  no "generated with" footers, in commit messages or PR bodies. DCO sign-off (`git commit -s`) is
  still required. The first commit this session shipped with the trailers and had to be amended and
  force-pushed. Match existing history.
- **Do not test a ball-on-cart hit by pinning a cart with `setTranslation` each tick.** A teleported
  kinematic body does not reliably generate a *started* contact against the CCD ball, so the hit
  never fires `processContacts`. A whole afternoon went into this. Test the event *plumbing* instead
  (epoch/reset/attribution) and rely on `combat.test.ts` for the position threading; the real hit is
  a browser check.
- **A full-charge putter overshoots a target at the 7 m standoff** — it is still ~1.6 m up there.
  Bots (and the test) fire at ~0.8 charge, where the arc reaches cart height around 7 m. Same lesson
  as the driver-loft bug.
- **`npm run probe` is expected RED** on the one driver-distance line. Only a second red line is a
  regression. Re-run the tunneling check after any ball/terrain physics change.
- **Search, never trust a doc/plan line number** — they go stale in this repo.
- **Verify "pre-existing" against `main`, not your branch tip** (this is how `smoke` was correctly
  ruled an environment limitation rather than a regression).

## Deferred (not this release)

Phase 5 server multiplayer in full: `server/**` importing `src/sim/**`, Colyseus room + schema, the
match lobby (image 12), snapshot interpolation + local-cart prediction, Dockerfile/compose. Sim-first
design keeps this a transport+reconciliation add later, not a rewrite — which is why shipping the bot
game first is safe.

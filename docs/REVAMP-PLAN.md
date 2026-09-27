# Revamp plan: environment, course and handling

Written 2026-09-27. **This is the master stage order.** It supersedes the phase order in the older `what-is-next-in-eager-frost.md` plan, which lives only on the user's machine; everything a cloud session needs from it is copied here. `docs/HANDOFF.md` is the baton that says where to pick up.

## Why

After Stage 1 the arena plays as a game, but:
- **The world is bare.** A match has no shadows, no tone mapping and a flat sky. The only vegetation is the road treeline, and water is just paint on the ground.
- **Carts handle flat.** They glide with fixed surface multipliers.
- **The arena is too big.** It is all 18 holes, about 1.6 × 1.3 km, for a 3-minute 4v4, and bots drive in straight lines.

Claude of Tanks (CoT) was reviewed for techniques. What we took and what we may not take is set out under **License** below.

## Decisions (user, 2026-09-27; do not relitigate)

| Topic | Decision |
|---|---|
| Arena | **Holes 1, 9, 10, 14, 15 and 18** (indices 0, 8, 9, 13, 14, 17) around the clubhouse, about 600 × 350 m. The other 12 holes are dressed backdrop. |
| Boundary | White stakes and a rope line. Crossing it shows an OUT OF BOUNDS warning, then drains 1 HP every 2 s. A hard clamp sits 30 m past the stakes. Bot navigation never leaves the zone. |
| Handling | **Keep the KCC.** Add a feel layer: a mobility table (surface resistance and grip, with max climb derived from them), throttle spool, turn speed-bleed, and render-only spring pitch/roll/bounce. Bots use the same table. |
| Look | Desktop-first, with **Low/Med/High presets**. Low is kept for a later iPhone target. |
| Autonomy | A cloud session works one stage autonomously, pushes, and updates that stage's draft PR, then **stops** for a local play-test. Gate re-baselines need the user's approval. |
| Branches | Stage 1 finishes on `arena-only` (draft PR → `main`). Each later stage gets `stage-N-<slug>` from `main`, or from the previous stage branch if that hasn't merged yet. |
| Unchanged | Friendly fire off. Blender edits only a NEW `.blend`, never `art/clubhouse-and-cart.blend`. `git commit -s` only, with no AI metadata. Never `git add -A`. |

## License (binding)

- **Allowed.** `src/vendor/cot/` holds MIT code from CoT (`terrainMobility.ts`, `botRoutePlanner.ts` and `shadowStability.ts`), with a `NOTICE` entry for each. `reference/claude-of-tanks/*.ts.txt` holds MIT engine files (sky, lighting, quality, cameraRig and post) as reading material only. Adapt them in small pieces, and any piece that lands in `src/` gets a `NOTICE` entry.
- **Not allowed.** CoT's Reserved Content (`src/world/**`, `src/vehicles/**`, `docs/research/**` and the rest listed in `AGENTS.md`) is proprietary. Nothing from it is in this repo, and nothing may be. The environment techniques below are described **by name only**; implement them from scratch.
- **Textures.** `public/textures/terrain/` holds CC0 sets from ambientCG and Poly Haven (see `LICENSES.md`).

## Stages

| # | Stage | Where | Milestone |
|---|---|---|---|
| 1 | Finish Stage 1: 1.8 wiring, 1.9 rematch, checkpoint | cloud | Stage 1 |
| 2 | Juice and audio | cloud | Stage 2 |
| 3 | Foundations: performance + render base | cloud | Stage 3 |
| 4 | Handling feel + arena zone | cloud | Stage 4 |
| 5 | Environment | cloud | Stage 5 |
| 6 | navGraph | cloud | Stage 6 |
| 7 | Clubhouse and pickups (Blender) | **local only** (needs Blender MCP) | Stage 7 |
| 8 | Economy | cloud | Stage 8 |
| 9 | Refactor | cloud | Stage 9 |
| 10 | Docs | cloud | Stage 10 |

**Every stage ends the same way:**
1. `npx tsc --noEmit`
2. `npm test -- --testTimeout=30000`
3. `npm run smoke`
4. `npm run build` (this includes the gate)
5. `npm run probe`
6. Paste the output into the PR description, rewrite `docs/HANDOFF.md`, push, and **stop**.

### Stage 1: finish (on `arena-only`)
`docs/HANDOFF.md` has the full detail under "Pick up here".
- **1.8 Wire `BotMind`.**
  - `CartRig.mind` holds the mind. Seed the skill with `mulberry32(hashChannel(seed, 0, BOT_SKILL_CHANNEL, botIndex))()`, passing the bot index in.
  - With no ammo, `intentFor` writes the nearest off-cooldown bucket or landed ball into the mind, without allocating.
  - Pass `rig.mind` to `computeBotIntent`.
  - Done when `src/sim/botMind.test.ts` goes green, the golden is re-recorded, and `botAcceptance` passes.
- **1.9 Rematch.**
  - `Sim.reset` releases the ball pool, resets bucket cooldowns and `simTime`, and resets each mind.
  - Fix the buzzer tick: `step()` returns as soon as `match.tick` sets `over`, which discards the final tick.
- **Checkpoint.** Update smoke for mouse fire and the turret camera. A gate re-baseline needs the user's approval.

### Stage 2: juice, audio and feedback
- **`Sim.events`.** A preallocated ring buffer of hit, kill, stroke, pickup, splash and respawn events. The UI and audio drain it each frame. It replaces the ad hoc `hitEvents`.
- **HUD.**
  - Kill feed and team score strip (US n – THEM n).
  - Damage-direction flash.
  - Real score values on hit markers, replacing the fake "+50".
  - Low-HP vignette.
- **Effects.**
  - Pooled, instanced, flat-shaded muzzle and impact puffs.
  - Water splash ring.
  - Death burst, with the dead cart hidden until respawn.
  - Camera shake on a driver shot, a hit or a kill. Build it as a **trauma** value that decays, which Stage 4 reuses.
  - Speed-based FOV kick.
- **`src/audio/`.**
  - Synthesised WebAudio on master, SFX and music buses.
  - Sounds: putter pop, iron clack, driver thwack, hit, hurt, kill, pickup, low-HP, and an engine hum pitched to speed.
  - A Settings screen (volume, mute, sensitivity), saved to localStorage inside try/catch.
- **Pause** on Esc freezes the sim. Show a controls overlay on first play.
- **`M` map.** Rewire `ui/courseMap.ts` to `mapGeometry`, with team-coloured blips.

### Stage 3: foundations (performance + render base)
**Performance:**
1. **Baked terrain grids.**
   - `CourseWorld` memoizes the heightfield and bakes height, surface and tuning grids.
   - Sim queries use bilinear lookup.
   - Re-record the golden and say why.
2. **Nameplate line of sight.** Only for plates on screen and in range, at 10 Hz, staggered, against the baked grid.
3. **Build the ground once.**
   - `CourseGround` and the treeline are built once and reused across matches.
   - Near tiles are evicted least-recently-used (cap 20, with hysteresis).
   - `aBiome`/`aMow` are stored as 8-bit, and the CPU arrays are freed after upload.
   - Fuse the three `weightsInto` passes.
   - Test that the tile count stays bounded.
4. **Cart draw calls.** Merge the rider, merge the static chassis per slot, and cache geometry per cart. Target about 150 draw calls for 8 carts.
5. **No per-tick sim allocations.**
   - Double-buffer `cartTransformOf`.
   - `ballsNear` writes into a scratch array.
   - A rest-count field replaces the `WeakMap`.
   - Hoist the `combat.ts` closure.
   - Add an allocation-count test.
6. **Loading.**
   - Cap DPR by preset.
   - Dynamic-import the sim and Rapier on first PLAY, prefetched from the title screen.
   - Lazy-load `GLTFLoader`.
   - Split the bundle (BACKLOG #40).
7. **Readout.** A frame-time and draw-call readout on the dev hook. Record the numbers in the PR.

**Render base:**
- **`render/quality.ts`.** Low/Med/High presets as plain data: DPR cap, shadow map size and cascades, AO, grass density, tree cap, SMAA and water quality.
  - Auto-pick from the device, overridable in Settings (Stage 2).
  - The pattern comes from `reference/claude-of-tanks/quality.ts.txt`.
- **Colour pipeline.** `outputColorSpace = SRGBColorSpace`, `ACESFilmicToneMapping`, tuned exposure. Re-check the `BIOMES` palettes under tone mapping.
- **`render/sky.ts`.**
  - A gradient sky dome baked to a PMREM environment (`scene.environment`).
  - The fog colour is read back from the sky's horizon so fog and sky always match.
  - Use `FogExp2`.
  - Guard the env bake against NaN pixels (iOS).
  - Adapt from `reference/claude-of-tanks/sky.ts.txt` in small pieces.
- **Shadows.**
  - **Med:** one directional shadow map that follows the camera, texel-snapped with `snapShadowCoordinate`, and biased with `shadowNormalBiasForTexel` from `src/vendor/cot/shadowStability.ts`.
  - **High:** CSM from `three/addons`, which must be created before any lit material compiles.
  - Add a hemisphere bounce light.
  - Carts and props cast shadows; the ground receives them.
- **Post.** High only: an `EffectComposer` with SMAA and a light bloom. Med uses MSAA only.
- **Accept.**
  - Gate subjects re-baselined, with the user's approval.
  - Frame time within budget on the smoke course at Med.
  - Draw calls logged.

### Stage 4: handling feel + arena zone
- **Mobility (`sim/mobility.ts`).**
  - Wrap `src/vendor/cot/terrainMobility.ts`.
  - Map each `SurfaceId` to a resistance and grip.
  - Tyres (`TIRE_TUNING`) feed grip.
  - The max climb comes from accel × grip, replacing the flat `CART_MAX_SLOPE_CLIMB_DEG` for the KCC's climb check.
  - `cartSpeedScale` comes from resistance.
  - Tests:
    - rough is slower than fairway
    - sand on a steep grade blocks the climb where fairway doesn't
    - knobby tyres beat street tyres off-road
- **`Cart.ts` feel,** with every value in `CART_TUNING` and unit-tested:
  - Throttle spool: about 25% of the drive is instant, full at about 0.6 s.
  - Turn speed-bleed.
  - Downhill bonus, capped at 1.15×.
- **Visual suspension (`render/cartSuspension.ts`), render-only.**
  - Sample `heightAt` at the 4 wheel contact points.
  - Fit pitch and roll.
  - A critically damped spring (about 2 Hz) on pitch, roll and heave.
  - A landing bounce after airtime.
  - The sim transform is untouched, so the golden shouldn't move. If it does, find out why.
- **Camera (`render/chaseCamera.ts`).**
  - Stage 2's trauma drives the shake.
  - Terrain look-ahead samples keep the eye above rises and pull the camera in when it is blocked.
  - Speed-based FOV.
- **Zone (`sim/arenaZone.ts`).**
  - The polygon is the union of the six holes' corridors, padded, plus the clubhouse pad.
  - The cart carries an OOB timer. The warning is immediate, then 1 HP drains every 2 s, and a stroke is charged at 0 HP as usual.
  - `clampToPlayable` becomes the zone plus 30 m. The road clamp stays.
  - Spawns stay at the clubhouse.
  - Bot intents clamp their targets into the zone.
  - Render: instanced white stakes every 15 m along the edge, a rope between them, and a HUD warning.
  - Tests:
    - every tee, cup and clubhouse pad of the six holes is inside the zone
    - a cart parked outside the zone loses HP on schedule
    - no bot target is outside the zone
    - the smoke test still spawns both teams inside the zone

### Stage 5: environment
Techniques are named here; write the code from scratch.
- **Textured ground splat (`render/groundShader.ts`).** It samples the CC0 sets in `public/textures/terrain/`:

  | Set | Surface |
  |---|---|
  | `Grass004` | Fairway and green. The existing mow-stripe tint goes on top, with a finer scale on greens. |
  | `withered_grass` | Rough |
  | `Ground093C` | Sand (check it visually; if it doesn't read as sand, fetch a CC0 sand set from ambientCG and record it in `LICENSES.md`) |
  | `Ground071` | Dirt and cart path |
  | `Rock058` | Grades steeper than about 35° |

  Techniques:
  - **Anti-tiling:** a second sample of the same texture, rotated about 40° and scaled about 1.15, blended in by a low-frequency noise mask.
  - **Slope-driven rock takeover.**
  - **Distance detail fade:** normal strength and texture contrast fade toward the biome flat colour with distance.
  - **Domain-warped patch edges** between surfaces, with the same warp function available on the CPU so dressing can follow it.
  - **Budget:** resize the textures to 512 px or compress them to KTX2 so the bundle budget holds. Load the full set at High and a subset at Low.
- **Water (BACKLOG #21).**
  - A plane per pond polygon.
  - An animated normal map, fresnel against the env map, and a shore fade using depth, or distance to the polygon edge at Low.
  - A splash hook fed by `Sim.events`.
- **Trees (`render/courseDressing.ts`).**
  - Start from the archived `courseTrees.ts` (tag `archive/wonderful-edison`, commit `cbfedd5`). It is tested and already uses `weightsInto` for biome and `weightsAt` for surface, with one `InstancedMesh` per biome.
  - **Fix its row-major scan:** with a global cap, it fills the southern rows first and runs out before the north. Place per hole with a per-hole budget, or cap by blue noise.
  - Add:
    - Poisson/blue-noise placement per hole.
    - Denser stands between holes, as cover.
    - Rejection on fairway, green, water, path and within the zone's lanes.
    - Caps set by the preset.
    - Cross-quad impostors beyond about 250 m.
    - **Sight-line dither:** trees inside a capsule between the camera and the player's cart fade out with a dither.
- **Grass carpet (`render/grassCarpet.ts`).**
  - A camera-following ring of 16 m cells out to ±48 m. Cells are cached and rebuilt only when the camera changes cell.
  - Instanced blades with a vertex-shader wind sway.
  - Rough and fairway edges only, never on greens or sand.
  - A circular fade at the edge.
  - Frustum-culled per cell.
  - Density set by the preset.
- **Course props.**
  - Start from the archived `courseProps.ts` (tag `archive/wonderful-edison`, commit `1c49b15`), which is tested. It runs the per-hole `props.ts` derivation over all 18 holes, gives each prop kind one draw via `mergeGraphInstances`, and puts a `Flagstick` on every green.
  - Add `SurfaceId.Tee` (raised mown tee boxes).
  - **`sim/cartPaths.ts`:** polylines from the clubhouse to each tee and from each green to the next tee. Driving on a path gives a speed bonus, and paths are shaded in the splat.
- **Backdrop.**
  - The 12 holes outside the zone are dressed at lower tree LOD.
  - A distant horizon ring of tree silhouettes.
  - A golden-hour title backdrop. Then delete `render/ground.ts`.
- **Accept.**
  - A `course-dressing` gate subject.
  - Med holds the frame budget on the smoke run.
  - Instance and draw-call counts are recorded in the PR.

### Stage 6: navGraph
- **`sim/navGraph.ts`** adapts `src/vendor/cot/botRoutePlanner.ts`: a seeded grid A* with a min-heap. Changes:
  - The grid covers **the zone only**. The planner's hard-coded ±500 m world and 25 m cells must become parameters.
  - A cell is passable when the Stage 4 mobility table can drive its grade and the cell is neither water nor woods. Cart paths are cheaper.
- Replan at most once a second. With direct line of sight inside 80 m, skip the plan. The graph must build in ≤150 ms.
- **Tests:**
  - the graph is connected across the zone
  - a bot routes around the hole-18 pond
  - no route leaves the zone
  - the build time is within budget

### Stage 7: clubhouse and pickups (Blender, **local session only**)
- **New `art/clubhouse-exterior.blend`**, never the old one. Authoring is primitive-graph JSON only.
- **Assets:**
  - Clubhouse, about 24×14 m.
  - Cart barn, about 16×10 m.
  - Lot striping and lamps.
  - Pickups: bucket, hot dog, drink.
  - Food cart and tee signs.
- **Sim and render:**
  - `sim/clubhouse.ts`: footprints and colliders, with a guard that each is within 0.1 m of the graph bounds.
  - `render/clubhouse.ts`, placed at `AUTHORED_CLUBHOUSE`. Compare the archived `cb039b6`.
- **`sim/pickups.ts`:**
  - Bucket gives ammo, hot dog gives `heal(3)`, drink gives shield plates.
  - Respawn timers.
  - A depot ring of 2 of each at the clubhouse, plus a seeded scatter inside the zone.
- **Gate:** add a `clubhouse` subject.

### Stage 8: economy
- **`sim/scoring.ts`:**
  - score = `100·kills + 40·assists + 10·damage + 15·pickups + 250·won`
  - coins = score / 2
  - XP = score
  - `xpToNext = 500 + 250·level`
- **`app/profile.ts`:**
  - localStorage, versioned and schema-guarded.
  - A new profile starts at 0 coins.
  - It fixes the owned-items bug in `clubhouseState.ts`.
- **`UPGRADES` data:** armor, ammo capacity and reload speed, tyres, and the driver unlocking at level 2. `applyLoadout` is the only place stats change.
- **Loadouts for every rig**, so paint and skin render in the match.
- **`MatchResultsScreen`** after each match.

### Stage 9: refactor
- **Delete the generator:**
  - `courseRelaxation.ts`
  - from `courseLayout.ts`: `solveCourseLayout` and its lobe/circle helpers
  - from `course.ts`: `generate*`, `draftHole` and `derivePar`
- **Moves and renames:** `validateHole` goes to `sim/holeValidation.ts`, and `feelProbe` becomes `turretProbe`.
- **Split `world.ts`** into physicsWorld, rigs, hazardRules, respawn, shots, botDriver, pickups and snapshot, leaving about 300 lines.
- **Cleanup:** add `sim/vec.ts`, add an import-direction test, and remove dead members.

### Stage 10: docs
Update `ROADMAP.md`, whose Arena section is stale, and `ARCHITECTURE.md`, `COURSE_PIPELINE.md` and `DECISIONS.md` to match what shipped.

# GolfCartSimulator — PRD v2.6

Oct 17, 2026 · @John Bradner

## What changed in v2.6

| Area | v2.5 | v2.6 decision |
| --- | --- | --- |
| First real course | Lonnie Poole (neutral in-game name) | **Caswell Pines Golf Club, Caswell County, NC.** M2 starts with hole 1, then the other 17 |
| Course reference | Gemini concept art; `lookdev.py` renders | Plus drone flyover stills and notes for all 18 holes (par, handicap, yardages, layout cues). **Private reference only:** kept in `data/reference/` (gitignored), never committed, shipped or traced into assets |
| Sun latitude | 35.76°N (Raleigh) | The course's own latitude, about 36.4°N for Caswell County, read from the packet's location |
| Sky, clouds, water look | Generic three.js techniques | Use [web-ocean](https://github.com/Noniv/web-ocean) (MIT) as the reference implementation: Hillaire atmosphere LUTs, two cloud layers, sun disc and glitter, LEAN-mapped water slopes, roughness-filtered sky reflections, AgX post. It is raw WebGPU and WGSL, so it is **ported to TSL**, not dropped in. **Water superseded (Oct 17):** all water uses the afl_ext Shadertoy ocean (MdXyzX) port instead; see the Water row in "Realism recipe" |

The scorecard from the flyover graphic: par 72, 6517 / 6069 / 5635 / 4897 yards from the four tees. Holes with water: 4, 13, 15, 18 (ponds) and a creek on 12.


## What changed from v2

Stay on three.js (WebGPURenderer + TSL) and Rapier, but aim for grounded realism in the world and arcade fun in the cart. The course is authored from real data, not copied from it: terrain is smoothed by surface type and cart paths are rebuilt as splines carved into the ground.

| Area | v2 | v2.5 decision |
| --- | --- | --- |
| Name | Golf Cart Explorer | **GolfCartSimulator** (repo `NCSTATEPACK16/GolfCartSimulator`) |
| Tone | Relaxing only | Two modes: **Chill** (15 mph, forgiving) and **Joyride** (up to \~30 mph, drifts, skids, splashes) |
| Look | Stylized-realistic | Grounded realism: PBR materials, physical sky, volumetric morning fog, dense GPU grass, real water |
| Engine | three.js, renderer TBD | three.js r186+ `WebGPURenderer` + TSL, locked. WebGL2 fallback runs a reduced Low tier |
| Terrain | DEM + OSM sculpt | **Authored-over-measured** pipeline: denoise, per-surface smoothing, procedural greens and bunkers |
| Cart paths | OSM lines as-is | Spline rebuild: simplify, smooth, grade-limit, carve a corridor, separate path ribbon mesh |
| Cart feel | Gentle, no flips | Arcade-sim hybrid: handbrake drift, skid marks per surface, water drag and spray, sand roost, small jumps |
| Blender | Hero assets only | Also a scripted look-dev and LOD bake step (`blender --background --python`) |
| Engagement | Collectibles, photo mode | Plus beverage-cart deliveries, flag time trials with ghosts, turf-damage meter, photo mode |

The gate protocol, level packet idea and synthetic-first M0 from v2 are kept.

## Vision and modes

A golf course that looks like a real Piedmont morning, and a golf cart you can drive however you like: slow and scenic, or sideways through a bunker. Success is a player who drives 10+ minutes unprompted, takes a screenshot, and laughs at least once.

### Pillars

1. **Believable place.** Light, grass, water and trees read as real at a glance. Realism goes to the world, not to punishment.
2. **Toy-box cart.** The cart is a playful vehicle with real weight. Mistakes are funny, never fatal.
3. **No fail states.** No damage, timers or lives unless the player opts into a challenge.
4. **Seasons and time of day.** The same course feels new in spring bloom, summer haze, autumn color and winter frost.

### Driving modes

| Setting | Chill | Joyride |
| --- | --- | --- |
| Top speed | 6.7 m/s (15 mph) | 13.4 m/s (30 mph), boost to \~15 m/s |
| Acceleration 0 to top | \~4 s | \~3 s |
| Grip | High, stable | Lower rear grip, handbrake drift |
| Rollover | Righting assist above 25° roll | Assist only after 2 s on side; flips allowed and funny |
| Skid marks and turf damage | Light, fade after 60 s | Full, persist for the session |
| Water | Slow wade, gentle splash | Spray, wake, hydroplane, stall in deep water |
| Camera | Soft chase, scenic idle cam | Tighter chase, speed FOV kick, light shake on landings |

Speeds are design targets. A stock electric cart tops out around 14 to 15 mph; Joyride is the souped-up fantasy.

## Engine decision

Three.js with `WebGPURenderer` is the right engine. It now ships the realism features this game needs, it is what Claude Code writes most reliably, and it reuses CallofGolf's Rapier, loop and input code. Babylon.js is the only serious alternative.

| Option | Realism features (2026) | Fit for this project | Verdict |
| --- | --- | --- | --- |
| [three.js r186](https://cgworld.jp/flashnews/01-202610-Threejs-r186.html) WebGPU + TSL | SSGI (r184), volumetric fog, improved sky clouds, progressive light probe grid, native Gaussian splats; SSGI/SSS/better DoF are [WebGPU-only](https://threejs.org/manual/en/webgpurenderer) | Matches CallofGolf, huge example base, TSL compiles to WGSL and GLSL | **Use** |
| [Babylon.js 9](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0) | Clustered lighting, volumetric lighting, Frame Graph, mature tooling; 9.26 added a [dithered tile-fade terrain material plugin](https://gamedev.net/news/5769/) | More batteries included, but a new API to learn and no reuse | Fallback if three.js realism stalls at M3 |
| PlayCanvas 2.x | Editor-first; heavy investment in [Gaussian splatting](https://app.cinevva.com/news/2026-03-06-playcanvas-v217-webgpu-splatting) | Editor workflow fits Claude Code poorly | No |
| [Unity 6.6 web](https://app.cinevva.com/news/2026-09-01-unity-6-6-webgpu-production) | WebGPU now fully supported: GPU-resident drawer, VFX Graph, probe volumes | Big builds, C# editor workflow, can't run in a Claude cloud session | No |
| Gaussian splat capture of a real course | Photoreal from a drone capture | Lighting is baked in, so no seasons or time of day; no collision; large files | Out of scope; at most a distant backdrop later |

Rule for M0: import from `three/webgpu`, write all shaders in TSL, and post-process with `RenderPipeline`. If the M3 look gate fails twice, run a two-day Babylon spike before re-planning.

## Realism recipe

Realism comes from five things in this order: light, ground materials, grass, water, atmosphere. Hero models matter less than people expect. Each layer below has a Low-tier fallback so WebGL2 machines still run.

| Layer | Technique | Low tier | Milestone |
| --- | --- | --- | --- |
| Sun and sky | Physical sun from the course latitude (about 36.4°N), date and time; sky and clouds ported from web-ocean to TSL (transmittance, multiple-scattering and sky-view LUTs, aerosol haze, a low cumulus layer and an altostratus deck with self-shadowing and footprint-filtered noise); ambient light from the sky-view LUT, with a CC0 Poly Haven HDRI only as a fallback; AgX tone mapping | Sky gradient + static HDRI | M3 |
| Shadows and GI | Cascaded shadow maps (3 cascades); GTAO, plus SSGI on High | 1 cascade, no AO | M3 |
| Ground materials | CC0 PBR sets (Poly Haven, ambientCG) for fairway, rough, green, fringe, sand, path, dirt, pine straw; stochastic tiling and a macro noise layer to hide repeats; triplanar on banks over 30° | Fewer layers, no triplanar | M3 |
| Mowing stripes | World-space stripes aligned to each hole's direction, from a stripe-angle field the pipeline writes | Same, cheap | M3 |
| Grass | GPU blade grass within \~50 m of the camera (compute placement on WebGPU, `InstancedMesh` fallback); blade height by surface; wind; the cart flattens blades and leaves tracks. Candidate look reference, not yet decided: layered-shell grass from Shadertoy 4dBcDV, saved in `docs/reference/shaders/grass-4dBcDV.md` (license to check) | Texture only | M4 |
| Trees | Loblolly pine, white oak, dogwood, redbud with 3 LODs plus impostors past \~150 m; wind sway; seasonal leaf ramps | 2 LODs | M4 |
| Water | **All water uses a TSL port of afl_ext's "Very fast procedural ocean"** ([Shadertoy MdXyzX](https://www.shadertoy.com/view/MdXyzX); decided Oct 17 2026; replaces the web-ocean LEAN/FFT plan for water). Its wave sum, normal, cheap-atmosphere reflection, sun glitter and crest scattering, scaled to pond-size waves by `envConfig.water`; ported early in `apps/web/src/env/oceanWaves.ts`, reviewed on the synthetic `review-h13` pond. M4 still adds depth-based color over the pond bed, shoreline foam, and cart ripples via a ripple render target | Flat reflective plane | M4 |
| Atmosphere | Height fog plus r186 volumetric fog for morning mist in hollows; aerial perspective on distant trees | Height fog only | M3 |
| Post | Subtle bloom, per-season color grading LUT, TAA; depth of field in photo mode only | FXAA, no LUT | M3 |
| Horizon | Low-res DEM skirt around the course to \~3 km with tree cards, so the world doesn't end at the bounding box | Same | M2 |

Audio is part of realism: positional birds by season and time, wind in pines, motor whine tied to speed, tire noise by surface.

## Course shaping: authored over measured

Real data sets the routing and the big landforms; the pipeline authors everything at golf scale. Raw lidar is noisy, OSM polygons are jagged, and real cart paths are drawn as rough lines. Copied 1:1, they drive badly and look like a survey, not a course.

&#91;embedded content: course shaping pipeline · two lanes merge into the level packet\]

Polygon cleanup feeds the terrain lane its surface masks; both lanes meet in one sculpt step, where hand overrides win.

### Terrain

1. **Normalize.** Reproject to UTM 17N, convert US survey feet to meters, resample to a 1 m grid.
2. **Clean.** Fill no-data and pits, flatten buildings and bridge decks using OSM masks, then a 3×3 median filter to remove lidar speckle.
3. **Clean the polygons first.** Round corners with a shapely buffer out then in (r ≈ 3 m), simplify, resolve overlaps by priority, and add a 1.5 m fringe ring around greens.
4. **Smooth by surface.** Each surface gets its own treatment, blended with feathered masks 6 to 10 m wide:
   - Woods and rough: Gaussian σ ≈ 1.5 m, keeps natural bumps
   - Fairway: Gaussian σ ≈ 3 m, slope capped at 15%
   - Tee: plane fit, raised 0.3 to 0.6 m with a 1:3 bank
   - Green: plane plus gentle curve fit, 5 to 15 cm of procedural undulation, slope ≤ 3%
   - Bunker: procedural bowl 0.4 to 0.8 m deep, steeper lip on the green side, flat floor
   - Water: flat surface at shoreline height, 1.5 to 2.5 m bed with a shallow wading shelf
5. **Clamp for driving.** Iteratively relax any slope over \~35%. What stays steep gets an embankment material.
6. **Override layer.** `overrides.geojson` lets you redraw or nudge any feature by hand. A Blender sculpt pass can add a height delta that the pipeline merges back (M5).

### Cart paths

1. **Source.** Use OSM cart paths (`golf=cartpath`, or `highway=path` + `golf_cart=designated`). If missing, auto-route with A\* from each green to the next tee over a cost grid: slope, trees costly, greens and water forbidden, preferring 12 to 25 m off the fairway centerline.
2. **Smooth the line.** Ramer–Douglas–Peucker simplify (ε ≈ 1.5 m), then a centripetal Catmull-Rom spline resampled every 1 m, with a 6 m minimum turn radius.
3. **Smooth the profile.** Sample heights along the spline, smooth with a 1D Gaussian (σ ≈ 8 m), cap grade at 12% and cross-slope at 2%.
4. **Carve the corridor.** Flatten 1.5 m either side of the centerline to the profile height, then blend the 3 to 4 m shoulders with smoothstep. This is the standard road-on-heightmap approach used in [Capcom's RE Engine road tools](https://docswell.com/s/CAPCOM_RandD/KNR8P2-RE2023) and [Hesiod's FlatbedCarve node](https://hesioddoc.readthedocs.io/en/latest/node_reference/nodes/FlatbedCarve/).
5. **Build the ribbon.** A concrete path mesh follows the spline 2 cm above the carved terrain, UV'd along its length. Where it crosses water, a bridge asset is placed automatically.
6. **Physics.** The carved heightfield is the collider; the ribbon is visual only. The material map marks the corridor as `cartpath` for grip and tire sound.

Every pipeline run writes a sculpt report: before/after hillshade PNGs, max slope and grade stats, and a list of what was auto-generated versus taken from OSM.

## Cart physics and rambunctious effects

The cart uses Rapier's `DynamicRayCastVehicleController` (a port of Bullet's raycast vehicle) with per-wheel grip driven by the surface under each wheel. Rapier exposes per-wheel contact and impulse data such as `wheelIsInContact` and `wheelSideImpulse`. That is enough to drive skids, spray and sound; Needle's open car-physics package uses the [same signals for skid marks](https://app.unpkg.com/@needle-tools/car-physics@1.0.0-alpha.19/files/src/CarWheel.ts).

### Surface model

Each step, every wheel samples the material map at its contact point and applies that surface's tuning.

| Surface | Grip | Rolling drag | Skid / effect |
| --- | --- | --- | --- |
| Cart path | High | Low | Black rubber marks, tire squeal |
| Fairway, fringe | Medium | Low | Torn-turf streaks, grass flattened, small divot chunks |
| Green | Medium | Low | Torn turf, and the greenkeeper meter climbs fastest |
| Rough, pine straw | Medium-low | Medium | Dust and needle puffs |
| Sand | Low | High | Roost spray, deep ruts that stay |
| Water | n/a | Drag ∝ speed² × depth | Bow spray, wake, ripples, reduced steering |
| Winter frost | −25% grip on all grass | n/a | Darker tracks through the frost |

### Effects

- **Skid marks.** Emitted per wheel when it is on the ground, speed is over 2 m/s, and side slip or brake lock passes a threshold. Drawn as a ring-buffer ribbon (4 wheels × 512 segments), 0.18 m wide, 1 cm above the ground, tinted by surface. Chill fades marks after 60 s; Joyride keeps them all session.
- **Turf damage.** Skids also paint a world-space damage texture. The terrain shader darkens and roughens those texels and the grass system flattens blades there.
- **Water.** Water is not a collider; the cart drives on the pond bed. Below the water line, drag rises with depth and speed, spray and wake are emitted, and a lens-droplet effect shows briefly. Deeper than 0.6 m, the motor stalls and the cart floats. Chill respawns it on the nearest path after 3 s; Joyride lets it bob until you reset.
- **Handbrake drift.** Holding handbrake drops rear grip to \~30% and adds light yaw damping so drifts are catchable.
- **Airtime.** Long suspension travel and soft landings; a little air steering in Joyride. Landing shake scales with impact.
- **Never stuck.** If speed stays under 0.3 m/s with throttle held for 3 s, nudge free or offer a reset.

### Tuning starting point

Use Club Car Onward specs: wheelbase 1.66 m, track 0.91 m front and 1.02 m rear, wheel radius ≈ 0.24 m, mass ≈ 300 kg. Lower the center of mass below the floor pan so Chill can't tip on normal slopes. All values live in `cartTuning.ts`, editable live through a debug panel (lil-gui), with presets per mode.

## Engagement

The loop is: drive somewhere pretty, find something to do there, get a small reward, see the course change. Every activity is optional and can be played in either mode.

| Activity | What the player does | Reward | Milestone |
| --- | --- | --- | --- |
| Hole tour | Visit all 18 tee-to-green routes; each hole lights up on the map | Course completion stamp per season | M1 |
| Photo mode | Free camera, HUD off, time-of-day and season sliders, depth of field, save PNG | 10 scenic vista spots to discover | M4 |
| Lost balls | Glinting balls hidden in rough, woods and pond edges | Count per course; ball skins | M4 |
| Beverage cart | Pick up drinks at the clubhouse, deliver to golfers; a cup-slosh meter punishes rough driving | Tips; cart paint unlocks | M4 |
| Flag time trials | Race between flags with a ghost of your best run | Medals | M4 |
| Greenkeeper's nightmare | Joyride score for skid length, airtime and turf damage, with a grumpy greenkeeper radio voice | Silly titles | M4 |
| Seasons and weather | Change season and time freely, or let a real-time clock run | Season-specific details: blossoms, leaf piles, frost | M3 |

Golfers are static or lightly animated low-poly props at first; full AI golfers are a non-goal. Progress saves locally in the browser.

## Asset pipeline: Blender and Python

Blender is driven by scripts, not hand-exported. Every asset goes through one command that checks it, builds LODs, exports GLB and optimizes it, so Claude Code can run and test the pipeline too.

### Rules

- **CC0 first.** Poly Haven (models, textures, HDRIs), ambientCG, Kenney, Quaternius. Megascans moved to Fab and is [mostly paid since 2025](https://www.unrealengine.com/blog/fab-content-marketplace-launches-in-october-publishing-portal-opens-today); keep it out of the public repo unless its license is checked.
- **Separate Python for Blender.** The `bpy` wheel for Blender 5.0 is [built for Python 3.11 only](https://pypi.org/project/bpy/5.0.0/), while the GIS pipeline uses 3.12. Keep `tools/blender` as its own uv project on 3.11, or call `blender --background --python <script>`.
- **Scatter is data, not meshes.** The pipeline writes tree, shrub and flower positions per species. The game instances them at runtime. Blender exports one mesh per species with its LODs. Blender's glTF exporter does support [`EXT_mesh_gpu_instancing`](https://www.blender.org/manual/en/addons/import_export/scene_gltf2.html), but runtime scatter keeps seasons and density tiers flexible.

### Scripts

| Script | Does | Output |
| --- | --- | --- |
| `export_asset.py` | Checks meters, origin at ground, applied transforms, naming; builds LOD1/LOD2 with Decimate (≈35% and 10%); bakes AO; exports `COL_` collision proxies | `assets/export/<name>.glb` |
| `optimize.mjs` | `gltf-transform optimize` with meshopt and KTX2 (WebP if KTX tools missing), resizes textures per budget | `assets/optimized/<name>.glb` |
| `bake_impostor.py` | Renders each tree from 8 angles into an atlas for far LOD | `<tree>_impostor.ktx2` |
| `lookdev.py` | Imports a level packet's height and material maps, places scatter, renders Cycles reference frames per season from 3 camera bookmarks | `art/lookdev/<season>_<cam>.png` |

`lookdev.py` is the key realism tool. It gives a reference image of *your actual course* that the M3 gate compares against, which is more honest than Gemini concept art. Gemini stays for mood and for the cart's design.

### Hero cart

Modeled in Blender to about 15k triangles with one 2048² texture set. Named nodes `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`, `steering_wheel`, `brake_lights`, so code can spin, steer and light them. A dirt-and-wet mask channel lets the cart get muddy and wet over a session.

## Stack, repo and level packet

### Stack

| Area | Choice |
| --- | --- |
| Web | TypeScript strict, Vite, pnpm workspaces, Node 22 |
| Render | three.js r186+ from `three/webgpu`, TSL shaders, `RenderPipeline` post |
| Physics | `@dimforge/rapier3d-compat`, pinned; fixed 60 Hz step; runs in Node for tests |
| Debug | lil-gui tuning panel, stats overlay, `?debug=1` wireframe and collider view |
| Tests | Vitest (logic and headless physics), pytest (pipeline); Playwright smoke only where a browser is available |
| GIS pipeline | Python 3.12 via uv: numpy, scipy, pillow, rasterio, rioxarray, pyproj, geopandas, shapely, scikit-image |
| Blender tools | Separate uv project on Python 3.11 (`bpy` 5.0) or Blender CLI |
| Assets | Blender → GLB → `gltf-transform` (meshopt, KTX2) |

### Repository layout

```
GolfCartSimulator/
├─ PRD.md  CLAUDE.md  README.md  ATTRIBUTION.md  LICENSE
├─ apps/web/src/
│  ├─ core/      loop, input, time, settings, save
│  ├─ level/     loadLevel, schema, heightSampler, surfaceSampler
│  ├─ terrain/   chunks, terrainMaterial (TSL), damageMap
│  ├─ physics/   world, heightfieldCollider
│  ├─ vehicle/   VehicleModel, RapierCart, cartTuning, surfaces
│  ├─ fx/        skidMarks, spray, dust, wake, ripples
│  ├─ env/       sky, sun, seasons, fog, grass, trees, water, weather
│  ├─ camera/    chase, scenic, photoMode
│  ├─ modes/     chill, joyride, tour, deliveries, trials
│  └─ audio/  ui/
├─ apps/web/public/levels/<id>/   level packets
├─ packages/level-schema/         JSON Schema + TS types
├─ pipeline/   uv, Python 3.12: dummy, dem, osm, polygons, sculpt, paths, scatter, packet, report, cli
├─ tools/blender/   uv, Python 3.11: export_asset, bake_impostor, lookdev
├─ assets/ source/ export/ optimized/ third_party/
└─ art/ concept/ lookdev/      docs/ adr/ screens/
```

### Level packet v0.2

All grids share one size, row-major, row 0 = north, 1 m cells.

| File | Format | Purpose |
| --- | --- | --- |
| `course.json` | JSON, schema-validated | Grid, height scale and offset, CRS, spawn, palette, water levels, attribution, file hashes |
| `height.u16.bin` | Uint16 LE | Sculpted heights; shared by render mesh and collider |
| `material.u8.bin` | Uint8 IDs | Surface per cell: rough, fairway, fringe, green, tee, bunker, water, cartpath, woods, embankment |
| `stripe.u8.bin` | Uint8 angle (0–255 → 0–180°) | Mowing stripe direction per cell |
| `paths.json` | Spline points, width, per-point height | Cart path ribbons and bridges |
| `scatter.bin` | Per species: x, z, scale, rotation (Float32) | Trees, shrubs, flowers |
| `holes.json` | Tee, green, pin per hole; par | Tour, flags, map |
| `horizon.u16.bin` | 10 m grid to \~3 km | Low-detail skirt beyond the course |
| `report/` | PNGs + stats JSON | Sculpt report; not shipped in builds |

## Milestones and gates

Six milestones, each ending at a hard gate. Feel comes before looks: by the end of M1 the cart is fun to drive on a gray-box course, before any real data or art exists.

**Gate protocol.** At the end of each milestone, Claude runs every check, posts the acceptance checklist with evidence (command output, screenshot paths), opens a PR from `m<N>-<slug>`, and stops. Work resumes only after you reply `APPROVED M<N>`.

### M0 — Scaffold and gray-box drive

Monorepo, `gce-dummy` synthetic packet (now with sand, water, path and woods), terrain plus Rapier heightfield, box cart in Chill mode, chase camera, keyboard and gamepad.

- [ ] Generator is byte-deterministic; pytest green
- [ ] Raycast parity: collider within 1 cm of the CPU height sampler at 200 points
- [ ] Headless drive: 20 s full throttle reaches 6.4 to 7.0 m/s, roll stays under 35°
- [ ] Surface sampler returns the right material under each wheel
- [ ] `pnpm build` passes; you confirm 60 fps locally

### M1 — Cart feel and mischief

Both modes, per-surface grip, handbrake drift, skid ribbons, basic spray and dust, water drag and float, airtime, stuck recovery, basic audio, tuning panel.

- [ ] Headless: Joyride reaches 12.5 to 14 m/s; handbrake at 10 m/s produces a yaw rate over 60°/s
- [ ] Headless: entering 0.5 m water at 10 m/s slows the cart under 4 m/s within 3 s
- [ ] Skid emitter fires only above the slip threshold
- [ ] You play 15 minutes and sign off on both modes

### M2 — First real course

Full terrain and cart-path pipeline on Caswell Pines, hole 1 first and then all 18, run on your machine, packet committed. Hole windows, green and bunker shapes are checked against the private flyover reference.

- [ ] Packet validates; sculpt report reviewed
- [ ] Greens ≤ 3% slope, cart paths ≤ 12% grade and ≤ 2% cross-slope, nothing drivable over 35%
- [ ] All M0/M1 tests pass on the real packet; cart drives the whole course and horizon edge

### M3 — Look

Sky and sun, shadows, PBR ground, mowing stripes, fog and morning mist, post, four seasons, quality tiers, `lookdev.py` reference renders.

- [ ] 3 camera bookmarks × 4 seasons, side by side with the lookdev renders; you judge the match
- [ ] High tier holds 60 fps on the MacBook; Low tier holds 45 fps on WebGL2

### M4 — Life and content

GPU grass, trees with LODs and impostors, water shader and ripples, hero cart, turf damage, photo mode, lost balls, beverage cart, time trials, greenkeeper score.

- [ ] Budgets met with full foliage on High
- [ ] Each activity playable start to finish

### M5 — Polish and more courses

Blender sculpt-delta round trip, settings menu, two more US courses through the same pipeline, public build.

- [ ] Two new courses build with no code changes
- [ ] Attribution screen and ODbL notice present

## Budgets, risks and open questions

### Quality tiers

Targets are project goals, set on your Apple Silicon MacBook at 1440p; revisit after M1 profiling.

| Tier | Renderer | Frame target | Grass radius | Shadows | Extras |
| --- | --- | --- | --- | --- | --- |
| Ultra | WebGPU | 60 fps | 80 m | 3 cascades, 2048² | SSGI, volumetric mist, SSR water |
| High | WebGPU | 60 fps | 50 m | 3 cascades | GTAO, volumetric mist |
| Medium | WebGPU | 60 fps | 30 m | 2 cascades | Height fog |
| Low | WebGL2 fallback | 45 fps | Off | 1 cascade | Flat water |

Hard caps on High: ≤ 300 draw calls, ≤ 2 M visible triangles, ≤ 768 MB GPU memory, ≤ 60 MB first download, physics ≤ 2 ms per frame.

### Non-goals

Golf swing gameplay, multiplayer, accounts, AI golfers, mobile and touch, VR, real course names or logos in builds (the course ships as Tee Time Links, a fictional name with its own logo, `art/brand/tee-time-links.svg` at the TeeTimeTurrets root; see `docs/DECISIONS.md` there, "No real club's name or logo"), runtime GIS in the browser.

### Top risks

| Risk | Mitigation |
| --- | --- |
| Realism budget blows the frame rate | Tiers from M3; grass and impostors behind settings; profile every gate |
| Rapier vehicle feels floaty or twitchy at 30 mph | Per-mode tuning presets; anti-roll and yaw damping forces; `VehicleModel` interface allows a custom arcade model |
| Smoothing makes the course look generic | Per-surface smoothing keeps natural rough; override layer; side-by-side hillshade in the sculpt report |
| Auto-routed cart paths look wrong | OSM first; A\* only for gaps; override layer to redraw |
| Skid ribbons and damage map cost too much | Ring buffer caps segments; damage map at 0.5 m texels, updated in small tiles |
| WebGPU/TSL gaps or bugs | WebGL2 Low tier is always runnable; Babylon spike if M3 fails twice |
| Cloud session can't fetch GIS data | Synthetic M0–M1; real data built locally and committed |

### Open questions for you

1. Is 30 mph the right Joyride cap, or should boost go higher?
2. Can the cart actually flip in Joyride, or only tip and self-right?
3. Keep beverage-cart deliveries in v1, or move to post-v1?
4. Can you enable Custom network access for the cloud environment (adds `overpass-api.de`, `*.usgs.gov`, `*.nationalmap.gov`)?
5. Public repo from day one, MIT license?

## CLAUDE.md and kickoff

Put this doc in the repo as `PRD.md` (export as Markdown), add the CLAUDE.md below, then paste the kickoff prompt into the new cloud session. The v2 dummy generator script still applies to M0; extend it with the new surfaces.

### CLAUDE.md

```markdown
# CLAUDE.md — GolfCartSimulator

Read PRD.md sections "Vision and modes" and the CURRENT milestone only. Don't read ahead.

## Commands
- Install: pnpm install · (cd pipeline && uv sync)
- Web: pnpm --filter web dev · pnpm -r build · pnpm -r test · pnpm -r typecheck · pnpm -r lint
- Pipeline: (cd pipeline && uv run gce-dummy --out ../apps/web/public/levels/dummy-01) · uv run pytest -q · uv run ruff check .
- Blender tools (local only): (cd tools/blender && uv run python export_asset.py <file.blend>)

## Conventions
- three.js from three/webgpu; shaders in TSL only (no ShaderMaterial, no onBeforeCompile); post via RenderPipeline.
- Vanilla TS, no React in the game loop. Physics must run in Node (Vitest).
- Rapier: @dimforge/rapier3d-compat, pinned. Fixed 60 Hz step. Heightfield is column-major (see heightfieldCollider.ts).
- Meters, +Y up, north = -Z. Heights only from the level packet.
- Every tunable number lives in a config file (cartTuning.ts, surfaces.ts, tiers.ts), never inline.
- No runtime fetches to third-party hosts. No symlinks. LF endings.

## Verification
- Paste the exact command and summary line for every test run. "Should work" is not evidence.
- Visual work: screenshots to docs/screens/m<N>/ when a browser is available; otherwise say so.

## Gates
- Branch m<N>-<slug>. At milestone end: checklist with evidence → PR → STOP.
- Do not start M<N+1> until John writes "APPROVED M<N>".
- Blocked by network? Stop and name the domain. Don't work around it.
```

### Kickoff prompt

```markdown
Read CLAUDE.md and PRD.md (Vision and modes; Stack, repo and level packet; M0).
Enter plan mode and propose the M0 plan only: files to create, test list, and any PRD ambiguity you see.
Wait for my approval before writing code.
```

## Sources

This builds on the v2 research report from earlier in this conversation (elevation data, heightmap format, OSM tagging, licensing, Claude Code cloud limits). New sources for v2.5 and v2.6:

- [web-ocean: WebGPU ocean, sky and clouds (MIT)](https://github.com/Noniv/web-ocean)
- [afl_ext, Very fast procedural ocean (Shadertoy MdXyzX)](https://www.shadertoy.com/view/MdXyzX): the water look for all water

- [three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer)
- [three.js r186 release summary (CGWORLD)](https://cgworld.jp/flashnews/01-202610-Threejs-r186.html)
- [three.js r184 release notes](https://github.com/mrdoob/three.js/releases)
- [Native Gaussian splat renderer in three.js r186](https://radiancefields.com/three.js-ships-its-native-gaussian-splat-renderer-and-splat-raycasting-in-r186)
- [Announcing Babylon.js 9.0](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0)
- [Babylon.js 9.26.1 release](https://gamedev.net/news/5769/)
- [PlayCanvas v2.17 splatting](https://app.cinevva.com/news/2026-03-06-playcanvas-v217-webgpu-splatting)
- [Unity 6.6 WebGPU out of experimental](https://app.cinevva.com/news/2026-09-01-unity-6-6-webgpu-production)
- [Rapier vehicle controller guide](https://rapier.rs/docs/user_guides/python/vehicle_controller)
- [Rapier JS vehicle controller typings](https://app.unpkg.com/@dimforge/rapier3d@0.18.0/files/control/ray_cast_vehicle_controller.d.ts)
- [Needle car-physics wheel (skid signals)](https://app.unpkg.com/@needle-tools/car-physics@1.0.0-alpha.19/files/src/CarWheel.ts)
- [False Earth: WebGPU grass in three.js (Codrops)](https://tympanus.net/codrops/2026/04/21/false-earth-from-webgl-limits-to-a-webgpu-driven-world/)
- [Capcom RE Engine road and terrain tools](https://docswell.com/s/CAPCOM_RandD/KNR8P2-RE2023)
- [Hesiod FlatbedCarve node](https://hesioddoc.readthedocs.io/en/latest/node_reference/nodes/FlatbedCarve/)
- [three.js forum: road following a spline in terrain](https://discourse.threejs.org/t/how-to-add-road-following-spline-in-terrain/50365)
- [bpy 5.0 on PyPI](https://pypi.org/project/bpy/5.0.0/)
- [Blender glTF add-on manual](https://www.blender.org/manual/en/addons/import_export/scene_gltf2.html)
- [Fab marketplace and Megascans pricing](https://www.unrealengine.com/blog/fab-content-marketplace-launches-in-october-publishing-portal-opens-today)

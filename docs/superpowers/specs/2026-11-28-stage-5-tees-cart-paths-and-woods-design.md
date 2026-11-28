# Stage 5 remainder: tee boxes, cart paths and the woods

Written 2026-11-28. The spec for what is left of Stage 5 (`docs/REVAMP-PLAN.md`, "Stage 5:
environment") after the Caswell look absorbed the splat, the water and the grass carpet. It settles
what `docs/SPEC-QUEUE.md` item 3 lists as missing. The user asked for the spec and the build in one
go, so every question in §8 is built to its default, and the play-test is where a default gets
overturned.

What Stage 5 still asked for, and where each item lands:

| Plan item | Here |
|---|---|
| `SurfaceId.Tee` (raised mown tee boxes) | §2, slice 1 |
| `sim/cartPaths.ts`: clubhouse to tees, green to next tee, a speed bonus, shaded | §3, slice 2 |
| Trees past about 250 m as cross-quad impostors; the 12 outer holes at lower tree LOD | §4.1, slice 3 |
| Sight-line dither: trees between camera and cart fade | §4.2, slice 3 |
| A distant horizon ring of tree silhouettes | Already built (`render/horizon.ts`, 3.5b). Nothing to do. |
| A golden-hour title backdrop, then delete `render/ground.ts` | §5, slice 4: the title became Clubhouse Sunset (SVG, 25 Nov), so the 3D backdrop is dead code and goes, with `ground.ts`. |
| Accept: a `course-dressing` gate subject | Superseded by the testing policy (one smoke check per slice). |

---

## 1. What exists today

Read from `main` at `9fb3c91`.

- **Surfaces.** `SurfaceId` (`src/sim/surfaceId.ts`) is green, fairway, rough, sand, water and
  bridge. A hole classifies a point in its own frame (`surfaces.ts`, priority green, bridge, water,
  sand, corridor). The course blends eighteen holes (`courseSurfaces.ts`), and the sim reads only
  the baked 2 m grids (`courseGrids.ts`): class nearest-vertex, tuning bilinear. `SURFACE_CODES`
  stores a class as a byte and is append-only.
- **Mobility.** One number per surface, its resistance (`mobility.ts`). A cart's speed is
  `1 / resistance`, after the tyre's `offRoadPenalty` scales the excess over 1. Climb and grip
  derive from the same number.
- **Tees.** Each hole flattens a 5 m pad round its tee (`terrain.ts`), and the tee is fairway. Carts
  spawn at the clubhouse, not on tees, on the shipped course.
- **The corridor is a terrace.** A hole's corridor is carved flat across, and the rough beyond its
  blend often rises or falls at 0.2–0.27 (11–15°) for 10–20 m (measured across hole 1). A path laid
  "in the rough" either sits on that bank or 30 m out past it.
- **Woods.** `woodsPlacement.ts` plants clumps in deep rough over the whole course. `Trees.ts`
  instances each biome's two species. There is no LOD and no fade.

## 2. Tee boxes (slice 1)

- **Shape.** A rectangle centred on the hole's tee, its long axis along the hole's first control
  leg: **10 m by 7 m** (`TEE_BOX_HALF_LENGTH_M = 5`, `TEE_BOX_HALF_WIDTH_M = 3.5`), in a new
  `src/sim/teeBox.ts` that both `terrain.ts` and `surfaces.ts` read (one shape, two consumers).
- **Raised.** **0.25 m** above the flattened pad, falling to the pad over a **2 m** smoothstep
  bevel. The steepest point of the bevel is a 0.19 grade, which every tyre climbs. The raise is a
  built structure, like the causeway, so it follows `TerrainSources.crossings`: `generateHole`
  validates the hole without it, and routing cannot move (spec D9).
- **Class.** `SurfaceId.Tee`, appended to `SURFACE_CODES`. Priority: after the green, before
  everything else (validation already keeps tees out of water).
- **Tuning.** Ball: rolling **0.09**, bounce **0.75** (a little firmer than fairway). Cart:
  resistance **1.0**, the fairway's.
- **Drawn.** As mown turf. `weightsAt` reports a tee box's green weight as 0 inside it, rising to 1
  over a 2 m edge, so the ground shader draws a putting-surface tone with its collar, and grass
  tufts and trees keep off it. The minimap gets a tee colour.

## 3. Cart paths (slice 2)

### 3.1 Where they run (Q1, Q2)

Derived once per course from the baked grids, not authored. `planCartPaths` in a new
`src/sim/cartPaths.ts`:

- **The legs** are a real course's loop. The clubhouse runs to the 1st and 10th tees. Each hole has
  a path from tee to green. Each green runs to the next tee, except the 9th and 18th, which run back
  to the clubhouse. That makes **38 legs** on the shipped course. The plan said "the clubhouse to
  each tee". Eighteen spokes would cross every fairway near the clubhouse, and the loop reaches all
  six arena tees anyway.
- **The search.** Dijkstra over **4 m cells**, 8-connected, from every cell near the leg's start to
  the first cell near its end:
  - "near the tee" is 14 m;
  - "near the green" is the green's radius plus 10 m;
  - "near the clubhouse" is 16 m round a point 42 m in front of it.
- **Prices per cell:**

  | Cell | Price |
  |---|---|
  | Fairway or rough beside the other (the band where one grades into the other, the terrace's outer edge) | 1 |
  | Full rough | 1.8 |
  | Fairway | 10 |
  | Already paved | 0.35, so later legs join earlier ones instead of running beside them |
  | Every cell | plus 40 × grade² |
  | Beside a refused cell | plus 3, so the smoothed path keeps its width off it |

  **Refused:** green, tee, sand, water, bridge, steeper than **0.21** (12°), within 10 m of the road,
  or within 4 m of a clubhouse building.
- **Determinism.** Ties go to the lower cell index, and nothing but the ground is read. The same
  course gives the same paths everywhere.
- **Smoothing.** Every other cell is kept, then two rounds of corner cutting.
- **Cost.** Measured at about 0.5 s, once per page, in the grid bake. Total length about 10 km.

### 3.2 What they do (Q3, Q4)

- **Class.** `SurfaceId.Path`, appended to `SURFACE_CODES`. `stampCartPaths` paints it into the
  baked grids. Every vertex within **2 m** of a path (a 4 m paved width) that was fairway or rough
  becomes path, with the path's tuning. The sim reads only the grids, so that is the whole sim
  change. The exact blended `CourseSurfaces` stays path-free; it is the input the planner reads.
- **Speed.** Resistance **0.85**, so a street-tyre cart runs **1.18×** its fairway speed. The tyre
  rule applies as for every surface, because `offRoadPenalty` scales the difference from 1 either
  way:

  | Tyre | `offRoadPenalty` | Speed on a path |
  |---|---|---|
  | Knobby | 0.4 | 1.06× |
  | Turf | 1.25 | 1.23× |

  Fast tyres like pavement, and that is the trade the tyre shop already sells. Grip on a path comes
  out higher than on a fairway, so the climb limit is too. Paths are gentle by construction anyway.
- **Ball.** Rolling **0.04**, bounce **0.85**: a ball that lands on a path runs and hops, like the
  bridge.
- **Hazard.** None. A path never overwrites water, sand, green, tee or bridge.

### 3.3 How they are drawn

- **A strip, not the splat.** A ribbon mesh along each polyline, `render/cartPaths.ts`:
  - 4 m wide, sampled every 2 m;
  - lifted 4 cm, with a polygon offset;
  - one draw;
  - pale concrete, a darker kerb line at each edge.

  The plan said "shaded in the splat". The ground mask's four channels are all in use, and a strip
  costs one draw and no shader change.
- **Everything else keeps off it.** The renderer's `Surfaces` is wrapped
  (`withCartPaths(surfaces, mask)`) so `surfaceAt` answers `Path` on the paved strip. Woods
  placement and grass tufts already plant only on rough, so they leave the paths clear with no
  change of their own. A 2 m raster of the paths answers the wrapper.
- **The M map** draws the paths as thin pale lines, and colours tee and path.
- **Dust.** A small grey puff behind a cart on a path (`effects.ts` `ROOST`).

### 3.4 Bots

Unchanged. They still steer at targets. Stage 6's navGraph prices cart paths cheaper
(`REVAMP-PLAN.md`), and that is where bots learn to use them.

## 4. The woods (slice 3)

### 4.1 Far trees (Q5)

- Trees **outside the zone by more than 60 m**, which covers the 12 outer holes and the far side of
  the course, use a **low-poly stand-in** of their species:
  - the same unit-height graph, rebuilt at the authored segment counts (7-segment cones, 6×4
    spheres) instead of the smoothed minimum;
  - about a third of the triangles.
- They are separate InstancedMeshes, a static split built once. A per-frame distance switch would
  rebuild instance buffers every frame.
- The plan asked for cross-quad impostors past 250 m. A crossed quad needs a baked alpha texture
  per species, and nothing here bakes textures yet. A stand-in gives most of the saving with no new
  pipeline. Impostors stay possible later.
- Record the instance and triangle counts in the PR.

### 4.2 Sight-line dither (Q6)

- A tree whose trunk lies inside a **capsule from the camera to the player's cart** fades out with
  a screen-door dither:
  - capsule radius **3 m**, fading over the next 2 m;
  - not within 4 m of the cart, so the cart's own cover still reads as cover.
- It runs in the trees' vertex shader. It reads the instance's position and two uniforms (camera,
  cart), set once a frame by the match scene. Allocation-free.
- Render-only. Line of sight in the sim is unchanged: trees never blocked it.

## 5. The dead title backdrop (slice 4)

`render/backdrop.ts` (the one-hole golden-hour scene) is imported by nothing but its own test, since
the title became Clubhouse Sunset on 25 Nov. It goes, and with it `render/ground.ts` and anything
only they reach. That includes `Trees.ts`' one-hole `createTrees`, if nothing else uses it. The plan
asked for a golden-hour backdrop; the SVG title is that now.

## 6. The golden

Slices 1 and 2 move it: the raised tee boxes change heights, and the paths change speeds on ground
the bots drive. It is re-recorded **once, at the end of slice 2**, from Linux x64, in one commit
that says why. Slice 1 leaves the golden test red until then, inside the one PR (§7).

## 7. Slices

All four go in one PR, as Stage 4b did, at the user's direction ("write the spec and then
implement"). Each has one smoke check of 15 s or less, and the play-test list covers all four.

1. **Tee boxes.** `teeBox.ts`, `SurfaceId.Tee`, the raise, tuning, the mask's green weight, the map
   colour. Smoke check: `src/sim/teeBox.test.ts`. A tee box classifies as `Tee`, stands
   0.25 m above the pad, and a point 3 m outside it is untouched. It must fail if the raise or the
   class is removed.
2. **Cart paths.**
   - `cartPaths.ts`: the planner, the stamp, the mask and the wrapper. `CourseWorld.cartPaths`.
     `ArenaSource.cartPaths`.
   - Render: the strip, the map lines, the dust.
   - Re-record the golden.
   - Smoke check: `src/sim/cartPaths.test.ts`, on the shipped course:
     - 38 legs;
     - no path point within 2 m of water, sand, a green or a tee;
     - every arena tee has a path within 20 m;
     - the stamped grids read `Path` on a path and give a street-tyre cart 1.18× its fairway speed.

     It reuses one `CourseWorld` and finishes in about 10 s.
3. **The woods.** The far-tree stand-ins and the dither. Smoke check: `src/render/woodsLod.test.ts`.
   The split puts every tree near the zone in the full set and the far ones in the stand-in set, and
   a stand-in has fewer triangles than its species.
4. **Clean-up.** Delete the backdrop and `ground.ts`. Check: `tsc --noEmit` and the existing suite.

## 8. Questions, built to their defaults

| # | Question | Default (built) |
|---|---|---|
| Q1 | Path legs: the real loop, or spokes from the clubhouse to every tee? | The loop (§3.1) |
| Q2 | Derived at load, or authored data? | Derived, about 0.5 s once per page |
| Q3 | The speed bonus | Resistance 0.85: 1.18× on street tyres |
| Q4 | Do tyres change the bonus? | Yes, by the existing `offRoadPenalty` rule |
| Q5 | Far trees: stand-in geometry, or textured impostors? | Stand-ins now |
| Q6 | Fade trees between camera and cart? | Yes, a 3 m capsule |
| Q7 | Tee boxes raised, and how much? | 0.25 m, 10 × 7 m |
| Q8 | Delete the 3D title backdrop? | Yes; the SVG title replaced it |

## 9. Not in this spec

- Bots using paths (Stage 6).
- The water-drawn-versus-water-ruled question (`SPEC-QUEUE.md`, "Found while building 3.5b").
- Surveyed Caswell terrain and its real cart paths (`SPEC-QUEUE.md` item 5).
- Sand drift, Kenney sprites and ambient life (3.5b leftovers).

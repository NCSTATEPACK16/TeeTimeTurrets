# Course kit (export only)

**Route:** primitive-graph set → `src/entities/graphs/course_kit.json`, authored in collection `course_kit`.

**Why export only:** these assets need data that doesn't exist yet: the arena zone (#52), `SurfaceId.Tee` (#58), cart-path polylines (#59) and water planes (#55). This stage builds and verifies the graphs. When they're done, it **comments on each owning issue** with the graph names, the origin conventions, and a one-line placement hint, so those issues can place them without re-deriving anything.

## Items

| Graph | Build | Origin and tiling | Slots | Owner |
|---|---|---|---|---|
| `zone_stake` | White OB-style stake: a 1.0 m square post of 0.07 m, a `prism` point on top, a black top band, and a torus rope eye at 0.8 m | ground contact. The rope is drawn by #52 as thin cylinders or lines between the eyes (eye height 0.8 m) | `stake_white`, `stake_band` | #52 |
| `tee_riser` | A 2.0 m railway-sleeper module (0.2 × 0.25) for the raised tee's face | ground contact; tiled along the tee-box edge with `mergeGraphInstances`, the way the boardwalk is | `prop_timber_dark` | #58 |
| `path_kerb` | A 2.0 m concrete kerb module, 0.15 wide and 0.12 high, with a chamfered top (`prism` profile) | ground contact at its inner edge; tiled along both sides of a path | `kerb_concrete` | #59 |
| `path_bollard` | A 0.9 m timber bollard with a reflective white band | ground contact; placed at path ends and crossings | `prop_timber`, `stake_white` | #59 |
| `reed_clump` | 6–8 thin cones, 0.6–1.4 m, in two tones. Smaller than the marsh tree species | ground contact; scattered along pond edges | `reed_green`, `reed_tan` | #55 |
| `rock_a`, `rock_b`, `rock_c` | Low-poly boulders, 0.4–1.2 m. Each is 2–3 overlapping `prism`s or rotated boxes (X only, or a single axis) so the silhouette is irregular | ground contact, sunk 10 % | `rock` (overridden per biome) | #55 |

### Default colours

| Slot | Colour |
|---|---|
| `stake_white` | `0xF4F4EE` |
| `stake_band` | `0x1A1A1A` |
| `kerb_concrete` | `0xB9B6AE` |
| `reed_green` | `0x6F8A3A` |
| `reed_tan` | `0xB59B5C` |
| `rock` | `0x8A8578` |
| `prop_timber` | `0x9A6B40` (same as `props.json`) |
| `prop_timber_dark` | `0x5E3F24` (same as `props.json`) |

## Smoke check

`src/entities/courseKitGraphs.test.ts`:
- every graph builds within budget
- `zone_stake` height is 1.0 ± 0.05, with its rope eye at 0.8 ± 0.05
- `tee_riser` and `path_kerb` are exactly 2.0 m long along z, within 0.01, so tiling doesn't gap

## Hand-off

Post one comment per owning issue (#52, #55, #58, #59) that lists:
- the graph name(s)
- the origin and tiling conventions
- the smoke test that covers them

## As built
- **`pond_reeds`, not `reed_clump`.** The marsh tree species from `trees.md` already owns the name `reed_clump` (and Blender object names are unique), so the pond-edge clump is `pond_reeds`: 7 cones, 0.6–1.4 m, in `reed_green` and `reed_tan`.
- **Rocks are prisms turned about Y only.** Each is two or three irregular outlines extruded through 0.4–1.05 m, overlapping into one boulder, and dropped by 10 % of its height.
- **Budget:** 150 triangles per graph. The stake is the largest at 112.

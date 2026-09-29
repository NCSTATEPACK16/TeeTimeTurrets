# Pickups: items, glow pillar, shield plates, depot and scatter

**Gameplay authority:** `docs/superpowers/specs/2026-09-12-stage-d-pickups-design.md` (the "Stage D spec"). Every number and rule there stands unless this file overrides it. Read its Implementation Decisions before coding.
**Overrides decided 2026-09-28:**
1. There is a **depot ring of 6** at the clubhouse (2 of each type) **in addition to** the blue-noise scatter.
2. The scatter takes an optional **`zone`** polygon, so that Stage 4's six-hole zone can narrow it later.
3. All three types ship in this stage. The Stage D spec deferred the drink/shield to a second slice; that deferral is dropped.

## Items (Blender)

- **Route:** primitive-graph set → `src/entities/graphs/pickups.json`. The set holds `bucket`, `hot_dog` and `drink`.
- **Source:** `art/clubhouse-exterior.blend`, collection `pickups`.
- **Sheets:** `docs/concept/reference/pickup-items-01.jpg`, the closest match to the game's style of any sheet, and `pickup-pedestal-01.jpg` for the in-pillar size.
- **Every item:**
  - **0.80 m tall**, the in-pillar size from the pedestal sheet, not the 1.00 m scale bar on the items sheet.
  - Origin at the item's **centre**, since items float and spin.
  - **150 triangles or fewer.**

| Item | Better design versus the sheet | Parts |
|---|---|---|
| `bucket` (ammo) | Keep the tapered green pail. Make the handle **one torus arc** (half torus, or a thin torus rotated) instead of a wire. Reduce the ball heap to **7 low-poly spheres** (6 segments × 4 rings) in a dome | tapered cylinder (10 segments), rim torus, handle, 7 balls |
| `hot_dog` (heal) | **Drop the foil wrap.** It is a crumpled mesh that primitives can't express, and it hides the silhouette. The mustard zig-zag becomes 3 short thin boxes at alternating yaw | bun: 2 capsules side by side; sausage: 1 capsule, longer and proud of the bun at both ends; mustard ×3 |
| `drink` (shield) | Keep the tapered cup, dome lid and bent straw. Stripe the cup with one lighter band, a cylinder 1.02× the radius | tapered cylinder, lid rim torus, dome (hemisphere sphere), straw 2 cylinders |

- **Slots:** `pickup_shell`, `pickup_fill`, `pickup_accent` and `pickup_metal`, the names `ASSET_PIPELINE.md` already reserves. The colours come from overrides per item at merge time:

  | Item | shell | fill | accent |
  |---|---|---|---|
  | bucket | `0x2E9E4A` | ball white `0xF4F4EE` | `0xB8BCC0` |
  | hot_dog | bun `0xE0A050` | sausage `0xB0452A` | mustard `0xF2C230` |
  | drink | cup `0x2F7BE0` | lid `0xCFE6F5` | straw `0xF2C230` |

  The drink cup is blue, which matches team-0 blue. It is used anyway because it is a single-player friendly colour and the item is always inside a gold pillar, so it can't be confused with a cart. If a play-tester confuses it, change it to cyan `0x2EC4D0`.
- **Render:** one `InstancedMesh` per type over a `mergeGraph` geometry, so 3 draws. Items spin (yaw 1.2 rad/s) and bob (±0.08 m at 0.8 Hz) around y = 1.3 m above the ground.

## Glow pillar and shield plates (TypeScript VFX, not Blender)

- **Pillar:**
  - An open `CylinderGeometry` with radius **1.5** and height 2.6, 12 segments, additive, gold `0xFFC24A`, with opacity ramping from 0.45 at the base to 0 at the top. One `InstancedMesh` holds every site: 1 draw.
  - **Grab radius is 3.0 m,** wider than the 1.5 m visual. The Stage D spec explains why this is deliberate.
  - **States,** as on the pedestal sheet:
    - **charged:** the full pillar with the item inside it.
    - **taken:** a 0.3 s shatter burst reusing `EffectsLayer` shards; the item's instance is hidden.
    - **recharging:** the pillar drops to 25% opacity with no item.

    The pillar never disappears. That is Stage D's "the cylinder outlives the item" rule.
- **Shield plates:** 2 thin curved boxes (or `prism` arcs) orbiting a shielded cart at hull height, in drink blue. One plate shatters per absorbed hit or per 10 s decay, as the Stage D spec specifies. Plates are rendered per cart, and hidden when the cart's shield is 0.

## Placement

- **Depot ring:** 6 sites on a circle of radius 6 m around the food cart at (C.x, C.z + 16), at 60° spacing, in the order bucket, hot_dog, drink, bucket, hot_dog, drink, starting from +x.
  - A site that fails the drivability predicate rotates by +10° steps, up to 3 times, before it is dropped.
  - Log any dropped site in the PR.
- **Scatter:** the Stage D variable-radius blue noise over drivable ground. There are about 50 sites, dense near the cups and the clubhouse apron. **Exclude a 20 m radius around the depot centre** so the scatter doesn't crowd the ring.
  - Signature: `placePickupSites(world, seed, zone?: readonly Vec2[])`. With `zone` given, candidates outside the polygon are rejected. Stage 4 passes the polygon in later.
- **Types across the scatter:** a seeded round-robin, so the three counts differ by at most one.

## Sim (see `sim-slices.md` §Pickups)

- `src/sim/pickups.ts` replaces `src/sim/entities/Pickup.ts`'s single bucket.
- **Effects:**
  - bucket → ammo refill, as today
  - hot dog → `heal(health, 3)`
  - drink → shield = 2 plates
- **Cooldown:** each site's cooldown is global to the site: `readyAt` is set to `now + 60 s`.

## Smoke checks (15 s or less each)

- **Art slice:** `src/entities/pickupGraph.test.ts` checks that the set parses, that each item is 150 triangles or fewer, and that each item's height is 0.80 within 0.05.
- **Sim slice:** listed in `sim-slices.md`.

## Acceptance

- The three items can be told apart by silhouette alone from chase-cam distance.
- Pillars read as landmarks across a fairway.

A human play-tester judges both.

## As built (28 Sep 2026)

- **Budget:** each item is at most **200** triangles, not 150. The bucket is 196, the hot dog 144 and the drink 128.
- **Size check:** the "0.80 m" applies to the *largest* dimension. The hot dog is authored standing up and the renderer tilts it 70°.
- **Drink cup:** ships **cyan `0x2EC4D0`**, not blue, so it can't be read as team-0 blue.
- **Scatter exclusion:** it keeps **45 m** clear of the clubhouse centre (`COMPLEX_CLEAR_M`), which covers the barns, the lot and the depot, rather than 20 m around the depot.
- **Code:** `placePickupSites` lives in `src/sim/pickupSites.ts`. `courseSiteGround(world)` treats ground as drivable when it is not water and is at least 5 m north of the road.

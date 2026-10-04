# Horizon hills

**Route:** primitive-graph set → `src/entities/graphs/horizon.json` holding `hill_a`, `hill_b` and `hill_c`, authored in collection `horizon`.
**Purpose:** it closes the view past the course bounds, so the fog meets a skyline and not a flat plane. It complements #60's ring of tree silhouettes; it doesn't replace it.

## Cards

Each card is a single **`prism`**: a ridge-line polygon in local XY, extruded 12 m along z, with its origin at the base centre.
- **`hill_a`:** a long low ridge, 220 × 35 m, with 6–8 ridge vertices.
- **`hill_b`:** a rounded double hump, 180 × 55 m.
- **`hill_c`:** a flat-topped mesa-like shape, 260 × 28 m.

Each card uses one slot, `hill`. Its colour is overridden at runtime: a blend 70 % toward the parkland `sky` from `foliageDark`, so the ring sits in the haze. Each card is 60 triangles or fewer.

## Placement (in this stage): new `src/render/horizon.ts`

- **Ring:** 16 instances evenly spaced on a circle around the course-bounds centre.
  - Radius: half the bounds diagonal plus 180 m.
  - Each card faces the centre, and the card type cycles a, b, c.
  - Deterministic yaw jitter of ±8° and scale jitter of 0.8–1.3 come from a `mulberry32` stream seeded by `arena.seed`.
- **Height:** the base sits at the lowest `heightAt` sample along the course bounds, minus 5 m, so no card floats.
- **Draws:** one draw via `mergeGraphInstances`. It never casts or receives shadows, and `frustumCulled = false`.
- **Camera:** check that the far plane (`fieldSize * 2.5`) still reaches the ring. If it doesn't, pull the ring in rather than pushing the far plane.

## Smoke check

`src/render/horizon.test.ts` checks:
- the pure placement function returns 16 cards
- every card is outside the course bounds
- consecutive cards overlap or touch, so the skyline has no gaps
- each card has 60 triangles or fewer

## Acceptance

A play-tester looking across the course sees hills, not fog meeting grass.

## As built
- **Card count follows the radius.** Sixteen cards leave gaps of hundreds of metres on the shipped course, so `placeHorizon` takes as many as the narrowest card needs (at its smallest scale and full yaw jitter) to reach both neighbours, and never fewer than 16.
- **Haze toward the sky's horizon.** Stage 3b replaced the flat `BIOMES.parkland.sky` background with a gradient dome whose horizon is the fog colour (`render/sky.ts`). The cards blend 70 % from `foliageDark` toward `PARKLAND_SKY.horizon`, so they sit in the same haze as the far terrain.

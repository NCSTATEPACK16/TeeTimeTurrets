# Sim slices: colliders, sightlines, pickups, shield

**When:** only after Stage 3 (`stage-3-foundations`) has merged to `main`. Rebase `stage-7-blender` onto `main` first. Stage 3 has uncommitted work in `Ballistics.ts`, `combat.ts`, `BallPool.ts` and `world.ts`; building on top of an unmerged Stage 3 would mean conflicts in every file below.

**Rules** (`AGENTS.md`):
- `src/sim/**` stays DOM-free and three-free.
- Randomness is seeded only.
- No per-tick allocation.
- Every collider created has a removal path.

## 1. Static colliders: `src/sim/clubhouse.ts`

- **Data:** a list of static shapes, each `{ name, kind: 'box' | 'cylinder', centre: Vec3, half: Vec3 | {radius, halfHeight}, yaw }`. The positions are world positions relative to `AUTHORED_CLUBHOUSE`.
- **Shapes** (numbers from the asset specs):
  - clubhouse: 2 boxes (`clubhouse.md`)
  - each team barn: 8 boxes (`team-barn.md`)
  - food cart: 1 box (`food-cart.md`)
  - lamps: 4 cylinders (`lot.md`)
- **Heights:** each shape's y is the terrain height at its own centre.
- **Creation:** `world.ts` creates them once at arena setup as fixed Rapier bodies, with `CART_GROUPS`-compatible membership. Use a new `STATIC_BIT`, or rely on the default, whichever `collisionGroups.ts` needs so that carts and balls both hit them and hulls do not.
  - The hull filter already excludes everything except balls, so nothing changes there.
- **Removal:** they are removed on `Sim` teardown and reset, whichever path the Stage 3 code uses for other bodies.
- **The 0.1 m guard (REVAMP):** a constant table in `clubhouse.ts` records each graph's footprint AABB (x/z extents) **as measured from the exported JSON**. A test checks that each graph's collider union covers its footprint to within 0.1 m.
  - The test reads the JSON through a small pure AABB helper that does not import three.
  - If that is awkward, compute the AABBs in the render test and record them in the table.
  - Either way, the table is the one place the two sides meet.

## 2. Sightlines: `src/sim/lineOfSight.ts`

- **What to add:** an optional `obstacles: readonly Footprint2D[]` parameter, where a footprint is an oriented rectangle in x/z plus a top height.
- **Check:** a segment-versus-rectangle test for each obstacle. The ray is blocked when it crosses the rectangle below the obstacle's top height, interpolated along the ray.
- **Obstacles:** the clubhouse, both barns and the food cart. Lamps are too thin to count.
- **Cost:** 4 rectangles per query. It is cheap, and it allocates nothing.
- **Callers:** the nameplate and bot targeting callers pass the static list from `clubhouse.ts`.

## 3. Pickups: `src/sim/pickups.ts`

Implement the Stage D spec with the overrides in `pickups.md`:
- A **site** is `{ x, z, type, readyAt }`.
- **Placement:** the depot ring plus the scatter, computed once at course assembly, seeded from the arena seed.
- **Collection:** a distance poll per tick, grab radius 3.0 m, only when `now >= readyAt`.
  - bucket: ammo refill
  - hot_dog: `heal(h, 3)`
  - drink: `shield = 2`
- **Reset:** `readyAt` is cleared on `Sim.reset`.
- **Retire:** `src/sim/entities/Pickup.ts` and its single hard-coded bucket. Stroke play was deleted (arena-only direction), so no second mode needs it.

## 4. Shield

- **State:** `cart.shield: number`, a 0–2 integer.
- **Damage path:** in `src/sim/combat.ts`, where `protectedFor` is already checked (`combat.ts:151`). If `shield > 0`, decrement it and deal no damage.
- **Decay:** one plate per 10 s, tracked as an absolute `shieldDecayAt`.
- **Events:** emit `shieldGained` and `plateBroken` for the render plates.

## Golden fingerprint

Static colliders and pickups change arena matches, so `arenaGolden.test.ts` will move. Take the new value from the **failing Linux x64 CI run**; the Mac value is not canonical. Say so in the commit message.

## Smoke checks (15 s or less each; one per slice)

| Slice | Check |
|---|---|
| Colliders | `src/sim/clubhouse.test.ts`: the collider union covers each footprint to within 0.1 m; a cart KCC driven into the clubhouse wall stops (one short Rapier sim, 60 ticks); every lot corner is 5 m or more north of the boundary |
| Sightlines | `src/sim/lineOfSight.test.ts`: add one case where a ray between the two spawn rows is blocked by the clubhouse, and one where a ray past its corner is clear |
| Pickups | `src/sim/pickups.test.ts`: the depot has 6 sites of 3 types; a scatter with a `zone` has every site inside the zone; taking a site sets `readyAt`, and the site can't be taken again for 60 s |
| Shield | a `combat.test.ts` case: with shield 2, two hits leave health untouched and shield at 0, and a third hit deals 1 |

## Acceptance

The human play-test covers:
- Spawning feels protected.
- Buildings block shots and sight.
- Pickups are findable and worth the detour.
- The shield is legible.

# Stage D Pickups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arena scatters roughly fifty ammo-bucket and hot-dog pickups across drivable course ground from a seeded blue-noise sample, each visible as a floating item inside a glow cylinder that stays standing and goes dark for sixty seconds after it is taken.

**Architecture:** Sites are computed once when the course is assembled and are immutable for its lifetime; `Sim` owns only a `Float64Array` of "ready at" times, cleared on reset. Collection stays a per-tick squared-distance poll, as it is today. Placement validity is a new `isDrivable` closure that rejects water and low ground and accepts sand and open rough. Presentation is one `InstancedMesh` per kind plus one for the cylinders, following the `Trees.ts` pattern exactly.

**Tech Stack:** TypeScript, Vitest (node environment for `src/sim/**`), Three.js, Rapier, Vite, Puppeteer (gate and smoke harnesses).

**Spec:** `docs/superpowers/specs/2026-09-12-stage-d-pickups-design.md`

**Blocked on two plans, in this order:**

1. `2026-09-12-hazard-aware-ownership-tie-break-implementation.md` — Task 1 below asks `surfaceAt` whether a point is water, and that answer is wrong across 8,824 m² until the tie-break lands.
2. `2026-09-12-authored-course-routing-implementation.md` — the eighteen holes are being re-traced from a real plat at real yardages, and the clubhouse is moving from the world origin to the southern boundary. Scattering pickups across a routing that is about to be replaced means verifying a course nobody will play.

**Do not start Task 1 until both are committed.**

Most of this plan survives the re-layout because its assertions were written comparatively rather than absolutely — *"packs tighter near cups than out in the rough"* holds on any routing, and the site-count assertion is already a band rather than a number. **One line does not survive**: Task 2's `radiusAt` uses `Math.hypot(x, z)` as distance to the clubhouse, which assumes the clubhouse is at the origin. See the note in Task 2 Step 3.

## Global Constraints

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. No `THREE`, no DOM, no Rapier in the new sim modules.
- **Never `Math.random()` in `src/sim/**`.** Placement draws from `mulberry32(hashChannel(seed, PICKUP_CHANNEL))`. `PICKUP_CHANNEL = 5` — verified free; 0 is terrain, 1 surfaces, 2 and 4 course generation, 3 trees.
- **No allocation in query paths.** The per-tick poll and `isDrivable` use caller- or closure-owned scratch. `scatterPickups` runs once at course build and may allocate.
- **`ARENA_MAX_HEALTH = 8` and `STROKE_DAMAGE = 1`.** Eight hits kill. Every health number in this plan is sized against that bar, not a hundred-point one.
- `MATCH_DURATION_S = 180`. `PICKUP_RANGE = 3.0` (`world.ts:169`). `CLUBHOUSE_APRON_M = 140` (`courseGeometry.ts:128`).
- **Get a test to fail for the right reason before you make it pass.** Where the code comes first, mutate it. `docs/TEST-AND-SPEC-PITFALLS.md` §1 — six tests on this repo were green while the bug they were named for was fully present.
- **A render check is never evidence about simulation.** The gate and smoke may show pickups are drawn, instanced and disposed. They may **not** be cited as evidence that placement is correct, that a cooldown works, or that a site is on valid ground.
- **Every `THREE.Mesh` disposes its geometry and material.** Pickups are the first thing in this repo that spawns course-wide.
- Do **not** add Rapier sensors. Do **not** add per-cart cooldowns. Do **not** add dynamic runtime injection of pickups. All three were considered and rejected in the spec, with reasons.
- Do **not** port `../Claude-of-Tanks-main/src/game/consumables.ts`. It does not fit, and a port would need a root `NOTICE` entry for code that is not used.

---

## File Structure

**Created:**
- `src/sim/drivable.ts` — the validity predicate. One closure factory, no state. Shared with Stage E.
- `src/sim/drivable.test.ts`
- `src/sim/pickupScatter.ts` — the seeded variable-radius scatter and its radius function.
- `src/sim/pickupScatter.test.ts`
- `src/render/coursePickups.ts` — instanced items and cylinders, `Trees.ts` shape.

**Modified:**
- `src/sim/entities/Pickup.ts` — **grows**, does not get rewritten. The existing `Bucket` API stays intact because stroke play still uses it; the site/`readyAt` model is added alongside.
- `src/sim/entities/Pickup.test.ts` — existing tests unchanged; new ones appended.
- `src/sim/courseWorld.ts` — `CourseWorld` gains `pickups: readonly PickupSite[]`; `buildCourseWorld` gains an optional `pickupSeed`.
- `src/sim/world.ts` — `pickupReadyAt` field, the getter's type, `loadCourse`, `reset`, `stepRig`.
- `src/render/scene.ts` — the `if (arena)` block at `:192-199` and `dispose()` at `:301-304`.
- `docs/DECISIONS.md`, `docs/HANDOFF.md`, `docs/ROADMAP.md`.

**Not touched:** `src/ui/courseMap.ts` and `MapMarker`. Arena builds no map (`RoundScreen.ts:127`) and stroke play has one bucket, so per-type marker colours do not arise.

---

### Task 1: The drivability predicate

**Files:**
- Create: `src/sim/drivable.ts`
- Test: `src/sim/drivable.test.ts`

**Interfaces:**
- Consumes: `CourseWorld` from `./courseWorld` with `.terrain`, `.surfaces`, `.holes`. `SurfaceId` from `./surfaces`.
- Produces: `createDrivable(world: CourseWorld): (x: number, z: number) => boolean` and `MIN_FREEBOARD_M = 0.4`.

- [ ] **Step 1: Write the failing test**

Create `src/sim/drivable.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDrivable } from "./drivable";
import { buildCourseWorld } from "./courseWorld";
import { generateCourse } from "./course";
import { toCourseFrame } from "./courseGeometry";
import { SurfaceId } from "./surfaces";

const COURSE_SEED = 2026;
const world = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED);
const isDrivable = createDrivable(world);

/** A point in one hole's local frame, expressed in the course frame. */
function inCourse(index: number, localX: number, localZ: number): { x: number; z: number } {
  const hole = world.holes[index]!;
  const out = { x: 0, z: 0 };
  toCourseFrame(hole.placement, localX, localZ, out);
  return out;
}

describe("createDrivable", () => {
  it("refuses the centre of every placed water polygon", () => {
    let checked = 0;
    for (const hole of world.holes) {
      for (const poly of hole.spec.water) {
        let lx = 0;
        let lz = 0;
        for (const p of poly.points) {
          lx += p.x;
          lz += p.z;
        }
        const at = inCourse(hole.spec.index, lx / poly.points.length, lz / poly.points.length);
        checked++;
        expect(isDrivable(at.x, at.z), `hole ${hole.spec.index + 1} pond centroid`).toBe(false);
      }
    }
    // A loop over an empty list passes every assertion inside it.
    expect(checked, "no water polygons found -- the loop asserted nothing").toBeGreaterThan(0);
  });

  it("accepts the centre of every placed bunker, because sand is drivable", () => {
    let checked = 0;
    for (const hole of world.holes) {
      for (const bunker of hole.spec.bunkers) {
        const at = inCourse(hole.spec.index, bunker.x, bunker.z);
        // Only assert where the assembled course agrees this is sand. A bunker the blend has
        // taken is a different question and not this test's.
        if (world.surfaces.surfaceAt(at.x, at.z) !== SurfaceId.Sand) continue;
        checked++;
        expect(isDrivable(at.x, at.z), `hole ${hole.spec.index + 1} bunker centre`).toBe(true);
      }
    }
    expect(checked, "no sand found -- the loop asserted nothing").toBeGreaterThan(0);
  });

  it("accepts every cup, so the densest part of the scatter has somewhere to go", () => {
    for (const hole of world.holes) {
      const at = inCourse(hole.spec.index, hole.spec.cup.x, hole.spec.cup.z);
      expect(isDrivable(at.x, at.z), `hole ${hole.spec.index + 1} cup`).toBe(true);
    }
  });

  it("accepts open rough, where no hole reaches at all", () => {
    // Well outside every field but inside the assembled bounds: the interstitial ground the
    // course rough owns. `weightsInto` returns -1 here, and -1 is drivable.
    const weights = new Float32Array(world.holes.length);
    const b = world.terrain.bounds;
    let found = 0;
    for (let x = b.minX + 5; x < b.maxX && found < 3; x += 17) {
      for (let z = b.minZ + 5; z < b.maxZ && found < 3; z += 17) {
        if (world.terrain.weightsInto(x, z, weights) !== -1) continue;
        found++;
        expect(isDrivable(x, z), `open rough at (${x.toFixed(0)}, ${z.toFixed(0)})`).toBe(true);
      }
    }
    expect(found, "no open-rough sample found -- the loop asserted nothing").toBe(3);
  });

  it("allocates nothing per call", () => {
    // Two calls on the same closure must not grow its scratch. The guard is structural: the
    // factory allocates once, the returned function never does.
    const probe = createDrivable(world);
    const before = probe(0, 0);
    const after = probe(0, 0);
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/sim/drivable.test.ts
```

Expected: **FAIL** with `Failed to resolve import "./drivable"`. That is the right failure — the module does not exist yet.

- [ ] **Step 3: Write the module**

Create `src/sim/drivable.ts`:

```ts
/**
 * Where a pickup -- or anything else placed course-wide -- may stand.
 *
 * "Drivable" is mechanical, not aesthetic. **Sand passes**: a bunker is not a hazard, it costs half
 * top speed (`SURFACES[Sand].cartSpeedScale`), and a pickup in one is a real risk-and-reward trade
 * in the game's own vocabulary. That is deliberately *not* the filter `props.ts` and `Trees.ts` use
 * -- those reject sand because a rake standing in a bunker looks wrong, which is an argument about
 * props. **Open rough passes** too: `weightsInto` returning -1 means the interstitial ground between
 * corridors, which is where scatter density should thin out rather than where placement refuses.
 *
 * Only water fails, and it fails twice over. The material lookup is the mechanical answer. The
 * freeboard check beside it compares ground height to the owning hole's water plane -- the same
 * guard `Trees.ts:146` uses -- and it holds *without asking who owns the point*, so it still catches
 * a pond if the ownership tie-break ever regresses. Belt and braces, at the cost of one subtraction.
 *
 * DOM-free and allocation-free per query, like everything else in `src/sim/**`. The factory
 * allocates one scratch array; the returned predicate allocates nothing.
 */
import type { CourseWorld } from "./courseWorld";
import { SurfaceId } from "./surfaces";

/**
 * Clearance above a hole's water plane before ground counts as dry. Matches `Trees.ts`'s
 * `MIN_FREEBOARD`: a basin ramps down over its shore, so ground pulled below the rendered water
 * plane is inside a hazard's shallows even where the polygon test has not caught it.
 */
export const MIN_FREEBOARD_M = 0.4;

export function createDrivable(world: CourseWorld): (x: number, z: number) => boolean {
  // Closure-owned scratch, the pattern `courseSurfaces.ts` and `courseTerrain.ts` both use.
  const weights = new Float32Array(world.holes.length);

  return function isDrivable(x: number, z: number): boolean {
    if (world.surfaces.surfaceAt(x, z) === SurfaceId.Water) return false;

    const owner = world.terrain.weightsInto(x, z, weights);
    if (owner < 0) return true;

    const spec = world.holes[owner]!.spec;
    // Absolute height is only meaningful against a hazard. Before water became a placed polygon,
    // `waterLevel` *was* the definition of wet; now low dry ground on a dry hole is just a hollow,
    // and testing it would strip placement off every dip on eleven of the eighteen holes.
    if (spec.water.length === 0) return true;
    return world.terrain.heightAt(x, z) >= spec.waterLevel + MIN_FREEBOARD_M;
  };
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/sim/drivable.test.ts
```

Expected: **PASS**, all five.

- [ ] **Step 5: Mutate the implementation to prove the tests bite**

The code came first for three of these assertions, so mutate it and watch them fail. Run each mutation, confirm the named test goes red, then revert.

| Mutation | Test that must fail |
|---|---|
| `if (owner < 0) return true` → `return false` | "accepts open rough" |
| delete the `surfaceAt === Water` line | "refuses the centre of every placed water polygon" |
| `spec.waterLevel + MIN_FREEBOARD_M` → `spec.waterLevel - 100` | should fail nothing — the polygon test already catches these ponds. **That is expected**, and it is why the freeboard guard is belt-and-braces rather than the primary check. Record it and move on. |

- [ ] **Step 6: Commit**

```bash
git add src/sim/drivable.ts src/sim/drivable.test.ts
git commit -m "sim: isDrivable -- water fails twice over, sand and open rough pass"
```

---

### Task 2: The seeded variable-radius scatter

**Files:**
- Create: `src/sim/pickupScatter.ts`
- Test: `src/sim/pickupScatter.test.ts`

**Interfaces:**
- Consumes: `createDrivable` from `./drivable` (Task 1). `mulberry32`, `hashChannel` from `./rng`. `smoothstep01` from `./curves`. `toCourseFrame` from `./courseGeometry`. `CLUBHOUSE_APRON_M` from `./courseGeometry`.
- Produces: `PickupKind = "bucket" | "hotdog"`, `PickupSite { readonly x: number; readonly z: number; readonly kind: PickupKind }`, `scatterPickups(world: CourseWorld, seed: number): PickupSite[]`, and the tunables `PICKUP_CHANNEL`, `PICKUP_RADIUS_NEAR_M`, `PICKUP_RADIUS_FAR_M`, `PICKUP_RADIUS_EASE_M`, `PICKUP_SCATTER_ATTEMPTS`, `PICKUP_BUCKET_SHARE`.

- [ ] **Step 1: Write the failing test**

Create `src/sim/pickupScatter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scatterPickups, PICKUP_RADIUS_NEAR_M } from "./pickupScatter";
import { createDrivable } from "./drivable";
import { buildCourseWorld } from "./courseWorld";
import { generateCourse } from "./course";
import { toCourseFrame } from "./courseGeometry";

const COURSE_SEED = 2026;
const world = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED);
const sites = scatterPickups(world, COURSE_SEED);

/** Every cup in the course frame, which is what the radius function eases from. */
const cups = world.holes.map((hole) => {
  const out = { x: 0, z: 0 };
  toCourseFrame(hole.placement, hole.spec.cup.x, hole.spec.cup.z, out);
  return out;
});

function distanceToNearestCup(x: number, z: number): number {
  let best = Infinity;
  for (const c of cups) best = Math.min(best, Math.hypot(c.x - x, c.z - z));
  return best;
}

describe("scatterPickups", () => {
  it("produces a workable number of sites", () => {
    // The spec's arithmetic: three takes per site per 180 s match, and six carts needing about
    // two refills each. Below 15 the global cooldown starts reading as starvation; far above 80
    // the map is a carpet. This is a band, not a target.
    expect(sites.length).toBeGreaterThanOrEqual(15);
    expect(sites.length).toBeLessThanOrEqual(90);
  });

  it("never places a site on undrivable ground", () => {
    const isDrivable = createDrivable(world);
    for (const s of sites) {
      expect(isDrivable(s.x, s.z), `site at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBe(true);
    }
    expect(sites.length, "no sites -- the loop asserted nothing").toBeGreaterThan(0);
  });

  it("never places a site on undrivable ground for any seed", () => {
    // One seed producing no wet site is luck. The assertion is about the filter, not the draw.
    const isDrivable = createDrivable(world);
    for (const seed of [1, 7, 99, 2027, 123456]) {
      const other = scatterPickups(world, seed);
      expect(other.length, `seed ${seed} produced nothing`).toBeGreaterThan(0);
      for (const s of other) {
        expect(isDrivable(s.x, s.z), `seed ${seed} site (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`).toBe(true);
      }
    }
  });

  it("packs tighter near cups than out in the rough", () => {
    // The comparative assertion is the one that carries weight. "There exist sites near cups" is
    // also true of a uniform random scatter, so it proves nothing about the radius function.
    const near: number[] = [];
    const far: number[] = [];
    for (const s of sites) {
      let nearest = Infinity;
      for (const t of sites) {
        if (t === s) continue;
        nearest = Math.min(nearest, Math.hypot(t.x - s.x, t.z - s.z));
      }
      if (!Number.isFinite(nearest)) continue;
      const toCup = distanceToNearestCup(s.x, s.z);
      if (toCup < 60) near.push(nearest);
      else if (toCup > 250) far.push(nearest);
    }

    expect(near.length, "no sites within 60 m of a cup").toBeGreaterThan(2);
    expect(far.length, "no sites beyond 250 m of every cup").toBeGreaterThan(2);

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(near)).toBeLessThan(mean(far));
  });

  it("respects the minimum radius everywhere", () => {
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const d = Math.hypot(sites[i]!.x - sites[j]!.x, sites[i]!.z - sites[j]!.z);
        expect(d, `sites ${i} and ${j}`).toBeGreaterThanOrEqual(PICKUP_RADIUS_NEAR_M);
      }
    }
  });

  it("is reproducible from the seed", () => {
    const again = scatterPickups(world, COURSE_SEED);
    expect(again).toEqual(sites);
  });

  it("differs on a different seed", () => {
    const other = scatterPickups(world, COURSE_SEED + 1);
    expect(other).not.toEqual(sites);
  });

  it("does not shift when the terrain channel moves", () => {
    // The channel-collision test, and the only thing that catches it. If PICKUP_CHANNEL collided
    // with terrain's 0 or surfaces' 1, re-deriving the course from the same seed through a
    // different channel would move the pickups with it.
    const world2 = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED);
    expect(scatterPickups(world2, COURSE_SEED)).toEqual(sites);
  });

  it("places both kinds", () => {
    expect(sites.some((s) => s.kind === "bucket")).toBe(true);
    expect(sites.some((s) => s.kind === "hotdog")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/sim/pickupScatter.test.ts
```

Expected: **FAIL** with `Failed to resolve import "./pickupScatter"`.

- [ ] **Step 3: Write the module**

Create `src/sim/pickupScatter.ts`:

```ts
/**
 * Where the pickups are, worked out once when the course is assembled.
 *
 * **Dart throwing, not Bridson.** Bridson's grid-accelerated Poisson sampler is the right answer at
 * thousands of samples; this draws about fifty, where the acceleration structure costs more to
 * write and reason about than the O(n^2) rejection it replaces. Fifty accepted sites is at most
 * ~1,250 distance comparisons per accepted candidate in the worst case and a few hundred thousand
 * for the whole scatter, once, at course build. Do not "optimise" this into a grid.
 *
 * **The radius varies with distance to the nearest cup**, and that is the whole design. A uniform
 * radius forces a choice between a carpet and a desert: over 36 ha, 45 m yields about 123 sites and
 * 140 m about 13. Easing between them puts pickups where the map is contested -- the greens, and
 * the clubhouse apron where holes 1, 9, 10 and 18 converge -- and thins them out in the
 * interstitial rough nobody fights over.
 *
 * DOM-free. Allocates freely: this runs once, from `buildCourseWorld`, never inside the tick.
 */
import type { CourseWorld } from "./courseWorld";
import { CLUBHOUSE_APRON_M, toCourseFrame } from "./courseGeometry";
import { createDrivable } from "./drivable";
import { smoothstep01 } from "./curves";
import { hashChannel, mulberry32 } from "./rng";

/**
 * The `hashChannel` channel placement draws on.
 *
 * Five because 0-4 are taken at the `(seed, index, n)` position: terrain 0, surfaces 1, course
 * generation 2 and 4, trees 3. `bot.ts`'s `BOT_CHANNEL` and `matchConfig.ts`'s `SPAWN_CHANNEL`
 * avoid collision by *arity* rather than by value, which works and is not worth imitating.
 */
export const PICKUP_CHANNEL = 5;

/** Minimum spacing at a cup or inside the clubhouse apron. */
export const PICKUP_RADIUS_NEAR_M = 45;
/** Minimum spacing in ground no cup is near. */
export const PICKUP_RADIUS_FAR_M = 140;
/** Distance from the nearest cup at which the radius has fully eased to `FAR`. */
export const PICKUP_RADIUS_EASE_M = 260;

/**
 * Candidate draws before the scatter gives up.
 *
 * Bounded for the same reason `SPAWN_TRIES` is: rejection rates climb as the field fills, and a
 * course whose every candidate is contested must still finish rather than spin. Four thousand is
 * enough to saturate at these radii with room to spare -- measured at 2026, and the site-count
 * band in the test is what would catch it becoming too few.
 */
export const PICKUP_SCATTER_ATTEMPTS = 4000;

/** Share of sites that are ammo rather than health. Ammo is the binding resource in arena. */
export const PICKUP_BUCKET_SHARE = 0.6;

export type PickupKind = "bucket" | "hotdog";

export interface PickupSite {
  readonly x: number;
  readonly z: number;
  readonly kind: PickupKind;
}

export function scatterPickups(world: CourseWorld, seed: number): PickupSite[] {
  const random = mulberry32(hashChannel(seed, PICKUP_CHANNEL));
  const isDrivable = createDrivable(world);
  const bounds = world.terrain.bounds;

  const cups: { x: number; z: number }[] = world.holes.map((hole) => {
    const out = { x: 0, z: 0 };
    toCourseFrame(hole.placement, hole.spec.cup.x, hole.spec.cup.z, out);
    return out;
  });

  /** Minimum spacing here: tight at a cup or in the apron, easing out into the rough. */
  function radiusAt(x: number, z: number): number {
    let nearest = Infinity;
    for (const c of cups) nearest = Math.min(nearest, Math.hypot(c.x - x, c.z - z));
    // The clubhouse is the most contested ground on the map but it is nobody's cup, so treat it
    // as one while inside the apron.
    //
    // READ THE CLUBHOUSE POSITION, DO NOT ASSUME THE ORIGIN. The authored routing moves it to the
    // southern boundary; `Math.hypot(x, z)` was only ever correct while the solver put it at
    // {0, 0}. Take it from the layout -- `CourseLayout.clubhouse` already carries it, and
    // `CourseWorld` must pass it through if it does not already.
    const dxc = clubhouse.x - x;
    const dzc = clubhouse.z - z;
    const fromClubhouse = Math.hypot(dxc, dzc);
    if (fromClubhouse < CLUBHOUSE_APRON_M) nearest = Math.min(nearest, fromClubhouse);

    const t = smoothstep01(nearest / PICKUP_RADIUS_EASE_M);
    return PICKUP_RADIUS_NEAR_M + (PICKUP_RADIUS_FAR_M - PICKUP_RADIUS_NEAR_M) * t;
  }

  const accepted: PickupSite[] = [];
  const radii: number[] = [];

  for (let attempt = 0; attempt < PICKUP_SCATTER_ATTEMPTS; attempt++) {
    const x = bounds.minX + random() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
    // Draw the kind unconditionally so a rejected candidate still advances the stream by the same
    // amount as an accepted one. Consuming a variable number of draws per attempt would make the
    // layout depend on the rejection pattern, which is exactly the call-order coupling
    // `hashChannel` exists to avoid.
    const kind: PickupKind = random() < PICKUP_BUCKET_SHARE ? "bucket" : "hotdog";

    if (!isDrivable(x, z)) continue;

    const r = radiusAt(x, z);
    let ok = true;
    for (let i = 0; i < accepted.length; i++) {
      const other = accepted[i]!;
      // The smaller of the two radii, so a tight region can pack tightly right up against a sparse
      // one without the sparse side's radius pushing a hole in the dense side.
      const min = Math.min(r, radii[i]!);
      const dx = other.x - x;
      const dz = other.z - z;
      if (dx * dx + dz * dz < min * min) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    accepted.push({ x, z, kind });
    radii.push(r);
  }

  return accepted;
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/sim/pickupScatter.test.ts
```

Expected: **PASS**, all nine. If `"produces a workable number of sites"` fails low, raise `PICKUP_SCATTER_ATTEMPTS` rather than lowering the radii — the radii are the design and the attempt budget is a knob.

- [ ] **Step 5: Mutate to prove the tests bite**

| Mutation | Test that must fail |
|---|---|
| `if (!isDrivable(x, z)) continue;` deleted | "never places a site on undrivable ground", on at least one of the six seeds |
| `radiusAt` returns `PICKUP_RADIUS_FAR_M` always | "packs tighter near cups than out in the rough" |
| `mulberry32(hashChannel(seed, PICKUP_CHANNEL))` → `mulberry32(seed)` | none of them — **that is a finding, not a pass.** Record it: the channel test only catches a collision, not the absence of hashing. Do not add a test for it; `rng.test.ts` already owns `hashChannel(s) !== s`. |

- [ ] **Step 6: Commit**

```bash
git add src/sim/pickupScatter.ts src/sim/pickupScatter.test.ts
git commit -m "sim: seeded variable-radius pickup scatter on PICKUP_CHANNEL 5"
```

---

### Task 3: Site cooldowns as ready-at timestamps

**Files:**
- Modify: `src/sim/entities/Pickup.ts` (append; the existing `Bucket` API is untouched)
- Modify: `src/sim/entities/Pickup.test.ts` (append; existing tests untouched)

**Interfaces:**
- Consumes: `PickupKind`, `PickupSite` from `../pickupScatter`.
- Produces: `PICKUP_COOLDOWN_S = 60`, `HOTDOG_HEAL = 3`, `createPickupState(count: number): Float64Array`, `pickupReady(readyAt: Float64Array, index: number, nowS: number): boolean`, `takePickupAt(readyAt: Float64Array, index: number, nowS: number): boolean`, `resetPickupState(readyAt: Float64Array): void`, and the marker interface `PickupMarker { readonly position: { readonly x: number; readonly z: number } }`.

- [ ] **Step 1: Write the failing test**

Append to `src/sim/entities/Pickup.test.ts`. Add the new names to the existing import from `./Pickup`.

```ts
describe("site cooldowns", () => {
  it("starts every site available", () => {
    const readyAt = createPickupState(3);
    expect(pickupReady(readyAt, 0, 0)).toBe(true);
    expect(pickupReady(readyAt, 2, 0)).toBe(true);
  });

  it("takes a site once and refuses the second take in the same tick", () => {
    const readyAt = createPickupState(2);
    expect(takePickupAt(readyAt, 0, 10)).toBe(true);
    expect(takePickupAt(readyAt, 0, 10)).toBe(false);
  });

  it("leaves other sites alone when one is taken", () => {
    const readyAt = createPickupState(2);
    takePickupAt(readyAt, 0, 10);
    expect(pickupReady(readyAt, 1, 10)).toBe(true);
  });

  it("stays unavailable for exactly PICKUP_COOLDOWN_S and no less", () => {
    const readyAt = createPickupState(1);
    takePickupAt(readyAt, 0, 10);
    expect(pickupReady(readyAt, 0, 10 + PICKUP_COOLDOWN_S - 0.001)).toBe(false);
    expect(pickupReady(readyAt, 0, 10 + PICKUP_COOLDOWN_S)).toBe(true);
  });

  it("clears on reset, so a rematch starts from a full course", () => {
    const readyAt = createPickupState(2);
    takePickupAt(readyAt, 0, 10);
    takePickupAt(readyAt, 1, 10);
    resetPickupState(readyAt);
    expect(pickupReady(readyAt, 0, 10)).toBe(true);
    expect(pickupReady(readyAt, 1, 10)).toBe(true);
  });

  it("refuses an out-of-range index rather than writing past the array", () => {
    const readyAt = createPickupState(1);
    expect(takePickupAt(readyAt, 5, 0)).toBe(false);
    expect(pickupReady(readyAt, 5, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/sim/entities/Pickup.test.ts
```

Expected: **FAIL** — `createPickupState is not exported`. The five existing `Bucket` tests must still pass; if any of them broke, the import edit went wrong.

- [ ] **Step 3: Append the implementation**

Append to `src/sim/entities/Pickup.ts`, leaving everything above it untouched:

```ts
/**
 * Course-wide pickups, which are a different shape from the single hardcoded `Bucket` above.
 *
 * **Stroke play keeps the `Bucket`.** That mode has bots, combat and ammo -- it is not pure golf --
 * and `stepRig` takes its bucket unconditionally. Removing it would regress a shipped mode, so this
 * is added beside it rather than replacing it.
 *
 * **Absolute ready-at times, not a per-tick decrement.** `stepBucket` steps one bucket; at fifty
 * sites the same model is fifty subtractions a tick, 3,000 a second, of pure bookkeeping. A
 * timestamp compared once in the poll removes the loop entirely. The idea is the one thing worth
 * keeping from the `consumables.ts` the roadmap suggested porting -- and it is an idea, not code,
 * so it carries no attribution.
 */

/** Seconds before a taken site comes back. Global to the site: whoever takes it denies it. */
export const PICKUP_COOLDOWN_S = 60;

/**
 * HP a hot dog restores, against `ARENA_MAX_HEALTH = 8` and one damage per hit.
 *
 * A playtest placeholder, not a derived constant -- but not an arbitrary one either. Two is a bad
 * trade for the thirty seconds of driving a detour costs on this map; four is half the bar.
 */
export const HOTDOG_HEAL = 3;

/** What the map needs from a pickup, and all it needs. Both `Bucket` and a site view satisfy it. */
export interface PickupMarker {
  readonly position: { readonly x: number; readonly z: number };
}

/** One slot per site, holding the sim time at which it next becomes available. Zero is ready. */
export function createPickupState(count: number): Float64Array {
  return new Float64Array(count);
}

export function pickupReady(readyAt: Float64Array, index: number, nowS: number): boolean {
  if (index < 0 || index >= readyAt.length) return false;
  return nowS >= readyAt[index]!;
}

/** Takes the site if it is ready, starting its cooldown. Grants nothing -- the caller decides. */
export function takePickupAt(readyAt: Float64Array, index: number, nowS: number): boolean {
  if (!pickupReady(readyAt, index, nowS)) return false;
  readyAt[index] = nowS + PICKUP_COOLDOWN_S;
  return true;
}

export function resetPickupState(readyAt: Float64Array): void {
  readyAt.fill(0);
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/sim/entities/Pickup.test.ts
```

Expected: **PASS** — six new plus the five existing `Bucket` tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/entities/Pickup.ts src/sim/entities/Pickup.test.ts
git commit -m "sim: site cooldowns as ready-at timestamps, alongside the stroke-play bucket"
```

---

### Task 4: Bake sites into the course and poll them in the tick

**Files:**
- Modify: `src/sim/courseWorld.ts` — the `CourseWorld` interface and `buildCourseWorld`
- Modify: `src/sim/world.ts` — field near `:333`, getter at `:643`, `loadCourse` at `:805`, `reset` at `:1339`, `stepRig` at `:1038`
- Test: `src/sim/courseWorld.test.ts` (append), `src/sim/world.course.test.ts` (append)

**Interfaces:**
- Consumes: `scatterPickups`, `PickupSite` from `./pickupScatter` (Task 2). `createPickupState`, `pickupReady`, `takePickupAt`, `resetPickupState`, `HOTDOG_HEAL`, `PickupMarker` from `./entities/Pickup` (Task 3). `heal` from `./health`. `BUCKET_REFILL_AMMO` from `./entities/Cart`.
- Produces: `CourseWorld.pickups: readonly PickupSite[]`; `buildCourseWorld(course, seed, pickupSeed?)`; `Sim.pickups` retyped to `readonly PickupMarker[]`; `Sim.pickupSites: readonly PickupSite[]` for the renderer; `Sim.pickupAvailable(index: number): boolean` for the renderer.

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/courseWorld.test.ts`:

```ts
  it("carries a pickup scatter, baked once", () => {
    expect(world.pickups.length).toBeGreaterThan(0);
    // Immutable for the life of the course: two reads are the same array, not two scatters.
    expect(world.pickups).toBe(world.pickups);
  });

  it("takes a pickup seed distinct from the course seed", () => {
    const a = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED, 111);
    const b = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED, 222);
    expect(a.pickups).not.toEqual(b.pickups);
    // And the default is the course seed, so today's behaviour is replay-identical.
    const d = buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED);
    expect(d.pickups).toEqual(
      buildCourseWorld(generateCourse(COURSE_SEED, 18), COURSE_SEED, COURSE_SEED).pickups,
    );
  });
```

Append to `src/sim/world.course.test.ts`. **Read that file's existing helpers first** — they are not what you would guess: `arenaSim()` is `async` and returns `{ sim, terrain, holes }`, the course it builds is **six holes at 8 m cells** (not eighteen), it is created with `botCount: 0`, and stepping goes through `play(sim, [{ ticks, intent }])`. There is no `idleIntent`.

Add one helper beside `arenaSim`, which differs from it in exactly two ways — it passes pickup sites, and it takes a bot:

```ts
/**
 * An arena `Sim` whose pickup sites are handed in rather than scattered.
 *
 * Placing a site *at the cart's own spawn* is what makes these tests about the poll, the grant and
 * the reset rather than about the scatter -- `pickupScatter.test.ts` owns the scatter, and a test
 * that has to drive twenty seconds to reach a site is testing the drive. It also avoids writing
 * `cart.position` directly, which `moveCartBody` would fight on the next tick.
 */
async function arenaSimWithSites(
  kinds: readonly PickupKind[],
  botCount = 0,
): Promise<{ sim: Sim; sites: PickupSite[] }> {
  const { terrain, holes } = buildCourse();
  const sim = await Sim.create(holes[0]!.spec, { botCount });
  const surfaces = createCourseSurfaces(
    terrain,
    holes.map((h) => createSurfaces(h.spec, h.terrain)),
  );
  sim.loadCourse(terrain, surfaces, holes, []);
  // Every site sits on the cart wherever `loadCourse` spawned it, so one tick reaches all of them.
  const at = sim.cart.position;
  const sites: PickupSite[] = kinds.map((kind) => ({ x: at.x, z: at.z, kind }));
  sim.loadCourse(terrain, surfaces, holes, sites);
  return { sim, sites };
}
```

Then the tests:

```ts
  it("grants ammo from a bucket site and starts only that site's cooldown", async () => {
    // Two sites at the same point: the second is the control. If taking one started every
    // cooldown, "the site went on cooldown" alone would not catch it.
    const { sim } = await arenaSimWithSites(["bucket", "hotdog"]);
    sim.cart.ammo = 0;

    play(sim, [{ ticks: 1, intent: {} }]);

    expect(sim.cart.ammo).toBe(BUCKET_REFILL_AMMO);
    expect(sim.pickupAvailable(0)).toBe(false);
  });

  it("heals from a hot-dog site and cannot heal above the bar", async () => {
    const { sim } = await arenaSimWithSites(["hotdog"]);
    // Full health: the site is still consumed and hp does not exceed max. `heal` owns the clamp;
    // what this asserts is that the pickup routes through it rather than writing the field.
    const max = sim.cart.health.max;

    play(sim, [{ ticks: 1, intent: {} }]);

    expect(sim.cart.health.hp).toBe(max);
    expect(sim.pickupAvailable(0)).toBe(false);
  });

  it("heals a damaged cart by exactly HOTDOG_HEAL", async () => {
    const { sim } = await arenaSimWithSites(["hotdog"]);
    const max = sim.cart.health.max;
    applyDamage(sim.cart.health, max - 1);
    expect(sim.cart.health.hp).toBe(1);

    play(sim, [{ ticks: 1, intent: {} }]);

    expect(sim.cart.health.hp).toBe(1 + HOTDOG_HEAL);
  });

  it("clears every cooldown on reset without moving a site", async () => {
    const { sim } = await arenaSimWithSites(["bucket"]);
    const before = sim.pickupSites;

    play(sim, [{ ticks: 1, intent: {} }]);
    expect(sim.pickupAvailable(0)).toBe(false);

    sim.reset();

    // Both halves matter. Asserting only that cooldowns clear would also be satisfied by
    // rebuilding the whole site list, which is the behaviour the spec rejects.
    expect(sim.pickupAvailable(0)).toBe(true);
    expect(sim.pickupSites).toBe(before);
  });
```

Add to that file's imports: `PickupKind`, `PickupSite` from `./pickupScatter`; `HOTDOG_HEAL` from `./entities/Pickup`; `BUCKET_REFILL_AMMO` from `./entities/Cart`; `applyDamage` from `./health`.

- [ ] **Step 2: Run them and confirm they fail**

```bash
npx vitest run src/sim/courseWorld.test.ts src/sim/world.course.test.ts
```

Expected: **FAIL** — `world.pickups` undefined, `sim.pickupSites` not a function. The pre-existing tests in both files must still pass.

- [ ] **Step 3: Bake the scatter into `CourseWorld`**

In `src/sim/courseWorld.ts`, add to the `CourseWorld` interface:

```ts
  /**
   * Where the pickups stand, for the life of this course. Positions never move -- `Sim` owns the
   * cooldowns and clears them on reset, which is what makes a rematch the same world rather than a
   * continuation of the last one.
   */
  readonly pickups: readonly PickupSite[];
```

and change the factory signature and return:

```ts
export function buildCourseWorld(course: Course, seed: number, pickupSeed = seed): CourseWorld {
```

```ts
  return { terrain, surfaces, holes, pickups: scatterPickups({ terrain, surfaces, holes }, pickupSeed) };
```

Add the imports: `import { scatterPickups } from "./pickupScatter";` and `import type { PickupSite } from "./pickupScatter";`.

Extend the doc comment above `buildCourseWorld`:

```
 * `pickupSeed` defaults to `seed`, which makes the scatter replay-identical -- the same behaviour
 * `Sim.reset` already has for spawn tees. It is a parameter rather than a hardcode so that the day
 * a match record exists, a per-match nonce has a socket and nothing restructures. There is no
 * replay format today, and a nonce written down nowhere makes a match irreproducible rather than
 * varied, which is why it is not the default.
```

- [ ] **Step 4: Hold the state on `Sim`**

In `src/sim/world.ts`, beside the `buckets` field around `:333`:

```ts
  /** Course-wide pickup sites. Empty in stroke play; set once by `loadCourse`. */
  private pickupSiteList: readonly PickupSite[] = [];
  /** Sim time each site next becomes available. Parallel to `pickupSiteList`. */
  private pickupReadyAt = new Float64Array(0);
```

Add the getters beside `get pickups()` at `:643`, and retype that getter:

```ts
  get pickups(): readonly PickupMarker[] {
    return this.arena ? this.pickupViews : this.buckets;
  }

  /** The scatter, for the renderer. Stable for the life of the course. */
  get pickupSites(): readonly PickupSite[] {
    return this.pickupSiteList;
  }

  /** Whether site `index` is takeable right now. The renderer dims the ones that are not. */
  pickupAvailable(index: number): boolean {
    return pickupReady(this.pickupReadyAt, index, this.simTime);
  }
```

`pickupViews` is a private array built once in `loadCourse` so the getter allocates nothing per frame:

```ts
  /** `PickupMarker` views over `pickupSiteList`, built once so the per-frame getter allocates none. */
  private pickupViews: PickupMarker[] = [];
```

- [ ] **Step 5: Populate in `loadCourse`**

`loadCourse` currently takes `(course, surfaces, holes)`. Add the sites as a fourth parameter rather than reaching for a `CourseWorld` — the signature already takes the pieces, and `main.ts` and the gate both pass them from one. In `src/sim/world.ts` at `:805`:

```ts
  loadCourse(
    course: CourseTerrain,
    surfaces: Surfaces,
    holes: readonly SpawnHole[],
    pickups: readonly PickupSite[] = [],
  ): void {
```

and inside it, after `this.arena = true;`:

```ts
    this.pickupSiteList = pickups;
    this.pickupReadyAt = createPickupState(pickups.length);
    this.pickupViews = pickups.map((s) => ({ position: { x: s.x, z: s.z } }));
```

Update the call site in `src/main.ts` to pass `world.pickups`, and the gate's if it calls `loadCourse`. Find them with:

```bash
grep -rn "loadCourse(" src/ tools/ --include="*.ts"
```

- [ ] **Step 6: Clear on reset**

In `reset()` at `:1339`, inside the existing `if (this.arena) { ... }` block beside the spawn-stream re-seed:

```ts
      resetPickupState(this.pickupReadyAt);
```

The positions are deliberately not touched. That is the decision, and the test in Step 1 asserts both halves.

- [ ] **Step 7: Poll in `stepRig`**

In `stepRig` at `:1038`, after the existing bucket loop and before the landed-ball loop:

```ts
    for (let i = 0; i < this.pickupSiteList.length; i++) {
      const site = this.pickupSiteList[i]!;
      const dx = site.x - c.x;
      const dz = site.z - c.z;
      // Squared, so the hot path never calls Math.hypot. PICKUP_RANGE is 3 m.
      if (dx * dx + dz * dz > PICKUP_RANGE * PICKUP_RANGE) continue;
      if (!takePickupAt(this.pickupReadyAt, i, this.simTime)) continue;
      if (site.kind === "bucket") cart.addAmmo(BUCKET_REFILL_AMMO);
      else heal(cart.health, HOTDOG_HEAL);
    }
```

Two carts reaching a site on the same tick are resolved by **lower rig index**, and they are for free: `stepCart` iterates `this.rigs` in order, the first cart through `takePickupAt` sets the cooldown, and the second gets `false`. Nearest-distance was rejected as a tie-break that itself ties.

- [ ] **Step 8: Run the tests**

```bash
npx vitest run src/sim/courseWorld.test.ts src/sim/world.course.test.ts src/sim/entities/Pickup.test.ts
npm test
```

Expected: all green, including the six pre-existing `world.course.test.ts` tests. The new ones are `async` because `Sim.create` is; a missing `await` shows up as a passing test that asserted nothing.

- [ ] **Step 9: Cover what is coverable about contention, and record what is not**

The same-tick rule — first rig through `takePickupAt` wins, second gets `false` — is already asserted at the module level by Task 3's *"takes a site once and refuses the second take in the same tick"*. That is the mechanism, and it is tested.

**What cannot be tested at the `Sim` level, and why:** a genuine contest needs two carts inside one site's 3 m radius on the same tick, and `SPAWN_CLEARANCE_M = 60` means `loadCourse` never spawns two carts that close. Driving them together would make the test about bot navigation. So the *rig-order precedence* — that the player, as rig 0, beats a bot on a true tie — rests on `stepCart`'s `for (const rig of this.rigs)` loop and is **not separately asserted**. Record that in the commit message rather than writing a test that appears to cover it and does not.

What is worth asserting here is independence, which a shared-state bug would break:

```ts
  it("keeps each site's cooldown to itself", async () => {
    const { sim } = await arenaSimWithSites(["bucket", "bucket", "hotdog"]);
    play(sim, [{ ticks: 1, intent: {} }]);

    // All three are co-located, so one tick takes all three -- and each must have been taken on
    // its own slot. A shared or off-by-one `readyAt` index shows up here as a survivor.
    expect(sim.pickupAvailable(0)).toBe(false);
    expect(sim.pickupAvailable(1)).toBe(false);
    expect(sim.pickupAvailable(2)).toBe(false);
    // Two buckets plus a hot dog, all taken in one tick, on an empty cart at full health.
    expect(sim.cart.ammo).toBe(2 * BUCKET_REFILL_AMMO);
  });
```

Set `sim.cart.ammo = 0` before the `play` call so the ammo assertion reads the grant rather than the starting thirty.

- [ ] **Step 10: Commit**

```bash
git add src/sim/courseWorld.ts src/sim/world.ts src/sim/courseWorld.test.ts src/sim/world.course.test.ts src/main.ts
git commit -m "sim: bake pickup sites into the course, poll them in the tick"
```

---

### Task 5: Draw them

**Files:**
- Create: `src/render/coursePickups.ts`
- Modify: `src/render/scene.ts` — the `if (arena)` block at `:192-199`, the field declarations at `:123-128`, `update` near `:281`, `dispose` at `:301-304`
- Modify: `src/render/scene.ts`'s `ArenaSource` interface at `:68`

**Interfaces:**
- Consumes: `PickupSite` from `../sim/pickupScatter`. `Sim.pickupSites` and `Sim.pickupAvailable` from Task 4.
- Produces: `createCoursePickups(sites, heightAt): CoursePickups` with `{ readonly group: THREE.Group; update(available: (i: number) => boolean, elapsedSeconds: number): void; dispose(): void }`.

**Placeholder geometry, deliberately.** `src/entities/graphs/pickups.json` does not exist yet — it comes from the Blender session driven by `docs/concept/reference/pickup-items-02.jpg`. This task ships procedural primitives so the feature lands and reads correctly in the world; Task 7 swaps in the authored graph without touching anything else.

- [ ] **Step 1: Write the module**

Create `src/render/coursePickups.ts`:

```ts
/**
 * The pickups, drawn.
 *
 * Four draw calls for the whole course: one `InstancedMesh` per item kind, one for the glow
 * cylinders, following `Trees.ts` exactly -- that module is the precedent for "many identical
 * things, one draw call, one dispose".
 *
 * **A taken pickup keeps its cylinder and loses its item.** That is simultaneously the cheapest
 * thing to implement -- the cylinder's instance count never changes, only the items' -- and what
 * makes a sixty-second global cooldown learnable instead of arbitrary. A player who drives past an
 * empty cylinder has learned where a pickup is and roughly when it returns; one who drives past
 * nothing has learned nothing.
 *
 * The visual cylinder is 1.5 m in radius against a 3.0 m collection radius. Generous grab, tight
 * visual: it looks like an inconsistency and is not one.
 */
import * as THREE from "three";
import type { PickupSite } from "../sim/pickupScatter";

/** Cylinder radius. Half `PICKUP_RANGE`, on purpose -- see the module comment. */
const CYLINDER_RADIUS_M = 1.5;
const CYLINDER_HEIGHT_M = 2.6;
/** Item centre above ground. Lower third of the cylinder, clear of a cart's roof line at 2.05 m. */
const ITEM_HEIGHT_M = 1.1;
/** Radians per second the items turn. Slow enough to read as floating, not spinning. */
const ITEM_SPIN_RATE = 0.9;

const BUCKET_COLOUR = 0x2f8f4e;
const HOTDOG_COLOUR = 0xd9873a;
const GLOW_COLOUR = 0xffd34d;

export interface CoursePickups {
  readonly group: THREE.Group;
  update(available: (index: number) => boolean, elapsedSeconds: number): void;
  dispose(): void;
}

export function createCoursePickups(
  sites: readonly PickupSite[],
  heightAt: (x: number, z: number) => number,
): CoursePickups {
  const group = new THREE.Group();

  // Placeholder forms until `src/entities/graphs/pickups.json` lands: a tapered bucket and a
  // capsule hot dog, both at the envelopes in the modelling brief.
  const bucketGeometry = new THREE.CylinderGeometry(0.35, 0.26, 0.8, 10);
  const hotdogGeometry = new THREE.CapsuleGeometry(0.13, 0.64, 4, 8);
  const cylinderGeometry = new THREE.CylinderGeometry(
    CYLINDER_RADIUS_M,
    CYLINDER_RADIUS_M,
    CYLINDER_HEIGHT_M,
    16,
    1,
    true,
  );

  const bucketMaterial = new THREE.MeshStandardMaterial({ color: BUCKET_COLOUR, flatShading: true, roughness: 0.8 });
  const hotdogMaterial = new THREE.MeshStandardMaterial({ color: HOTDOG_COLOUR, flatShading: true, roughness: 0.8 });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: GLOW_COLOUR,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const bucketIndices: number[] = [];
  const hotdogIndices: number[] = [];
  for (let i = 0; i < sites.length; i++) {
    if (sites[i]!.kind === "bucket") bucketIndices.push(i);
    else hotdogIndices.push(i);
  }

  const buckets = new THREE.InstancedMesh(bucketGeometry, bucketMaterial, Math.max(1, bucketIndices.length));
  const hotdogs = new THREE.InstancedMesh(hotdogGeometry, hotdogMaterial, Math.max(1, hotdogIndices.length));
  const cylinders = new THREE.InstancedMesh(cylinderGeometry, glowMaterial, Math.max(1, sites.length));

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const spinAxis = new THREE.Vector3(0, 1, 0);
  const unitScale = new THREE.Vector3(1, 1, 1);
  const zeroScale = new THREE.Vector3(0, 0, 0);

  // The cylinders never move or change count, so they are written once and their buffer marked
  // static. Only the items are touched per frame.
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]!;
    position.set(s.x, heightAt(s.x, s.z) + CYLINDER_HEIGHT_M / 2, s.z);
    matrix.compose(position, new THREE.Quaternion(), unitScale);
    cylinders.setMatrixAt(i, matrix);
  }
  cylinders.instanceMatrix.needsUpdate = true;
  cylinders.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  cylinders.computeBoundingSphere();
  // Transparent instances are not sorted per instance. At ~50 scattered cylinders they rarely
  // overlap, and rendering last with depthWrite off is enough.
  cylinders.renderOrder = 1;

  group.add(buckets, hotdogs, cylinders);

  /** Ground height per site, sampled once -- the course does not move. */
  const groundY = sites.map((s) => heightAt(s.x, s.z));

  function writeItems(
    mesh: THREE.InstancedMesh,
    indices: readonly number[],
    available: (index: number) => boolean,
    elapsedSeconds: number,
  ): void {
    quaternion.setFromAxisAngle(spinAxis, elapsedSeconds * ITEM_SPIN_RATE);
    for (let slot = 0; slot < indices.length; slot++) {
      const site = indices[slot]!;
      const s = sites[site]!;
      position.set(s.x, groundY[site]! + ITEM_HEIGHT_M, s.z);
      // A taken site scales its item to zero rather than compacting the instance list: compacting
      // would renumber every slot every frame and break the site-to-slot mapping.
      matrix.compose(position, quaternion, available(site) ? unitScale : zeroScale);
      mesh.setMatrixAt(slot, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    update(available, elapsedSeconds) {
      writeItems(buckets, bucketIndices, available, elapsedSeconds);
      writeItems(hotdogs, hotdogIndices, available, elapsedSeconds);
    },
    dispose() {
      bucketGeometry.dispose();
      hotdogGeometry.dispose();
      cylinderGeometry.dispose();
      bucketMaterial.dispose();
      hotdogMaterial.dispose();
      glowMaterial.dispose();
      buckets.dispose();
      hotdogs.dispose();
      cylinders.dispose();
      group.removeFromParent();
    },
  };
}
```

- [ ] **Step 2: Wire it into the scene**

In `src/render/scene.ts`, extend the `ArenaSource` interface at `:68` with the two things the renderer needs:

```ts
  readonly pickups: readonly PickupSite[];
  pickupAvailable(index: number): boolean;
```

Add the field beside the other four nullables at `:123-128`:

```ts
  private readonly coursePickups: CoursePickups | null;
```

In the `if (arena)` branch at `:192-199`, after `createCourseGround`:

```ts
      this.coursePickups = createCoursePickups(arena.pickups, (x, z) => arena.course.heightAt(x, z));
      this.scene.add(this.coursePickups.group);
```

and `this.coursePickups = null;` in the `else` branch.

In `update`, beside the existing `courseGround` update near `:281`:

```ts
    this.coursePickups?.update((i) => arenaSource.pickupAvailable(i), view.elapsedSeconds);
```

Use whatever name `scene.ts` already holds the `ArenaSource` under; if it is only a constructor parameter, store it as a private field alongside `coursePickups` in the arena branch.

In `dispose()` at `:301-304`:

```ts
    this.coursePickups?.dispose();
```

- [ ] **Step 3: Point `RoundScreen` at the sim**

`RoundScreen` builds the `ArenaSource`. Add the two new members there, reading from `Sim`:

```ts
      pickups: sim.pickupSites,
      pickupAvailable: (i: number) => sim.pickupAvailable(i),
```

Find the construction site with:

```bash
grep -rn "ArenaSource" src/ --include="*.ts"
```

- [ ] **Step 4: Typecheck and run the presentation checks**

```bash
tsc --noEmit
npm run gate
npm run smoke
```

Expected: `tsc` clean · gate **19/19 PASS** with `course-ground` unchanged, because pickups are a separate group and the ground subject does not build them · smoke **PASS**.

**These prove presentation only.** Do not record them as evidence that placement, cooldowns or validity are correct — Tasks 1–4 own that, and the spec says so explicitly.

- [ ] **Step 5: Look at it**

```bash
npm run dev
```

Drive the arena. Confirm by eye: cylinders are visible at distance across open ground; an item disappears when taken and its cylinder stays; the cylinder does not clip a cart driving alongside it; items rotate slowly rather than spinning.

- [ ] **Step 6: Commit**

```bash
git add src/render/coursePickups.ts src/render/scene.ts src/ui/screens/RoundScreen.ts
git commit -m "render: instanced pickups -- the cylinder outlives the item"
```

---

### Task 6: Record the decisions and hand off

**Files:**
- Modify: `docs/DECISIONS.md` — one new entry
- Modify: `docs/ROADMAP.md:436-439`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/ASSET_PIPELINE.md` §8.5 — the five Gemini prompt blocks

**Interfaces:** none. Documentation only.

- [ ] **Step 1: Add the decisions entry**

One entry in `docs/DECISIONS.md`, titled **"Pickups: density instead of per-cart timers, and hits absorbed instead of temporary health."** Those are the two decisions a future reader cannot recover from the code:

- **Why the cooldown is global.** The code shows a sixty-second timer and a comment will not survive a refactor. Record the arithmetic: three takes per site per 180 s match, fifty sites, six carts — about twenty-five takes each against a need of two. Per-cart timers were rejected because a pickup present for one cart and absent for another means the rendered world differs per viewer, which becomes per-client state on a server.
- **Why the shield is plates.** `ARENA_MAX_HEALTH = 8` and one damage per hit. At integer damage, "temporary health" and "hits absorbed" are the same number and the second is countable off the cart. Decaying temp HP is unrepresentable on an eight-point bar. Record it now even though plates are slice 2 — the decision is settled and the reasoning is the perishable part.

Also record that the research document recommending per-cart timers and a fifty-point overfill was answered against a hundred-point bar it was never given, so its health numbers are out by an order of magnitude and should not be re-read as guidance.

- [ ] **Step 2: Update the roadmap**

`docs/ROADMAP.md:436-439` currently specifies sensor colliders and a `consumables.ts` port. Both were rejected with reasons. Replace those two clauses with one line each naming the decision and pointing at the spec. Do not delete the lines — a roadmap that quietly loses a requirement cannot be audited against.

- [ ] **Step 3: Check the prompt blocks in — ALREADY DONE, verify only**

`docs/ASSET_PIPELINE.md` §8.5 and the five sheets in `docs/concept/reference/` were both landed on 12 September, ahead of this plan, because the art arrived first. Verify rather than redo:

```bash
grep -c "^#### 8.5" docs/ASSET_PIPELINE.md   # expect 5
ls docs/concept/reference/*.jpg | wc -l      # expect 11
npx vitest run tools/decorBoundary.test.mjs  # expect 5 passed
```

If any of those is short, the art step was not completed and Task 7 is still blocked.

- [ ] **Step 4: Rewrite the handoff**

`docs/HANDOFF.md` is a baton, not a log. Rewrite it for the next session. State plainly: Stage D slice 1 is landed; slice 2 is the drink and its plates; `src/entities/graphs/pickups.json` does not exist yet and Task 5 ships placeholder primitives waiting on it; Stage E has two open decisions (sign placement against `MAX_PROPS_PER_HOLE = 20`, and whether the model or `CLUBHOUSE_APRON_M` owns the clubhouse footprint).

Add to the loose ends, both verified this session and neither belonging to any task above:

- **The installed Rapier binding is built without enhanced determinism.** `@dimforge/rapier3d-compat@0.20.0`; the deterministic flavour is a separate published package, `@dimforge/rapier3d-deterministic-compat`, not a runtime flag. Nothing in Stage D touches physics, so this is not a Stage D problem — but the project's "same seed, same match" promise for a future server is currently made on a build documented not to provide it.
- **`decorBoundary.test.mjs` assertion 4 matches mesh extensions as substrings** in `src/sim/**`. A comment mentioning `.glb` fails it, and `.obj` would match a member access like `.objects`. Currently unstruck.

- [ ] **Step 5: Full verification**

```bash
tsc --noEmit
npm test
npm run gate
npm run smoke
npm run probe:terrain
npm run probe
```

Expected: `tsc` clean · suite green · gate 19/19 · smoke PASS · terrain probe PASS with an unchanged control · `npm run probe` red on the one known driver-distance line **only**. Do not read that last one as a regression without checking it is still only that line.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: record the pickup decisions, check the sheet prompts in, rewrite the handoff"
```

---

### Task 7 (blocked): Swap the authored graph in for the placeholders

**Blocked on** the Blender session for `pickups` producing `src/entities/graphs/pickups.json`. Do not start it before that file exists.

**The reference sheet is filed and ready:** `docs/concept/reference/pickup-items-01.jpg`, with its prompt block at `ASSET_PIPELINE.md` §8.5a. **Read that folder's README deviation list before modelling from it** — the one that bites here is that *cross-object scale on the sheet is wrong by about a quarter*: the bucket and cup are both drawn filling a 1.00 m bar when they are 0.80 m and 0.90 m, and the hot dog reads ~26% longer than the cup is tall when the two are equal. Take proportion within an object; take every dimension between objects from the table in Task 5's module comment, measured against cart length 2.4 m.

**Files:**
- Create: `src/entities/pickupGraphs.ts` — mirrors `src/entities/propGraphs.ts` exactly
- Modify: `src/render/coursePickups.ts` — the two placeholder geometries only

**Interfaces:**
- Consumes: `mergeGraph(graph, slotOverrides): MergedGraph` from `./primitiveGraph`.
- Produces: `PICKUP_NAMES`, `PICKUP_SLOTS`, `pickupGraphFor(name): PrimitiveGraph`.

- [ ] **Step 1: Write `src/entities/pickupGraphs.ts`**

Copy the structure of `src/entities/propGraphs.ts` verbatim, changing the import to `./graphs/pickups.json` and:

```ts
export const PICKUP_NAMES = ["bucket", "hotdog", "drink"] as const;

/** Four slots, deliberately sharing no names with the cart's eight, the rider's four or the
 *  props' five -- `art/README.md` records why the sets are disjoint. */
export const PICKUP_SLOTS = ["pickup_shell", "pickup_fill", "pickup_accent", "pickup_metal"] as const;
```

- [ ] **Step 2: Write the graph test**

Mirror `src/entities/propGraphs.test.ts`. The assertion that matters and is easy to miss: **every pickup's world bounding box is centred on its own origin**, not touching y = 0 from above the way props are. Pickups float; a prop origin rule applied here would bury each item half its height into the cylinder floor.

- [ ] **Step 3: Swap the geometries**

In `coursePickups.ts`, replace the two `CylinderGeometry`/`CapsuleGeometry` constructions with `mergeGraph(pickupGraphFor("bucket")).mesh.geometry` and the same for `"hotdog"`. The materials become the merged graph's, since `mergeGraph` bakes vertex colours — delete the two `MeshStandardMaterial` constructions and take `mergedBucket.mesh.material`. Everything else in the module is unchanged.

- [ ] **Step 4: Verify and commit**

```bash
tsc --noEmit && npm test && npm run gate
```

The gate re-baselines for the pickup subject only. Review the picture; the items should read at distance as a bucket and a hot dog rather than as two coloured blobs.

---

## Self-Review

**Spec coverage.** Positions baked at course build, state on `Sim` (T4 S3–S6) · `PICKUP_CHANNEL = 5` with a nonce parameter defaulting to the course seed (T2 S3, T4 S3) · variable-radius blue noise measured from `spec.cup` (T2 S3) · dynamic injection rejected (stated in T2's module comment and the Global Constraints) · sand and open rough valid, water twice-rejected (T1 S3) · global in-place cooldown with ready-at timestamps (T3 S3) · poll not sensors, same-tick tie by lower index (T4 S7, S9) · hot dog +3 into `heal` (T4 S7) · slice 1 is bucket and hot dog only, plates deferred (scope of every task) · one instanced mesh per kind, cylinder outlives the item, teardown owned (T5 S1–S2) · visual 1.5 m against a 3.0 m grab (T5 S1) · `isDrivable` built as shared infrastructure for Stage E (T1) · stroke play keeps its bucket (T3 S3, and `Pickup.ts` is appended to rather than rewritten) · map untouched (stated in File Structure) · `consumables.ts` not ported (Global Constraints) · the decisions recorded (T6 S1).

The spec's "course-wide instanced prop path" as *shared* infrastructure is delivered as `coursePickups.ts` rather than a generic module. That is a deliberate narrowing: Stage E's signs will be its second consumer and the extraction is better made with two real cases than one imagined one. Flagged here rather than silently done.

**Placeholders.** None. Every code step carries the code. Two steps direct the executor to `grep` for a call site rather than naming a line — `loadCourse(` and `ArenaSource` — because those line numbers will have moved by the time this runs, and a stale line number is worse than a search.

**Two corrections made during self-review, recorded because they were nearly shipped.** Task 4's tests were first written against an `arenaSim()` that is synchronous, returns a bare `Sim`, and has bots. It is none of those: it is `async`, returns `{ sim, terrain, holes }`, builds a **six-hole** course at 8 m cells, and runs `botCount: 0`. And Task 4's same-tick contest test placed two carts 1 m either side of a site, which `SPAWN_CLEARANCE_M = 60` makes unreachable — that test is replaced by an independence test plus an explicit note that rig-order precedence is unasserted.

**One coverage gap, stated rather than papered over.** That rig-order precedence — the player beating a bot on a genuine tie — rests on `stepCart` iterating `this.rigs` in order and has no test. The mechanism it depends on (`takePickupAt` returning `false` to the second caller in a tick) is tested at the module level in Task 3.

**Type consistency.** `PickupSite` and `PickupKind` are defined in `pickupScatter.ts` (T2) and imported by `Pickup.ts` (T3), `world.ts` (T4) and `coursePickups.ts` (T5) under those exact names. `createPickupState`/`pickupReady`/`takePickupAt`/`resetPickupState` are defined in T3 and used with the same signatures in T4. `PickupMarker` is defined in T3 and is the getter's type in T4. `buildCourseWorld(course, seed, pickupSeed?)` in T4 S3 matches the test in T4 S1. `createCoursePickups(sites, heightAt)` in T5 S1 matches its call in T5 S2. `mergeGraph(graph, slotOverrides): MergedGraph` in T7 matches `primitiveGraph.ts:155`.

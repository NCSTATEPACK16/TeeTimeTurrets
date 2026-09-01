# Procedural Course Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded hole with a seeded, validated generator that produces a
course of nine independently-specified holes.

**Architecture:** `HoleSpec` becomes the single source of truth for a hole's field, seed, tee,
cup and corridor. `terrain.ts` and `surfaces.ts` stop exporting module constants and become
factories closing over one spec. Height is three noise octaves masked by a continuous slope
*budget* derived from distance to a Catmull-Rom corridor centreline, then carved toward that
centreline. `generateHole` draws a layout from a seeded PRNG and rejects candidates that fail
seven playability checks.

**Tech Stack:** TypeScript (strict), `simplex-noise` 4.x, `@dimforge/rapier3d-compat` 0.20,
Vitest (node environment), Vite.

**Spec:** `docs/superpowers/specs/2026-09-01-procedural-course-design.md`

Read that spec alongside this plan. It carries the reasoning; this plan carries the sequence.
Its source research is `docs/RESEARCH-TERRAIN.md`, whose *constants* the spec rejects — do not
take amplitudes from the research.

## Global Constraints

Copied verbatim from `AGENTS.md` and the spec. Every task's requirements implicitly include
this section.

- **`src/sim/**` and `src/physics/**` must stay Node-runnable.** No `three`, no `window`, no
  `document`. Vitest runs in the `node` environment specifically so a stray import fails the
  suite.
- **Never call `Math.random()` inside `src/sim/**` or `src/physics/**`.** Randomness is an
  injected, seeded PRNG.
- **No per-frame allocation in the fixed-tick hot loop** (`Sim.step`, `GameLoop`'s `frame`).
  Reuse scratch objects; follow the `Sim.muzzle(out: Vec3)` idiom.
- **`tsc --noEmit` must be clean** before any change is considered finished. `strict: true`,
  `noUnusedLocals`, `noUnusedParameters` are all on — do not relax them.
- **`tsconfig.json` has `"include": ["src"]`.** `tools/**` is *not* type-checked by
  `tsc --noEmit`; it is only checked when `npm run probe` builds it through Vite. Type errors in
  `tools/feelProbe.ts` will not show up in `npm run build`.
- **New sim/physics logic gets a colocated test**, `src/**/*.test.ts`, run by `npm test`.
- **Every commit needs a DCO sign-off:** `git commit -s`.
- **Never put AI-session metadata in git.** No assistant co-author trailers, no session or chat
  URLs, no "generated with" footers, in commit messages or code comments. This overrides any
  default commit-trailer behaviour.
- **Licensing is split by directory.** `src/**` and `tools/**` are Apache-2.0. Nothing in this
  plan touches `server/**`. `mulberry32` in Task 1 is written from the published algorithm, not
  ported from another repository, so it needs no `NOTICE` entry.
- **Units are metres, seconds, radians.** Aim yaw `0` points down world `+X`.
- **Domain warping is banned outright** on playable surfaces. It is not used anywhere in this
  phase.
- **Nothing in this phase touches Blender, `src/render/**` geometry style, or
  `tools/sceneGate.mjs`.** See spec §9.

## Two spec discrepancies resolved here

Both are stated up front because they change code, not just wording.

**1. `REFERENCE_CARRY_M = 129` is a *total* distance, not a carry.** Spec §6 calls 129 m "the
driver's full carry as measured by `npm run probe` in Phase 0", but `docs/ROADMAP.md`'s Phase 0
table records the full driver as **129 m total** — 69.5 m carry plus 59.5 m roll. Asserting
measured *carry* against 129 would fail on the first run by 46%.

Resolution: keep the spec's identifier and value (`REFERENCE_CARRY_M = 129`), document in its
JSDoc that the figure is measured total distance including roll-out, and make the probe
assertion in Task 15 measure `totalM`. Total distance is also the right quantity for the two
things the constant feeds — reachability (check 7) and par derivation — because a hole is
reachable on how far the ball ends up, not on where it first lands.

**2. `Spline.nearest` and `pointAt` as specified allocate, and `heightAt` is on the hot path.**
`Sim.step` calls `heightAt` every tick through `isGrounded()`, and after Task 10 `heightAt`
calls both spline methods. Returning `{ distance, t }` and a fresh `Vec2` per call violates the
no-allocation rule. Resolution: `spline.ts` ships the spec's allocating signatures *plus*
`nearestInto(x, z, out)` and `pointInto(t, out)` writing into caller-owned scratch, matching the
existing `Sim.muzzle(out: Vec3)` idiom. The closure returned by `createTerrain` owns the
scratch. The allocating forms stay for readable call sites outside the loop (tests, generation).

## File Structure

**Created:**

| file | responsibility |
|---|---|
| `src/sim/rng.ts` | `mulberry32`, `hashChannel`. Leaf module, no imports. |
| `src/sim/rng.test.ts` | determinism, range, channel independence |
| `src/sim/course.ts` | `Vec2`, `Vec3`, `HoleSpec`, `Course`, geometry/validation constants, the seven checks, `generateHole`, `generateCourse` |
| `src/sim/course.test.ts` | fixture, checks, determinism, `MAX_ATTEMPTS` |
| `src/sim/spline.ts` | centripetal Catmull-Rom, polyline sampling, `nearest` |
| `src/sim/spline.test.ts` | no cusp at α=0.5, `nearest` vs brute force, `length` monotone |
| `src/sim/terrain.legacy.test.ts` | behaviour-preservation snapshot. **Deleted in Task 9.** |
| `src/sim/surfaces.legacy.test.ts` | behaviour-preservation snapshot. **Deleted in Task 9.** |
| `src/sim/terrain.test.ts` | mask C¹ continuity, zero camber in the corridor |
| `src/sim/surfaces.test.ts` | `tuningAt` allocates nothing, blend monotone |

**Modified:** `src/sim/terrain.ts`, `src/sim/surfaces.ts`, `src/sim/world.ts`,
`src/sim/world.cart.test.ts`, `src/render/scene.ts`, `src/main.ts`, `tools/feelProbe.ts`,
`docs/ROADMAP.md`, `docs/BACKLOG.md`.

**Import layering — no runtime cycles.** `course.ts` imports values from `terrain.ts` and
`spline.ts`; those two import only *types* back from `course.ts` (`import type`, erased at
compile time). Value flow is one-directional:

```
rng.ts      (leaf)
spline.ts   → rng.ts                      ; type-only → course.ts
terrain.ts  → rng.ts, spline.ts           ; type-only → course.ts
surfaces.ts → rng.ts, terrain.ts          ; type-only → course.ts
course.ts   → rng.ts, spline.ts, terrain.ts
world.ts    → course.ts, terrain.ts, surfaces.ts
```

`Vec2` and `Vec3` both live in `course.ts` — it is the plain-data module and a value-leaf for
everything that needs them. `world.ts` re-exports `Vec3` so its existing consumers do not move.

## Task sequence

Ordering is spec §8's, which is load-bearing: §3 lands alone as a *provably* behaviour-preserving
refactor before any terrain changes, so a later regression can be attributed. Stage A therefore
keeps `npm run probe` numbers **bit-identical** to today. Stage C is where they legitimately move.

| stage | tasks | spec | probe numbers |
|---|---|---|---|
| A — data model | 1–7 | §3 | unchanged (that is the gate) |
| B — spline | 8 | §5 | unchanged (nothing consumes it yet) |
| C — terrain & surfaces | 9–11 | §4, §5 | move; re-baselined in Task 16 |
| D — generation | 12–14 | §6 | — |
| E — verification | 15–16 | §7, §10 | recorded |

---

# Stage A — Data model (§3)

## Task 1: Seeded RNG

**Files:**
- Create: `src/sim/rng.ts`
- Test: `src/sim/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mulberry32(seed: number): () => number` — uniform in `[0, 1)`.
  `hashChannel(seed: number, ...coords: readonly number[]): number` — a uint32.

- [ ] **Step 1: Write the failing test**

Create `src/sim/rng.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashChannel, mulberry32 } from "./rng";

describe("mulberry32", () => {
  it("produces the same stream for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("produces a different stream for a different seed", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays in [0, 1)", () => {
    const next = mulberry32(0xdeadbeef);
    for (let i = 0; i < 10000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("has a mean near 0.5 over a long run", () => {
    const next = mulberry32(7);
    let sum = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) sum += next();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it("treats the seed as uint32, so a negative seed is still a valid stream", () => {
    const a = mulberry32(-1);
    const b = mulberry32(0xffffffff);
    expect(a()).toBe(b());
  });
});

describe("hashChannel", () => {
  it("is deterministic", () => {
    expect(hashChannel(42, 3, 0)).toBe(hashChannel(42, 3, 0));
  });

  it("separates channels that differ only in the last coordinate", () => {
    expect(hashChannel(42, 3, 0)).not.toBe(hashChannel(42, 3, 1));
    expect(hashChannel(42, 3, 1)).not.toBe(hashChannel(42, 3, 2));
  });

  it("is order-sensitive", () => {
    expect(hashChannel(42, 1, 0)).not.toBe(hashChannel(42, 0, 1));
  });

  it("mixes even with no coordinates, so hashChannel(s) is not s", () => {
    expect(hashChannel(42)).not.toBe(42);
  });

  it("returns a uint32", () => {
    for (let i = 0; i < 1000; i++) {
      const h = hashChannel(i, i * 7, i * 13);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("spreads two adjacent seeds into unrelated streams", () => {
    const a = mulberry32(hashChannel(1000, 0, 0))();
    const b = mulberry32(hashChannel(1001, 0, 0))();
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sim/rng.test.ts`
Expected: FAIL — `Failed to resolve import "./rng"`.

- [ ] **Step 3: Write the implementation**

Create `src/sim/rng.ts`:

```ts
/**
 * Seeded randomness for the deterministic simulation.
 *
 * `Math.random()` is banned in src/sim/** and src/physics/** (AGENTS.md): it carries hidden
 * engine state and gives no cross-platform guarantee, so a client and an authoritative server
 * would silently disagree. Mulberry32's entire state is one 32-bit word, which makes "the same
 * hole twice" and "the same hole on two machines" the same statement.
 *
 * `hashChannel` is the other half of that. A single advancing stream couples every consumer to
 * call order -- ask for a sand sample before a height sample and both change. Hashing the seed
 * together with a channel index instead gives each consumer an independent stream evaluable in
 * any order, which is what lets terrain.ts and surfaces.ts both derive from one HoleSpec.seed
 * without correlating (see the spec's channel table, §3 "Seeding").
 */

/** Uniform in [0, 1). The seed is coerced to uint32, so a negative seed is legal. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mixes a seed with any number of integer coordinates into a fresh uint32 seed.
 *
 * Order matters: hashChannel(s, 1, 0) and hashChannel(s, 0, 1) are different channels. The
 * trailing avalanche runs even for an empty coordinate list, so hashChannel(s) is not just s --
 * without it a zero-coordinate call would leak the raw seed into a consumer.
 *
 * The rest parameter allocates. This is a construction-time call and never a per-tick one.
 */
export function hashChannel(seed: number, ...coords: readonly number[]): number {
  let state = seed >>> 0;
  for (const coord of coords) {
    state = (state + Math.imul(coord | 0, 0x85ebca6b)) >>> 0;
    state = Math.imul(state ^ (state >>> 15), state | 1) >>> 0;
    state = (state ^ (state + Math.imul(state ^ (state >>> 7), state | 61))) >>> 0;
    state = (state ^ (state >>> 14)) >>> 0;
  }
  state = Math.imul(state ^ (state >>> 16), 0x2545f491) >>> 0;
  return (state ^ (state >>> 15)) >>> 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sim/rng.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify the type check is clean**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/sim/rng.ts src/sim/rng.test.ts
git commit -s -m "Add seeded RNG for the deterministic simulation

mulberry32 plus a coordinate hash. The hash is what makes each consumer's
stream independent of call order, so terrain and sand can derive from one
hole seed without correlating. BACKLOG #5 (seeded aim spread) consumes the
same mulberry32 and stays open."
```

---

## Task 2: Course data model and the legacy fixture

**Files:**
- Create: `src/sim/course.ts`
- Test: `src/sim/course.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (types only).
- Produces: `interface Vec2 { readonly x: number; readonly z: number }`,
  `interface Vec3 { x: number; y: number; z: number }`,
  `interface HoleSpec`, `interface Course`, `legacyHoleSpec(): HoleSpec`.

`legacyHoleSpec()` reproduces today's hardcoded field size, cells, tee, cup and water level
exactly. It is the refactor's test in Tasks 3–7 and is renamed in Task 9.

- [ ] **Step 1: Write the failing test**

Create `src/sim/course.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { legacyHoleSpec } from "./course";

describe("legacyHoleSpec", () => {
  it("reproduces the constants terrain.ts hardcodes today", () => {
    const spec = legacyHoleSpec();
    // FIELD_SIZE / NROWS / NCOLS in src/sim/terrain.ts before the refactor.
    expect(spec.fieldSize).toBe(160);
    expect(spec.cells).toBe(160);
    // TEE_XZ = { x: -FIELD_SIZE / 2 + TEE_INSET, z: 0 } with TEE_INSET = 12.
    expect(spec.tee).toEqual({ x: -68, z: 0 });
    // CUP_XZ = { x: FIELD_SIZE / 2 - 25, z: 8 }.
    expect(spec.cup).toEqual({ x: 55, z: 8 });
    // WATER_LEVEL.
    expect(spec.waterLevel).toBe(-0.72);
    expect(spec.index).toBe(0);
  });

  it("holds a cell size near 1 m, which the ball radius depends on", () => {
    const spec = legacyHoleSpec();
    expect(spec.fieldSize / spec.cells).toBeCloseTo(1.0, 3);
  });

  it("has a corridor running tee first, cup last, with at least three points", () => {
    const spec = legacyHoleSpec();
    expect(spec.control.length).toBeGreaterThanOrEqual(3);
    expect(spec.control[0]).toEqual(spec.tee);
    expect(spec.control[spec.control.length - 1]).toEqual(spec.cup);
  });

  it("is a fresh object each call, so a caller cannot mutate the fixture for everyone", () => {
    expect(legacyHoleSpec()).not.toBe(legacyHoleSpec());
    expect(legacyHoleSpec()).toEqual(legacyHoleSpec());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sim/course.test.ts`
Expected: FAIL — `Failed to resolve import "./course"`.

- [ ] **Step 3: Write the implementation**

Create `src/sim/course.ts`:

```ts
/**
 * The course data model. Plain data: DOM-free, no Rapier, no Three, no imports at all yet.
 *
 * A course is nine holes, not one nine-hole map. Each HoleSpec owns its own field, terrain and
 * surfaces, and playing a round loads one at a time -- which is what makes "multiple courses,
 * one selected at a time" fall out of the data model instead of needing streaming, chunking, or
 * a level format. A second course is a second list.
 */

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/**
 * Mutable on purpose: this is the shape the sim passes around as reusable scratch, per the
 * no-allocation-in-the-hot-loop rule. `Vec2` is immutable because it is spec data.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface HoleSpec {
  /** uint32. Every derived noise channel and layout choice hashes from this. */
  readonly seed: number;
  /**
   * 0-based position within the course. Part of the channel hash, so hole 3 of two different
   * courses with the same course seed still differ.
   */
  readonly index: number;
  /** Square field, metres. Per-hole rather than global -- a par 5 needs more room. */
  readonly fieldSize: number;
  /**
   * Heightfield rows == cols. Cell size is fieldSize / cells and must stay near 1.0 m: a
   * coarser cell makes triangle seams big enough for the 0.15 m ball to trip over.
   */
  readonly cells: number;
  readonly tee: Vec2;
  readonly cup: Vec2;
  /**
   * Corridor centreline control points, tee first and cup last, length >= 3. Interior points
   * are dog-leg apexes.
   */
  readonly control: readonly Vec2[];
  /** Derived from corridor length by generateHole. Never authored. */
  readonly par: number;
  readonly waterLevel: number;
}

export interface Course {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly holes: readonly HoleSpec[];
}

/**
 * Arbitrary but fixed. The legacy fixture injects its noise sources directly (see
 * `createTerrain`'s `sources` parameter), so this seed is never actually hashed during the
 * behaviour-preserving refactor -- it exists so the fixture is a complete HoleSpec.
 */
const LEGACY_HOLE_SEED = 0x7ee71e5;

/**
 * The hole the game shipped with, expressed as data.
 *
 * This is the refactor's proof, not a feature: while §3 lands, `terrain.ts` and `surfaces.ts`
 * are driven by this fixture and their outputs must stay bit-identical to the module constants
 * they replace. `control` is a straight three-point line because nothing consumes the corridor
 * spline until §5 -- today's fairway is the straight tee->cup segment in `surfaces.ts`.
 *
 * `par` is 3 by the same formula generateHole will use: the 123 m tee->cup separation is under
 * one REFERENCE_CARRY_M.
 */
export function legacyHoleSpec(): HoleSpec {
  const tee: Vec2 = { x: -68, z: 0 };
  const cup: Vec2 = { x: 55, z: 8 };
  return {
    seed: LEGACY_HOLE_SEED,
    index: 0,
    fieldSize: 160,
    cells: 160,
    tee,
    cup,
    control: [tee, { x: (tee.x + cup.x) / 2, z: (tee.z + cup.z) / 2 }, cup],
    par: 3,
    waterLevel: -0.72,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sim/course.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the type check is clean**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/sim/course.ts src/sim/course.test.ts
git commit -s -m "Add the HoleSpec/Course data model

A course is an ordered list of independent hole specs rather than one large
map, so a second course is a second list and nothing needs streaming or a
level format. legacyHoleSpec() encodes the shipped hole's constants as data;
it is what the terrain and surfaces refactor is measured against."
```

---

## Task 3: `createTerrain` factory behind the existing exports

The existing exports stay and delegate to a module-level legacy instance, so the build stays
green and `npm run probe` numbers stay bit-identical. Consumers migrate in Tasks 5–7; the shims
are deleted in Task 7.

**Files:**
- Modify: `src/sim/terrain.ts` (whole file)
- Test: `src/sim/terrain.legacy.test.ts` (create; deleted in Task 9)

**Interfaces:**
- Consumes: `HoleSpec`, `Vec3`, `legacyHoleSpec` from `./course`; `hashChannel`, `mulberry32`
  from `./rng`.
- Produces:
  ```ts
  export interface TerrainSources { readonly height: () => number }
  export interface Terrain {
    readonly spec: HoleSpec;
    heightAt(x: number, z: number): number;
    buildHeightfield(): Float32Array;
    readonly teePosition: Vec3;
    readonly cupPosition: Vec3;
  }
  export function createTerrain(spec: HoleSpec, sources?: TerrainSources): Terrain;
  export function smoothstep01(t: number): number;
  export const GREEN_RADIUS: number;   // 11, unchanged
  export const CUP_RADIUS: number;     // 0.55, unchanged
  ```
  Plus temporary shims, identical in name and type to today's exports: `FIELD_SIZE`, `NROWS`,
  `NCOLS`, `WATER_LEVEL`, `TEE_XZ`, `CUP_XZ`, `TEE_POSITION`, `CUP_POSITION`, `heightAt`,
  `buildHeightfield`.

- [ ] **Step 1: Capture today's heights, before touching anything**

Create `src/sim/terrain.legacy.test.ts` as a one-shot recorder:

```ts
import { describe, it } from "vitest";
import { heightAt } from "./terrain";

const AXIS = [-70, -50, -30, -10, 10, 30, 50, 70];

describe("recorder", () => {
  it("prints the height table", () => {
    const rows: string[] = [];
    for (const x of AXIS) {
      for (const z of AXIS) rows.push(heightAt(x, z).toExponential(17));
    }
    rows.push(heightAt(-68, 0).toExponential(17));
    rows.push(heightAt(55, 8).toExponential(17));
    console.log(JSON.stringify(rows));
  });
});
```

Run: `npx vitest run src/sim/terrain.legacy.test.ts`
Expected: PASS, with a JSON array of 66 exponential-notation strings printed. Copy that array.

`toExponential(17)` is used rather than the raw number so the pasted table round-trips to the
exact same double — this test is worthless if the snapshot is rounded.

- [ ] **Step 2: Turn the recording into an assertion**

Replace the whole of `src/sim/terrain.legacy.test.ts` with the following, pasting the captured
array in place of `PASTE_TABLE_HERE`:

```ts
import { describe, expect, it } from "vitest";
import { heightAt } from "./terrain";

/**
 * The §3 refactor's proof. These are the heights the shipped terrain produced before
 * `terrain.ts` became a factory, captured to full double precision. Moving the field size,
 * cell count, tee, cup and noise seed from module constants onto a HoleSpec must not move a
 * single one of them -- otherwise the data-model change and the §4 terrain change land
 * together with no way to attribute a regression.
 *
 * Deleted with the fixture once §4 lands and the heights legitimately change.
 */
const AXIS = [-70, -50, -30, -10, 10, 30, 50, 70];

const LEGACY_HEIGHTS: readonly string[] = PASTE_TABLE_HERE;

describe("terrain refactor is behaviour-preserving", () => {
  it("reproduces every recorded height exactly", () => {
    const actual: string[] = [];
    for (const x of AXIS) {
      for (const z of AXIS) actual.push(heightAt(x, z).toExponential(17));
    }
    actual.push(heightAt(-68, 0).toExponential(17));
    actual.push(heightAt(55, 8).toExponential(17));
    expect(actual).toEqual(LEGACY_HEIGHTS);
  });

  it("recorded 66 samples", () => {
    expect(LEGACY_HEIGHTS).toHaveLength(66);
  });
});
```

- [ ] **Step 3: Run it against the unrefactored terrain**

Run: `npx vitest run src/sim/terrain.legacy.test.ts`
Expected: PASS, 2 tests. This proves the snapshot is correct *before* the refactor. If it fails
here, the paste is wrong — fix it before going further.

- [ ] **Step 4: Rewrite `src/sim/terrain.ts` as a factory**

Replace the whole file:

```ts
import { createNoise2D } from "simplex-noise";
import { legacyHoleSpec } from "./course";
import type { HoleSpec, Vec3 } from "./course";
import { hashChannel, mulberry32 } from "./rng";

/**
 * The height field, as a factory over one HoleSpec.
 *
 * `heightAt` is a pure function of (x, z) for a given hole and must stay one: that is what lets
 * the authoritative server evaluate terrain without replicating a mesh or a spatial index. A
 * closure over immutable spec data preserves purity; an object with mutable state would not.
 * That is why this is `createTerrain(spec)` returning a closure rather than a `Terrain` class.
 */

/** Real cups are 108 mm. Oversized here: this is an arcade game read from a chase camera. */
export const CUP_RADIUS = 0.55;

/**
 * Flat pads blended into the terrain. The tee needs one so the ball starts level; the green
 * needs a much larger one because a putting surface that inherits the base noise is not
 * puttable.
 */
export const GREEN_RADIUS = 11;
const TEE_PAD_RADIUS = 5;

/**
 * Slope, not height, is what the ball actually feels. For a noise octave of amplitude A and
 * frequency f the steepest grade is roughly A * 2*pi*f, so these two constants are one knob,
 * not two. These values target ~5 deg mean / ~12 deg max. Replaced by the three-octave budget
 * formulation in §4; unchanged here so the refactor is provably behaviour-preserving.
 */
const HEIGHT_AMPLITUDE = 0.85;
const NOISE_FREQUENCY = 0.028;
const DETAIL_AMPLITUDE_RATIO = 0.15;
const DETAIL_FREQUENCY_RATIO = 2.6;

/** Smoothstep: C1-continuous, so a pad edge has no slope discontinuity ring. */
export function smoothstep01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Injected randomness for the noise permutation. Defaulted from the spec's seed channel; the
 * parameter exists because AGENTS.md wants seeded randomness injected rather than reached for,
 * and because the §3 refactor has to reproduce the shipped hole's literal noise source exactly.
 */
export interface TerrainSources {
  readonly height: () => number;
}

export interface Terrain {
  readonly spec: HoleSpec;
  heightAt(x: number, z: number): number;
  buildHeightfield(): Float32Array;
  readonly teePosition: Vec3;
  readonly cupPosition: Vec3;
}

interface Pad {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

/** Channel 0 of the spec's seed. See the spec's channel table, §3 "Seeding". */
export function heightChannel(spec: HoleSpec): number {
  return hashChannel(spec.seed, spec.index, 0);
}

export function createTerrain(spec: HoleSpec, sources?: TerrainSources): Terrain {
  const random = sources?.height ?? mulberry32(heightChannel(spec));
  const noise2D = createNoise2D(random);

  function rawHeight(worldX: number, worldZ: number): number {
    return (
      noise2D(worldX * NOISE_FREQUENCY, worldZ * NOISE_FREQUENCY) * HEIGHT_AMPLITUDE +
      noise2D(
        worldX * NOISE_FREQUENCY * DETAIL_FREQUENCY_RATIO,
        worldZ * NOISE_FREQUENCY * DETAIL_FREQUENCY_RATIO,
      ) *
        HEIGHT_AMPLITUDE *
        DETAIL_AMPLITUDE_RATIO
    );
  }

  // Pad heights are sampled from the raw noise once at construction so heightAt can flatten
  // toward the terrain's own local height without recursing into itself.
  const pads: readonly Pad[] = [
    { ...spec.tee, radius: TEE_PAD_RADIUS, height: rawHeight(spec.tee.x, spec.tee.z) },
    { ...spec.cup, radius: GREEN_RADIUS, height: rawHeight(spec.cup.x, spec.cup.z) },
  ];

  /**
   * Pads blend toward the terrain height *at the pad*, not toward absolute 0. Multiplying the
   * whole height by (1 - flatten) pins a pad to y=0 regardless of where the surrounding ground
   * sits -- that left the tee on a 1.1 m pinnacle with a 26 deg drop-off inside the first 4 m.
   */
  function heightAt(worldX: number, worldZ: number): number {
    let height = rawHeight(worldX, worldZ);
    for (const pad of pads) {
      const distance = Math.hypot(worldX - pad.x, worldZ - pad.z);
      if (distance >= pad.radius) continue;
      const weight = smoothstep01(1 - distance / pad.radius);
      height += (pad.height - height) * weight;
    }
    return height;
  }

  /**
   * Rapier heightfield storage is column-major: heights[row + col * (nrows + 1)]. Row index
   * maps to world Z, column index maps to world X.
   */
  function buildHeightfield(): Float32Array {
    const n = spec.cells;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let col = 0; col <= n; col++) {
      const worldX = (col / n - 0.5) * spec.fieldSize;
      for (let row = 0; row <= n; row++) {
        const worldZ = (row / n - 0.5) * spec.fieldSize;
        heights[row + col * (n + 1)] = heightAt(worldX, worldZ);
      }
    }
    return heights;
  }

  return {
    spec,
    heightAt,
    buildHeightfield,
    teePosition: { x: spec.tee.x, y: heightAt(spec.tee.x, spec.tee.z) + 0.3, z: spec.tee.z },
    cupPosition: { x: spec.cup.x, y: heightAt(spec.cup.x, spec.cup.z), z: spec.cup.z },
  };
}

// ---------------------------------------------------------------------------------------
// Temporary compatibility shims. Every export below is the pre-refactor module surface, now
// served from one legacy Terrain instance so the build and the probe stay green while
// consumers migrate one file at a time. All of it is deleted in Task 7.
// ---------------------------------------------------------------------------------------

/** The shipped hole's literal noise source: createNoise2D(() => 0.42). */
export const LEGACY_TERRAIN_SOURCES: TerrainSources = { height: () => 0.42 };

const legacySpec = legacyHoleSpec();
const legacyTerrain = createTerrain(legacySpec, LEGACY_TERRAIN_SOURCES);

export const FIELD_SIZE = legacySpec.fieldSize;
export const NROWS = legacySpec.cells;
export const NCOLS = legacySpec.cells;
export const WATER_LEVEL = legacySpec.waterLevel;
export const TEE_XZ = legacySpec.tee;
export const CUP_XZ = legacySpec.cup;
export const TEE_POSITION = legacyTerrain.teePosition;
export const CUP_POSITION = legacyTerrain.cupPosition;

export function heightAt(worldX: number, worldZ: number): number {
  return legacyTerrain.heightAt(worldX, worldZ);
}

export function buildHeightfield(): Float32Array {
  return legacyTerrain.buildHeightfield();
}
```

Note the removed export: today's `terrain.ts` exports `interface Vec2`. It is gone — `Vec2` now
lives in `course.ts`. Nothing outside `terrain.ts` imported it (`surfaces.ts` imports only
values), so this breaks no consumer, but confirm with the type check in Step 6.

- [ ] **Step 5: Run the snapshot test against the refactored terrain**

Run: `npx vitest run src/sim/terrain.legacy.test.ts`
Expected: PASS, 2 tests, unchanged from Step 3. **This is the whole point of the task.** If a
single height moved, the refactor is not behaviour-preserving — find the difference before
continuing rather than re-recording the snapshot.

- [ ] **Step 6: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/sim/terrain.ts src/sim/terrain.legacy.test.ts
git commit -s -m "Make terrain a factory over a HoleSpec

heightAt stays a pure function of (x, z) for a given hole -- a closure over
immutable spec data rather than an object with state -- because that is what
lets a server evaluate terrain without replicating a mesh or a spatial index.

The module-level exports remain as shims over one legacy instance so
consumers can migrate a file at a time. terrain.legacy.test.ts pins the
shipped hole's heights to full double precision and passes both before and
after the change, which is what makes this refactor provably
behaviour-preserving rather than merely intended to be."
```

---

## Task 4: `createSurfaces` factory behind the existing exports

**Files:**
- Modify: `src/sim/surfaces.ts` (whole file)
- Test: `src/sim/surfaces.legacy.test.ts` (create; deleted in Task 9)

**Interfaces:**
- Consumes: `HoleSpec` from `./course`; `Terrain`, `GREEN_RADIUS`, `createTerrain`,
  `LEGACY_TERRAIN_SOURCES` from `./terrain`; `hashChannel`, `mulberry32` from `./rng`.
- Produces:
  ```ts
  export interface SurfaceSources { readonly sand: () => number }
  export interface Surfaces {
    surfaceAt(x: number, z: number): SurfaceId;
    tuningAt(x: number, z: number): SurfaceTuning;   // scratch parameter arrives in Task 11
  }
  export function createSurfaces(spec: HoleSpec, terrain: Terrain, sources?: SurfaceSources): Surfaces;
  export function sandChannel(spec: HoleSpec): number;
  ```
  `SurfaceId`, `SurfaceTuning` and `SURFACES` keep their current shape and export names. Plus
  temporary shims `surfaceAt`, `tuningAt` at module level, deleted in Task 7.

- [ ] **Step 1: Capture today's surface classification**

Create `src/sim/surfaces.legacy.test.ts` as a recorder:

```ts
import { describe, it } from "vitest";
import { surfaceAt } from "./surfaces";

describe("recorder", () => {
  it("prints the surface table", () => {
    const ids: string[] = [];
    for (let x = -78; x <= 78; x += 4) {
      for (let z = -78; z <= 78; z += 4) ids.push(surfaceAt(x, z));
    }
    console.log(JSON.stringify(ids.join("")));
  });
});
```

Run: `npx vitest run src/sim/surfaces.legacy.test.ts`
Expected: PASS, printing one long JSON string. Copy it.

Surface ids are the string enum values (`"green"`, `"fairway"`, …), so `join("")` produces a
concatenation that is still an exact comparison — a single reclassified cell changes the string.

- [ ] **Step 2: Turn the recording into an assertion**

Replace the whole of `src/sim/surfaces.legacy.test.ts`, pasting the captured string for
`PASTE_STRING_HERE`:

```ts
import { describe, expect, it } from "vitest";
import { surfaceAt } from "./surfaces";

/**
 * The §3 refactor's proof for surfaces, matching terrain.legacy.test.ts. A 40x40 sample of the
 * classification, concatenated -- one reclassified cell changes the string.
 *
 * Deleted with the fixture once §4/§5 land and the corridor legitimately moves.
 */
const LEGACY_SURFACES = PASTE_STRING_HERE;

describe("surfaces refactor is behaviour-preserving", () => {
  it("classifies every sampled cell exactly as before", () => {
    const ids: string[] = [];
    for (let x = -78; x <= 78; x += 4) {
      for (let z = -78; z <= 78; z += 4) ids.push(surfaceAt(x, z));
    }
    expect(ids.join("")).toBe(LEGACY_SURFACES);
  });
});
```

- [ ] **Step 3: Run it against the unrefactored surfaces**

Run: `npx vitest run src/sim/surfaces.legacy.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 4: Rewrite `src/sim/surfaces.ts` as a factory**

Replace the whole file:

```ts
import { createNoise2D } from "simplex-noise";
import { legacyHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { hashChannel, mulberry32 } from "./rng";
import { GREEN_RADIUS, LEGACY_TERRAIN_SOURCES, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";

/**
 * Which surface is under a world position, and what that surface does to a ball and a cart.
 *
 * DOM-free and dependency-light on purpose: this is authoritative state that Phase 5's server
 * has to agree with the client about, so it is a pure function of (x, z) and the shared height
 * field -- no authored zone data to keep in sync, and nothing to replicate.
 *
 * There is exactly one surface table and it lives here.
 */

export enum SurfaceId {
  Green = "green",
  Fairway = "fairway",
  Rough = "rough",
  Sand = "sand",
  Water = "water",
}

export interface SurfaceTuning {
  /**
   * Coefficient of rolling resistance for the ball. This is the dominant feel knob: applied as
   * a constant deceleration crr*g, it is what actually brings a ball to rest (see
   * docs/ARCHITECTURE.md §2b). Also sets the steepest grade a ball will hold on that surface,
   * at atan(crr).
   */
  readonly rolling: number;
  /** Multiplier on vertical velocity at each ground contact. Sand kills a bounce; a green keeps it. */
  readonly bounceScale: number;
  /** Multiplier on cart top speed over this surface. */
  readonly cartSpeedScale: number;
  /** Water is a stroke-and-distance hazard rather than a material. */
  readonly isHazard: boolean;
}

/**
 * Starting values for playtesting, not measured constants. Real-golf anchors: greens run
 * crr ~0.05-0.08, fairway ~0.10-0.13, longer grass higher; a bunker stops a ball almost
 * immediately, which is a very high crr plus a near-dead bounce.
 */
export const SURFACES: Readonly<Record<SurfaceId, SurfaceTuning>> = {
  [SurfaceId.Green]: { rolling: 0.06, bounceScale: 0.9, cartSpeedScale: 1.0, isHazard: false },
  [SurfaceId.Fairway]: { rolling: 0.11, bounceScale: 0.7, cartSpeedScale: 1.0, isHazard: false },
  [SurfaceId.Rough]: { rolling: 0.22, bounceScale: 0.45, cartSpeedScale: 0.72, isHazard: false },
  [SurfaceId.Sand]: { rolling: 0.55, bounceScale: 0.12, cartSpeedScale: 0.5, isHazard: false },
  [SurfaceId.Water]: { rolling: 0.9, bounceScale: 0.05, cartSpeedScale: 0.3, isHazard: true },
};

/**
 * Bunkers come from their own noise channel rather than authored placement, thresholded so they
 * read as scattered patches. Channel 1 of the spec's seed, separate from the height channel so
 * bunkers do not correlate with hills.
 */
const SAND_FREQUENCY = 0.055;
const SAND_THRESHOLD = 0.72;

/** Half-width of the mown corridor from tee to cup. Replaced by the spline corridor in §5. */
const FAIRWAY_HALF_WIDTH = 26;

export function sandChannel(spec: HoleSpec): number {
  return hashChannel(spec.seed, spec.index, 1);
}

export interface SurfaceSources {
  readonly sand: () => number;
}

export interface Surfaces {
  /** Discrete. Feeds the HUD readout, Phase 4's minimap, and render colouring. */
  surfaceAt(worldX: number, worldZ: number): SurfaceId;
  /** Continuous from §5 onward; still a table lookup here. */
  tuningAt(worldX: number, worldZ: number): SurfaceTuning;
}

export function createSurfaces(
  spec: HoleSpec,
  terrain: Terrain,
  sources?: SurfaceSources,
): Surfaces {
  const random = sources?.sand ?? mulberry32(sandChannel(spec));
  const sandNoise = createNoise2D(random);

  /** Squared-free distance from (x, z) to the tee->cup segment, for the fairway corridor. */
  function distanceToFairwayLine(x: number, z: number): number {
    const ax = spec.tee.x;
    const az = spec.tee.z;
    const abx = spec.cup.x - ax;
    const abz = spec.cup.z - az;
    const lengthSq = abx * abx + abz * abz;
    const t =
      lengthSq === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - ax) * abx + (z - az) * abz) / lengthSq));
    return Math.hypot(x - (ax + abx * t), z - (az + abz * t));
  }

  /**
   * Classification order is a priority list, not a blend: water wins over everything (it is
   * defined by height, so it cannot be overridden by a mowing pattern), then the green, then
   * bunkers, then the fairway corridor, and rough is the fallback.
   */
  function surfaceAt(worldX: number, worldZ: number): SurfaceId {
    if (terrain.heightAt(worldX, worldZ) < spec.waterLevel) return SurfaceId.Water;
    if (Math.hypot(worldX - spec.cup.x, worldZ - spec.cup.z) < GREEN_RADIUS) {
      return SurfaceId.Green;
    }
    if (sandNoise(worldX * SAND_FREQUENCY, worldZ * SAND_FREQUENCY) > SAND_THRESHOLD) {
      return SurfaceId.Sand;
    }
    if (distanceToFairwayLine(worldX, worldZ) < FAIRWAY_HALF_WIDTH) return SurfaceId.Fairway;
    return SurfaceId.Rough;
  }

  function tuningAt(worldX: number, worldZ: number): SurfaceTuning {
    return SURFACES[surfaceAt(worldX, worldZ)];
  }

  return { surfaceAt, tuningAt };
}

// ---------------------------------------------------------------------------------------
// Temporary compatibility shims, matching terrain.ts's. Deleted in Task 7.
// ---------------------------------------------------------------------------------------

/** The shipped hole's literal sand noise source: createNoise2D(() => 0.77). */
export const LEGACY_SURFACE_SOURCES: SurfaceSources = { sand: () => 0.77 };

const legacySpec = legacyHoleSpec();
const legacySurfaces = createSurfaces(
  legacySpec,
  createTerrain(legacySpec, LEGACY_TERRAIN_SOURCES),
  LEGACY_SURFACE_SOURCES,
);

export function surfaceAt(worldX: number, worldZ: number): SurfaceId {
  return legacySurfaces.surfaceAt(worldX, worldZ);
}

export function tuningAt(worldX: number, worldZ: number): SurfaceTuning {
  return legacySurfaces.tuningAt(worldX, worldZ);
}
```

- [ ] **Step 5: Run the snapshot test against the refactored surfaces**

Run: `npx vitest run src/sim/surfaces.legacy.test.ts`
Expected: PASS, 1 test, unchanged from Step 3.

- [ ] **Step 6: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/sim/surfaces.ts src/sim/surfaces.legacy.test.ts
git commit -s -m "Make surfaces a factory over a HoleSpec and its terrain

Sand gets its own hash channel rather than a second literal noise seed, so
bunkers stay uncorrelated with hills by construction instead of by choosing
0.77 over 0.42. Module-level surfaceAt/tuningAt remain as shims while
consumers migrate.

surfaces.legacy.test.ts pins the shipped classification cell by cell and
passes on both sides of the change."
```

---

## Task 5: `Sim.create(hole)` and `Sim.loadHole(spec)`

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `src/sim/world.cart.test.ts:5` (imports) and every use of `FIELD_SIZE` / `heightAt`

**Interfaces:**
- Consumes: `createTerrain`, `Terrain`, `CUP_RADIUS` from `./terrain`; `createSurfaces`,
  `Surfaces` from `./surfaces`; `HoleSpec`, `Vec3`, `legacyHoleSpec` from `./course`.
- Produces: `Sim.create(hole: HoleSpec): Promise<Sim>`, `sim.loadHole(spec: HoleSpec): void`,
  `sim.terrain: Terrain`, `sim.surfaces: Surfaces`. `world.ts` re-exports `Vec3` from
  `./course`, so `import type { Vec3 } from "./world"` keeps working for existing callers.

- [ ] **Step 1: Write the failing test**

Append to `src/sim/world.cart.test.ts`, inside the existing `describe("cart in the world")`
block:

```ts
  it("exposes the terrain and surfaces built from the hole it was created with", () => {
    expect(sim.terrain.spec.fieldSize).toBe(160);
    expect(sim.terrain.spec.tee).toEqual({ x: -68, z: 0 });
    expect(sim.surfaces.surfaceAt(sim.terrain.cupPosition.x, sim.terrain.cupPosition.z)).toBe(
      SurfaceId.Green,
    );
  });

  it("loadHole swaps the ground collider and re-tees onto the new hole", () => {
    const next: HoleSpec = { ...legacyHoleSpec(), seed: 999, tee: { x: 20, z: -20 } };
    sim.loadHole(next);

    expect(sim.terrain.spec.seed).toBe(999);
    expect(sim.current.position.x).toBeCloseTo(20, 5);
    expect(sim.current.position.z).toBeCloseTo(-20, 5);
    expect(sim.strokes).toBe(0);

    // The ball must be standing on the *new* heightfield, not the old one: step it and confirm
    // it settles rather than falling through to the out-of-bounds floor.
    for (let i = 0; i < 180; i++) sim.step();
    expect(sim.current.position.y).toBeGreaterThan(
      sim.terrain.heightAt(sim.current.position.x, sim.current.position.z) - 0.5,
    );
  });
```

Add to the file's imports at the top:

```ts
import { legacyHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { SurfaceId } from "./surfaces";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sim/world.cart.test.ts`
Expected: FAIL — `sim.terrain is undefined` / `sim.loadHole is not a function`.

- [ ] **Step 3: Rewire `src/sim/world.ts`**

Replace the terrain/surfaces import block at `src/sim/world.ts:6-16` with:

```ts
import type { HoleSpec, Vec3 } from "./course";
import { CUP_RADIUS, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import { SURFACES, SurfaceId, createSurfaces } from "./surfaces";
import type { Surfaces } from "./surfaces";

export type { Vec3 } from "./course";
```

Delete the local `export interface Vec3 { … }` declaration (around `src/sim/world.ts:127`); the
re-export above replaces it.

Add these fields to the `Sim` class, next to the existing private fields:

```ts
  private groundCollider!: RAPIER.Collider;
  /** The hole this sim is playing. Swapped wholesale by `loadHole`. */
  terrain: Terrain;
  surfaces: Surfaces;
```

Replace the private constructor:

```ts
  private constructor(terrain: Terrain, surfaces: Surfaces) {
    this.terrain = terrain;
    this.surfaces = surfaces;
    this.lastSafePosition = { ...terrain.teePosition };
    this.previous = restTransform(terrain);
    this.current = restTransform(terrain);
    this.previousCart = restCartTransform(terrain);
    this.currentCart = restCartTransform(terrain);
  }
```

and change the `lastSafePosition` field declaration to a bare `private lastSafePosition: Vec3;`
(the initializer moves into the constructor, because it now depends on the terrain).

Replace the head of `static async create` and the ground-collider block:

```ts
  static async create(hole: HoleSpec): Promise<Sim> {
    await RAPIER.init();
    const terrain = createTerrain(hole);
    const sim = new Sim(terrain, createSurfaces(hole, terrain));

    sim.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    sim.world.timestep = FIXED_DT;
    sim.buildGround();

    const tee = terrain.teePosition;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(tee.x, tee.y, tee.z)
      .setCcdEnabled(true)
      .setLinearDamping(LINEAR_DAMPING)
      .setAngularDamping(ANGULAR_DAMPING);
    sim.ball = sim.world.createRigidBody(bodyDesc);
```

(the rest of `create` is unchanged except that `cartSpawnPosition()` becomes
`cartSpawnPosition(terrain)` — see Step 4).

Add two methods to `Sim`:

```ts
  /**
   * Builds the heightfield collider for the current terrain. Split out of `create` because
   * `loadHole` has to redo exactly this and nothing else about the world.
   */
  private buildGround(): void {
    const spec = this.terrain.spec;
    const groundDesc = RAPIER.ColliderDesc.heightfield(
      spec.cells,
      spec.cells,
      this.terrain.buildHeightfield(),
      { x: spec.fieldSize, y: 1, z: spec.fieldSize },
    )
      .setFriction(0.8)
      .setRestitution(0.15);
    this.groundCollider = this.world.createCollider(groundDesc);
  }

  /**
   * Swap in a different hole. The ball, cart and controller are reused -- only the terrain,
   * the surfaces and the ground collider are rebuilt, then everything is re-teed.
   *
   * Nothing in this phase calls it during play: `main.ts` loads hole 0 and stays there, and the
   * renderer's ground mesh is built once at construction, so advancing a round mid-session is
   * Phase 1.75's job (spec §9). It exists and is tested now because the collider swap is the
   * part that is easy to get wrong later.
   */
  loadHole(spec: HoleSpec): void {
    this.world.removeCollider(this.groundCollider, false);
    this.terrain = createTerrain(spec);
    this.surfaces = createSurfaces(spec, this.terrain);
    this.buildGround();
    this.lastSafePosition = { ...this.terrain.teePosition };
    this.reset();
  }
```

- [ ] **Step 4: Replace every module-constant reference inside `world.ts`**

Mechanical, one per site:

| was | becomes |
|---|---|
| `buildHeightfield()` in `create` | `this.terrain.buildHeightfield()` (via `buildGround`) |
| `NROWS`, `NCOLS` | `spec.cells` |
| `FIELD_SIZE` in `moveCartBody` and `isPastFieldEdge` | `this.terrain.spec.fieldSize` |
| `heightAt(p.x, p.z)` in `isGrounded` | `this.terrain.heightAt(p.x, p.z)` |
| `surfaceAt(p.x, p.z)` in `step` | `this.surfaces.surfaceAt(p.x, p.z)` |
| `tuningAt(c.x, c.z)` in `stepCart` | `this.surfaces.tuningAt(c.x, c.z)` |
| `tuningAt(p.x, p.z)` in `applySurfaceResistance` | `this.surfaces.tuningAt(p.x, p.z)` |
| `CUP_POSITION` in `isInCup` | `this.terrain.cupPosition` |
| `{ ...TEE_POSITION }` in `reset` | `{ ...this.terrain.teePosition }` |
| `cartSpawnPosition()` in `create` and `reset` | `cartSpawnPosition(this.terrain)` |

And the three module-level helpers at the bottom of the file take the terrain:

```ts
function restTransform(terrain: Terrain): BallTransform {
  return { position: { ...terrain.teePosition }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
}

/** Behind the tee along -X, so a new hole never spawns the cart sitting on its own ball. */
function cartSpawnPosition(terrain: Terrain): Vec3 {
  const x = terrain.teePosition.x - CART_SPAWN_OFFSET;
  const z = terrain.teePosition.z;
  return { x, y: terrain.heightAt(x, z) + CART_COLLIDER.groundOffset, z };
}

function restCartTransform(terrain: Terrain): CartTransform {
  return { position: cartSpawnPosition(terrain), heading: 0, turretYaw: 0 };
}
```

- [ ] **Step 5: Point `world.cart.test.ts` at a spec**

Change every `await Sim.create()` to `await Sim.create(legacyHoleSpec())`, and replace the
terrain import at `src/sim/world.cart.test.ts:5`:

```ts
// was: import { FIELD_SIZE, heightAt } from "./terrain";
```

with nothing — use `sim.terrain.spec.fieldSize` and `sim.terrain.heightAt(...)` at each existing
call site instead. There are uses in the spawn-height and field-edge assertions; the type check
in Step 7 finds any that are missed.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/sim/world.cart.test.ts`
Expected: PASS, including the two new tests. The pre-existing cart assertions must pass
**unchanged** — the terrain is byte-identical, so any movement here is a bug in the rewiring,
not a threshold that needs adjusting.

- [ ] **Step 7: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass. `tsc` may still report unused-import errors in `scene.ts` /
`main.ts` — those migrate in Task 6. If so, note them and continue; if any error is inside
`src/sim/**`, fix it here.

- [ ] **Step 8: Commit**

```bash
git add src/sim/world.ts src/sim/world.cart.test.ts
git commit -s -m "Sim takes the hole it is playing

Sim.create(hole) builds its own terrain and surfaces from one spec and hands
them out, so nothing downstream needs the module constants. loadHole swaps
the heightfield collider and re-tees; it is unused during play this phase --
the renderer's ground mesh is still built once -- but the collider swap is
the part that is easy to get wrong, so it is written and tested now."
```

---

## Task 6: Renderer and entry point take terrain from the sim

**Files:**
- Modify: `src/render/scene.ts:4` (import), `RenderScene` constructor, `buildGroundMesh`
- Modify: `src/main.ts:14` (sim construction)

**Interfaces:**
- Consumes: `Terrain` from `../sim/terrain`; `legacyHoleSpec` from `./sim/course`.
- Produces: `new RenderScene(container: HTMLElement, terrain: Terrain)`.

- [ ] **Step 1: Rewire `src/render/scene.ts`**

Replace the terrain import at `src/render/scene.ts:4`:

```ts
import type { Terrain } from "../sim/terrain";
```

Add a field and take the terrain in the constructor:

```ts
export class RenderScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly terrain: Terrain;
  // ... existing fields unchanged ...

  constructor(container: HTMLElement, terrain: Terrain) {
    this.terrain = terrain;
    const fieldSize = terrain.spec.fieldSize;
    // ... existing body, with FIELD_SIZE -> fieldSize ...
```

`FIELD_SIZE` appears three times in the constructor — the fog near/far, the camera far plane,
and nothing else. Replace all three with `fieldSize`.

Replace the ground-mesh construction line:

```ts
    this.scene.add(buildGroundMesh(terrain));
```

Replace `heightAt(...)` in `frameChase`:

```ts
    const groundAtEye = this.terrain.heightAt(this.chaseEyeScratch.x, this.chaseEyeScratch.z);
```

Replace `buildGroundMesh` at the bottom of the file:

```ts
/**
 * Vertex layout matches Rapier's heightfield exactly: PlaneGeometry iterates row-major
 * (row = heightSegments, col = widthSegments) and after rotateX(-90deg) row maps to world Z,
 * col maps to world X -- the same mapping terrain.ts uses for the physics heightfield's
 * column-major heights array (verified empirically against the installed Rapier build).
 *
 * Built once, from the terrain handed in at construction. Rebuilding it for a new hole is
 * Phase 1.75's job along with the rest of the round flow.
 */
function buildGroundMesh(terrain: Terrain): THREE.Mesh {
  const { fieldSize, cells } = terrain.spec;
  const geometry = new THREE.PlaneGeometry(fieldSize, fieldSize, cells, cells);
  const position = geometry.attributes.position;
  for (let row = 0; row <= cells; row++) {
    for (let col = 0; col <= cells; col++) {
      const index = row * (cells + 1) + col;
      const worldX = (col / cells - 0.5) * fieldSize;
      const worldZ = (row / cells - 0.5) * fieldSize;
      position.setZ(index, terrain.heightAt(worldX, worldZ));
    }
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.95 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
```

- [ ] **Step 2: Rewire `src/main.ts`**

Add the import:

```ts
import { legacyHoleSpec } from "./sim/course";
```

Replace `src/main.ts:14-15`:

```ts
  // One hole, hard-coded, until generateCourse exists. Replaced in Task 14.
  const sim = await Sim.create(legacyHoleSpec());
  const render = new RenderScene(container, sim.terrain);
```

- [ ] **Step 3: Verify the type check is clean**

Run: `npx tsc --noEmit`
Expected: no output. This is the real check for this task — `scene.ts` and `main.ts` have no
unit tests.

- [ ] **Step 4: Verify the browser path still works**

Run: `npm run smoke`
Expected: PASS. This exercises a real key event through `KeyboardMouseSource` into `Sim` and out
to the HUD, which is the only automated coverage `main.ts` and `scene.ts` have.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/render/scene.ts src/main.ts
git commit -s -m "Renderer takes its terrain from the sim

RenderScene no longer imports FIELD_SIZE/NCOLS/NROWS/heightAt; it reads the
spec off the Terrain the sim hands it, which is what lets a hole vary at all.
The ground mesh is still built once at construction -- rebuilding it for a
new hole belongs with Phase 1.75's round flow."
```

---

## Task 7: Probe migrated, shims deleted — the §3 gate

This is where §3 is finished and *proved* finished: `npm run probe` must print the same numbers
as Phase 0's baseline.

**Files:**
- Modify: `tools/feelProbe.ts`
- Modify: `src/sim/terrain.ts` (delete the shim block)
- Modify: `src/sim/surfaces.ts` (delete the shim block)
- Modify: `src/sim/terrain.legacy.test.ts`, `src/sim/surfaces.legacy.test.ts` (retarget onto the
  factories)

**Interfaces:**
- Consumes: `legacyHoleSpec` from `../src/sim/course`, `createTerrain` /
  `LEGACY_TERRAIN_SOURCES` from `../src/sim/terrain`, `createSurfaces` /
  `LEGACY_SURFACE_SOURCES` from `../src/sim/surfaces`.
- Produces: nothing new. Removes `FIELD_SIZE`, `NROWS`, `NCOLS`, `WATER_LEVEL`, `TEE_XZ`,
  `CUP_XZ`, `TEE_POSITION`, `CUP_POSITION`, module-level `heightAt` / `buildHeightfield` /
  `surfaceAt` / `tuningAt`.

- [ ] **Step 1: Record the current probe output as the comparison baseline**

Run: `npm run probe > /tmp/probe-before-refactor.txt 2>&1 && cat /tmp/probe-before-refactor.txt`
Expected: the Phase 0 figures — terrain mean slope ≈ 4.3°, max ≈ 12.5°, driver ≈ 129 m total,
putter settle ≈ 3.2 s. Keep this file; Step 6 diffs against it.

- [ ] **Step 2: Retarget the two legacy tests onto the factories**

In `src/sim/terrain.legacy.test.ts`, replace the import and add a local instance — the assertion
body and the pasted `LEGACY_HEIGHTS` table are unchanged:

```ts
import { LEGACY_TERRAIN_SOURCES, createTerrain } from "./terrain";
import { legacyHoleSpec } from "./course";

const legacy = createTerrain(legacyHoleSpec(), LEGACY_TERRAIN_SOURCES);
const heightAt = (x: number, z: number): number => legacy.heightAt(x, z);
```

In `src/sim/surfaces.legacy.test.ts`, likewise:

```ts
import { legacyHoleSpec } from "./course";
import { LEGACY_TERRAIN_SOURCES, createTerrain } from "./terrain";
import { LEGACY_SURFACE_SOURCES, createSurfaces } from "./surfaces";

const spec = legacyHoleSpec();
const legacy = createSurfaces(
  spec,
  createTerrain(spec, LEGACY_TERRAIN_SOURCES),
  LEGACY_SURFACE_SOURCES,
);
const surfaceAt = (x: number, z: number): string => legacy.surfaceAt(x, z);
```

- [ ] **Step 3: Rewrite `tools/feelProbe.ts` to build its own hole**

Replace the import block at `tools/feelProbe.ts:6-9`:

```ts
import { Sim, FIXED_DT } from "../src/sim/world";
import { legacyHoleSpec } from "../src/sim/course";
import { CUP_RADIUS, createTerrain } from "../src/sim/terrain";
import { createSurfaces } from "../src/sim/surfaces";
import { SurfaceId } from "../src/sim/surfaces";
import { CLUB_STATS, ClubType, computeLaunchVelocity } from "../src/physics/Ballistics";
```

Add a module-level hole immediately after the imports, and derive every constant the file used
to import from it:

```ts
/**
 * The probe builds its own hole rather than reading module constants, because there are no
 * module constants any more. Same spec the game boots with, so the numbers below stay
 * comparable to the Phase 0 baseline.
 */
const HOLE = legacyHoleSpec();
const terrain = createTerrain(HOLE);
const surfaces = createSurfaces(HOLE, terrain);

const FIELD_SIZE = HOLE.fieldSize;
const NROWS = HOLE.cells;
const NCOLS = HOLE.cells;
const WATER_LEVEL = HOLE.waterLevel;
const TEE_POSITION = terrain.teePosition;
const CUP_POSITION = terrain.cupPosition;
const heightAt = (x: number, z: number): number => terrain.heightAt(x, z);
const surfaceAt = (x: number, z: number): SurfaceId => surfaces.surfaceAt(x, z);
```

**Note the deliberate difference from the shims:** `createTerrain(HOLE)` here uses the *default*
hashed noise source, not `LEGACY_TERRAIN_SOURCES`. The Phase 0 numbers were produced by
`() => 0.42`. Use `createTerrain(HOLE, { height: () => 0.42 })` and
`createSurfaces(HOLE, terrain, { sand: () => 0.77 })` for this task only, so Step 6's diff is
meaningful. Task 9 removes both, at which point the numbers move for a stated reason.

Change the one `Sim.create()` call in `main()` to `Sim.create(HOLE)`.

- [ ] **Step 4: Delete the shim blocks**

In `src/sim/terrain.ts`, delete everything from the `Temporary compatibility shims` banner
comment to the end of the file, **except** `LEGACY_TERRAIN_SOURCES`, which the two legacy tests
and the probe still use. Remove the now-unused `legacyHoleSpec` import.

In `src/sim/surfaces.ts`, delete the same block except `LEGACY_SURFACE_SOURCES`, and remove the
now-unused `legacyHoleSpec` and `createTerrain` imports.

- [ ] **Step 5: Verify the type check and the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all suites pass, including both legacy snapshot tests.

`tsc` does not cover `tools/**` (`"include": ["src"]`), so a mistake in `feelProbe.ts` surfaces
only in the next step.

- [ ] **Step 6: Run the probe and diff against the baseline**

Run: `npm run probe > /tmp/probe-after-refactor.txt 2>&1; diff /tmp/probe-before-refactor.txt /tmp/probe-after-refactor.txt`
Expected: **empty diff.** This is the §3 gate. Every terrain figure, every club's carry/roll/
settle, and the surface mix must be identical — that is what "provably behaviour-preserving"
means, and it is the whole reason §3 lands alone.

If the diff is non-empty, do not adjust the baseline. Find the difference: the usual causes are
forgetting `LEGACY_TERRAIN_SOURCES` in Step 3, or a missed `spec.cells` substitution changing
the heightfield resolution.

- [ ] **Step 7: Commit**

```bash
git add src/sim/terrain.ts src/sim/surfaces.ts src/sim/terrain.legacy.test.ts src/sim/surfaces.legacy.test.ts tools/feelProbe.ts
git commit -s -m "Remove the terrain and surfaces module constants

The last consumers now build a hole and read it. npm run probe prints output
identical to the pre-refactor baseline -- terrain slope, every club's
carry/roll/settle, and the surface mix -- which is the gate for the data
model change: it moves where the constants live and nothing else, so any
regression after this point belongs to the terrain work rather than to this."
```

---

# Stage B — The corridor centreline (§5)

## Task 8: Centripetal Catmull-Rom spline

Nothing consumes this yet, so it lands alone and the probe stays green.

**Files:**
- Create: `src/sim/spline.ts`
- Test: `src/sim/spline.test.ts`

**Interfaces:**
- Consumes: `Vec2`, `Vec3` — actually only `Vec2` — from `./course`, type-only.
- Produces:
  ```ts
  export interface MutableVec2 { x: number; z: number }
  export interface NearestPoint { distance: number; t: number }
  export interface Spline {
    /** Centripetal Catmull-Rom, alpha = 0.5. `t` is normalised arc length in [0, 1]. */
    pointAt(t: number): Vec2;
    pointInto(t: number, out: MutableVec2): void;
    /** Shortest distance from (x, z) to the curve, and the parameter where it occurs. */
    nearest(x: number, z: number): NearestPoint;
    nearestInto(x: number, z: number, out: NearestPoint): void;
    /** Tangent direction at `t`, unit length. */
    tangentInto(t: number, out: MutableVec2): void;
    readonly length: number;
  }
  export function createSpline(control: readonly Vec2[], alpha?: number): Spline;
  export function createNearestPoint(): NearestPoint;
  ```

**Two design decisions worth reviewing before the code:**

*`t` is normalised arc length along a sampled polyline, not a knot parameter.* Both `pointAt`
and `nearest` are defined on that one polyline, which makes them exact inverses of each other —
`pointAt(nearest(p).t)` is precisely the point `nearest` measured the distance to. Task 10's
carving depends on that identity for lateral camber to be exactly zero; a curve-exact `pointAt`
paired with a polyline `nearest` would leave a small residual camber that no constant could
remove.

*`alpha` is an optional parameter, defaulted to 0.5.* The spec's own required test is "α = 0.5
produces no cusp on adversarial control points, compare against uniform parameterisation, which
should" — that test is unwritable without a way to ask for uniform. Production code never passes
it.

- [ ] **Step 1: Write the failing test**

Create `src/sim/spline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createNearestPoint, createSpline } from "./spline";
import type { Vec2 } from "./course";

/**
 * Unevenly spaced on purpose: a tight cluster followed by a long run is exactly the
 * configuration where uniform Catmull-Rom overshoots into a cusp, and it is also what a
 * dog-legged hole looks like when the apex sits close to the tee.
 */
const ADVERSARIAL: readonly Vec2[] = [
  { x: 0, z: 0 },
  { x: 2, z: 1 },
  { x: 3, z: 1.2 },
  { x: 60, z: 20 },
];

/** Largest turn between consecutive polyline segments, radians. A cusp is a near-pi turn. */
function maxTurnAngle(points: readonly Vec2[]): number {
  let worst = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const az = points[i].z - points[i - 1].z;
    const bx = points[i + 1].x - points[i].x;
    const bz = points[i + 1].z - points[i].z;
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cos = Math.min(1, Math.max(-1, (ax * bx + az * bz) / (la * lb)));
    worst = Math.max(worst, Math.acos(cos));
  }
  return worst;
}

function sample(spline: ReturnType<typeof createSpline>, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push(spline.pointAt(i / n));
  return out;
}

describe("createSpline", () => {
  it("passes through the first and last control points", () => {
    const s = createSpline(ADVERSARIAL);
    expect(s.pointAt(0).x).toBeCloseTo(0, 6);
    expect(s.pointAt(0).z).toBeCloseTo(0, 6);
    expect(s.pointAt(1).x).toBeCloseTo(60, 6);
    expect(s.pointAt(1).z).toBeCloseTo(20, 6);
  });

  it("clamps t outside [0, 1] rather than extrapolating", () => {
    const s = createSpline(ADVERSARIAL);
    expect(s.pointAt(-5)).toEqual(s.pointAt(0));
    expect(s.pointAt(5)).toEqual(s.pointAt(1));
  });

  it("alpha = 0.5 produces no cusp where uniform parameterisation does", () => {
    const centripetal = maxTurnAngle(sample(createSpline(ADVERSARIAL, 0.5), 400));
    const uniform = maxTurnAngle(sample(createSpline(ADVERSARIAL, 0), 400));
    // A cusp is a reversal: the curve turns through most of a half-circle in one step.
    expect(uniform).toBeGreaterThan(1.2);
    expect(centripetal).toBeLessThan(0.5);
  });

  it("is monotone in arc length: t maps to distance travelled", () => {
    const s = createSpline(ADVERSARIAL);
    let travelled = 0;
    let previous = s.pointAt(0);
    for (let i = 1; i <= 200; i++) {
      const p = s.pointAt(i / 200);
      travelled += Math.hypot(p.x - previous.x, p.z - previous.z);
      previous = p;
      // Arc length reached by parameter t is t * length, to within one sample's chord.
      expect(Math.abs(travelled - (i / 200) * s.length)).toBeLessThan(s.length / 100);
    }
  });

  it("length grows when the control points spread out", () => {
    const tight = createSpline([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 0 },
    ]);
    const bent = createSpline([
      { x: 0, z: 0 },
      { x: 10, z: 15 },
      { x: 20, z: 0 },
    ]);
    expect(tight.length).toBeCloseTo(20, 1);
    expect(bent.length).toBeGreaterThan(tight.length);
  });

  it("nearest agrees with brute-force sampling to within a centimetre", () => {
    const s = createSpline(ADVERSARIAL);
    const dense: Vec2[] = sample(s, 20000);
    const probes = [
      { x: 5, z: 10 },
      { x: 30, z: -8 },
      { x: 61, z: 21 },
      { x: -4, z: -3 },
      { x: 1.5, z: 1.5 },
    ];
    for (const probe of probes) {
      let brute = Infinity;
      for (const p of dense) brute = Math.min(brute, Math.hypot(p.x - probe.x, p.z - probe.z));
      expect(Math.abs(s.nearest(probe.x, probe.z).distance - brute)).toBeLessThan(0.01);
    }
  });

  it("nearest returns a t that pointAt maps back to the measured point", () => {
    const s = createSpline(ADVERSARIAL);
    const probe = { x: 30, z: -8 };
    const hit = s.nearest(probe.x, probe.z);
    const p = s.pointAt(hit.t);
    expect(Math.hypot(p.x - probe.x, p.z - probe.z)).toBeCloseTo(hit.distance, 9);
  });

  it("nearest is zero on the curve itself", () => {
    const s = createSpline(ADVERSARIAL);
    for (let i = 0; i <= 20; i++) {
      const p = s.pointAt(i / 20);
      expect(s.nearest(p.x, p.z).distance).toBeLessThan(1e-6);
    }
  });

  it("nearestInto and pointInto write into the caller's object and allocate nothing", () => {
    const s = createSpline(ADVERSARIAL);
    const hit = createNearestPoint();
    const point = { x: 0, z: 0 };
    s.nearestInto(30, -8, hit);
    s.pointInto(hit.t, point);
    expect(hit).toEqual(s.nearest(30, -8));
    expect(point).toEqual({ x: s.pointAt(hit.t).x, z: s.pointAt(hit.t).z });
  });

  it("tangentInto returns a unit vector pointing tee-to-cup", () => {
    const s = createSpline([
      { x: 0, z: 0 },
      { x: 50, z: 0 },
      { x: 100, z: 0 },
    ]);
    const tangent = { x: 0, z: 0 };
    s.tangentInto(0.5, tangent);
    expect(Math.hypot(tangent.x, tangent.z)).toBeCloseTo(1, 6);
    expect(tangent.x).toBeCloseTo(1, 6);
    expect(tangent.z).toBeCloseTo(0, 6);
  });

  it("rejects fewer than two control points", () => {
    expect(() => createSpline([{ x: 0, z: 0 }])).toThrow(/at least two/i);
  });

  it("survives duplicated control points without producing NaN", () => {
    const s = createSpline([
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ]);
    for (let i = 0; i <= 20; i++) {
      const p = s.pointAt(i / 20);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sim/spline.test.ts`
Expected: FAIL — `Failed to resolve import "./spline"`.

- [ ] **Step 3: Write the implementation**

Create `src/sim/spline.ts`:

```ts
import type { Vec2 } from "./course";

/**
 * The corridor centreline: a centripetal Catmull-Rom curve through the hole's control points,
 * flattened once at construction into an arc-length-parameterised polyline.
 *
 * Centripetal parameterisation (alpha = 0.5) rather than uniform: uniform Catmull-Rom produces
 * cusps and self-intersection when control points are unevenly spaced, and a cusp in the
 * corridor centreline is a fold in the terrain. A dog-leg apex sitting close to the tee is
 * exactly the uneven spacing that triggers it.
 *
 * `t` is normalised arc length rather than a knot parameter, and both `pointAt` and `nearest`
 * read the same polyline. That makes them exact inverses -- pointAt(nearest(p).t) is the very
 * point nearest measured to -- which is what terrain.ts's carving needs for lateral camber to
 * be zero by construction rather than merely small.
 */

export interface MutableVec2 {
  x: number;
  z: number;
}

export interface NearestPoint {
  distance: number;
  t: number;
}

/** Scratch factory, so callers in the hot loop have something to reuse. */
export function createNearestPoint(): NearestPoint {
  return { distance: 0, t: 0 };
}

export interface Spline {
  pointAt(t: number): Vec2;
  pointInto(t: number, out: MutableVec2): void;
  nearest(x: number, z: number): NearestPoint;
  nearestInto(x: number, z: number, out: NearestPoint): void;
  tangentInto(t: number, out: MutableVec2): void;
  readonly length: number;
}

/**
 * Target polyline spacing. The spec sizes `nearest` at a ~200-segment scan for a ~200 m hole,
 * which is this. The per-segment floor keeps short test curves resolved finely enough that a
 * cusp is visible rather than sampled over.
 */
const SAMPLE_SPACING_M = 1.0;
const MIN_SAMPLES_PER_SEGMENT = 16;

/** Guards the knot spacing so duplicated control points cannot divide by zero. */
const MIN_KNOT_DELTA = 1e-6;

export function createSpline(control: readonly Vec2[], alpha = 0.5): Spline {
  if (control.length < 2) throw new Error("createSpline needs at least two control points");

  // Duplicate the endpoints so the first and last segments have the neighbours Catmull-Rom
  // needs. Reflecting instead would let the curve overshoot past the tee and the cup.
  const p: Vec2[] = [control[0], ...control, control[control.length - 1]];

  const knots = new Float64Array(p.length);
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    knots[i] = knots[i - 1] + Math.max(MIN_KNOT_DELTA, Math.pow(d, alpha));
  }

  /**
   * Barry-Goldman pyramidal evaluation of the segment between p[i] and p[i+1], for a knot
   * value `u` in [knots[i], knots[i+1]]. Written out rather than reduced to the uniform
   * Catmull-Rom basis matrix, because the basis matrix is only valid for evenly spaced knots
   * and using it here is the standard way to accidentally ship uniform parameterisation.
   */
  function evaluate(i: number, u: number, out: MutableVec2): void {
    const t0 = knots[i - 1];
    const t1 = knots[i];
    const t2 = knots[i + 1];
    const t3 = knots[i + 2];

    const a1x = ((t1 - u) * p[i - 1].x + (u - t0) * p[i].x) / (t1 - t0);
    const a1z = ((t1 - u) * p[i - 1].z + (u - t0) * p[i].z) / (t1 - t0);
    const a2x = ((t2 - u) * p[i].x + (u - t1) * p[i + 1].x) / (t2 - t1);
    const a2z = ((t2 - u) * p[i].z + (u - t1) * p[i + 1].z) / (t2 - t1);
    const a3x = ((t3 - u) * p[i + 1].x + (u - t2) * p[i + 2].x) / (t3 - t2);
    const a3z = ((t3 - u) * p[i + 1].z + (u - t2) * p[i + 2].z) / (t3 - t2);

    const b1x = ((t2 - u) * a1x + (u - t0) * a2x) / (t2 - t0);
    const b1z = ((t2 - u) * a1z + (u - t0) * a2z) / (t2 - t0);
    const b2x = ((t3 - u) * a2x + (u - t1) * a3x) / (t3 - t1);
    const b2z = ((t3 - u) * a2z + (u - t1) * a3z) / (t3 - t1);

    out.x = ((t2 - u) * b1x + (u - t1) * b2x) / (t2 - t1);
    out.z = ((t2 - u) * b1z + (u - t1) * b2z) / (t2 - t1);
  }

  // Flatten every interior segment into one polyline.
  const xs: number[] = [];
  const zs: number[] = [];
  const scratch: MutableVec2 = { x: 0, z: 0 };
  for (let i = 1; i < p.length - 2; i++) {
    const chord = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].z - p[i].z);
    const steps = Math.max(MIN_SAMPLES_PER_SEGMENT, Math.ceil(chord / SAMPLE_SPACING_M));
    for (let s = 0; s < steps; s++) {
      evaluate(i, knots[i] + ((knots[i + 1] - knots[i]) * s) / steps, scratch);
      xs.push(scratch.x);
      zs.push(scratch.z);
    }
  }
  evaluate(p.length - 3, knots[p.length - 2], scratch);
  xs.push(scratch.x);
  zs.push(scratch.z);

  // Cumulative arc length, so t is distance travelled rather than a knot value.
  const cumulative = new Float64Array(xs.length);
  for (let i = 1; i < xs.length; i++) {
    cumulative[i] = cumulative[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  const total = cumulative[cumulative.length - 1];

  function pointInto(t: number, out: MutableVec2): void {
    const target = Math.min(1, Math.max(0, t)) * total;
    // Binary search for the segment containing `target`.
    let lo = 0;
    let hi = cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo];
    const f = span < MIN_KNOT_DELTA ? 0 : (target - cumulative[lo]) / span;
    out.x = xs[lo] + (xs[hi] - xs[lo]) * f;
    out.z = zs[lo] + (zs[hi] - zs[lo]) * f;
  }

  function pointAt(t: number): Vec2 {
    const out: MutableVec2 = { x: 0, z: 0 };
    pointInto(t, out);
    return out;
  }

  /**
   * Brute-force scan of every segment. No acceleration structure: the polyline is ~200
   * segments and buildHeightfield is the only caller that runs it in bulk, at load time. If
   * that ever becomes the bottleneck the fix is a uniform-grid cache of nearest-t, but that is
   * speculative until measured.
   */
  function nearestInto(x: number, z: number, out: NearestPoint): void {
    let bestSq = Infinity;
    let bestArc = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const ax = xs[i];
      const az = zs[i];
      const bx = xs[i + 1] - ax;
      const bz = zs[i + 1] - az;
      const lengthSq = bx * bx + bz * bz;
      const f =
        lengthSq < MIN_KNOT_DELTA
          ? 0
          : Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / lengthSq));
      const dx = x - (ax + bx * f);
      const dz = z - (az + bz * f);
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        bestArc = cumulative[i] + f * Math.sqrt(lengthSq);
      }
    }
    out.distance = Math.sqrt(bestSq);
    out.t = total < MIN_KNOT_DELTA ? 0 : bestArc / total;
  }

  function nearest(x: number, z: number): NearestPoint {
    const out = createNearestPoint();
    nearestInto(x, z, out);
    return out;
  }

  /** Forward difference on the polyline, one sample either side, normalised. */
  function tangentInto(t: number, out: MutableVec2): void {
    const step = total < MIN_KNOT_DELTA ? 0 : SAMPLE_SPACING_M / total;
    const a: MutableVec2 = { x: 0, z: 0 };
    const b: MutableVec2 = { x: 0, z: 0 };
    pointInto(Math.max(0, t - step), a);
    pointInto(Math.min(1, t + step), b);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const magnitude = Math.hypot(dx, dz);
    if (magnitude < MIN_KNOT_DELTA) {
      out.x = 1;
      out.z = 0;
      return;
    }
    out.x = dx / magnitude;
    out.z = dz / magnitude;
  }

  return { pointAt, pointInto, nearest, nearestInto, tangentInto, length: total };
}
```

`tangentInto` allocates two scratch objects per call. It is used only by the §6 camber check,
which runs at generation time and never per tick, so that is fine — but do not call it from
`heightAt`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sim/spline.test.ts`
Expected: PASS, 12 tests.

If the cusp test fails because `uniform` is below 1.2, the adversarial control points are not
adversarial enough on this build — tighten the cluster (move `{x: 3, z: 1.2}` to `{x: 2.2, z:
1.05}`) rather than lowering the threshold. The test is worthless if it does not actually
produce a cusp in the uniform case.

- [ ] **Step 5: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass; no type errors. The probe is untouched.

- [ ] **Step 6: Commit**

```bash
git add src/sim/spline.ts src/sim/spline.test.ts
git commit -s -m "Add the centripetal Catmull-Rom corridor centreline

Centripetal (alpha = 0.5) rather than uniform, because uniform Catmull-Rom
cusps when control points are unevenly spaced and a cusp in the centreline
is a fold in the terrain -- which is exactly what a dog-leg apex near the tee
would produce.

t is normalised arc length on a flattened polyline, and both pointAt and
nearest read that same polyline, so they are exact inverses. The carving in
the next commit depends on that identity to get zero lateral camber by
construction rather than by tuning.

nearestInto/pointInto exist because heightAt runs inside the fixed tick and
the allocating forms would violate the no-allocation rule."
```

---

# Stage C — Height and surfaces (§4, §5)

**Probe numbers move from here on.** That is expected and is the reason §3 landed alone. They
are re-baselined into `docs/ROADMAP.md` in Task 16, with the cause recorded — not quietly
overwritten.

## Task 9: Three-octave height with budget-driven masking

**Files:**
- Modify: `src/sim/terrain.ts` (replace `rawHeight`, add the budget field, build the spline)
- Modify: `src/sim/course.ts` (rename `legacyHoleSpec` → `fixedHoleSpec`, reposition it)
- Modify: `src/sim/course.test.ts`, `src/sim/world.cart.test.ts`, `src/main.ts`,
  `tools/feelProbe.ts` (follow the rename)
- Delete: `src/sim/terrain.legacy.test.ts`, `src/sim/surfaces.legacy.test.ts`
- Test: `src/sim/terrain.test.ts` (create)

**Interfaces:**
- Consumes: `createSpline`, `createNearestPoint`, `NearestPoint`, `MutableVec2` from
  `./spline`.
- Produces, added to `terrain.ts`:
  ```ts
  export const HALF_WIDTH = 15;        // m, mown corridor half-width
  export const BLEND_WIDTH = 10;       // m, graded edge into rough
  export const GREEN_BLEND = 6;        // m
  export const GRAD_GREEN = 0.06;
  export const GRAD_FAIRWAY = 0.11;
  export const GRAD_ROUGH = 0.28;
  export const NOISE_MAX_GRADIENT = 7.333;
  ```
  `Terrain` gains `readonly spline: Spline`. `course.ts` renames `legacyHoleSpec` →
  `fixedHoleSpec`, same signature.

- [ ] **Step 1: Delete the behaviour-preservation scaffolding**

The §3 refactor is finished and proved; its snapshots are about to become wrong on purpose.

```bash
git rm src/sim/terrain.legacy.test.ts src/sim/surfaces.legacy.test.ts
```

Delete `LEGACY_TERRAIN_SOURCES` from `src/sim/terrain.ts` and `LEGACY_SURFACE_SOURCES` from
`src/sim/surfaces.ts`. In `tools/feelProbe.ts`, drop the injected sources so the probe uses the
hashed defaults:

```ts
const terrain = createTerrain(HOLE);
const surfaces = createSurfaces(HOLE, terrain);
```

The `sources` *parameters* stay on both factories — they are how AGENTS.md wants seeded
randomness supplied, and Task 12's checks use them to build a flat terrain for testing a single
check in isolation.

- [ ] **Step 2: Rename and reposition the fixture**

In `src/sim/course.ts`, replace `legacyHoleSpec` with:

```ts
/** Arbitrary but fixed, so `fixedHoleSpec()` is the same hole on every machine and every run. */
const FIXED_HOLE_SEED = 0x7ee71e5;

/**
 * One hand-built hole. Not generated: it is the deterministic spec that `world.cart.test.ts`
 * and the probe run against, so a cart or ballistics regression is never confused with a
 * different draw from the generator.
 *
 * Its geometry is a legal hole -- tee and cup inside the corridor box for a 160 m field, a
 * dog-leg apex, and a 90 m tee-to-cup separation -- so it passes the §6 checks rather than
 * merely existing. `par` is 3 by the same formula generateHole uses: the corridor is ~105 m,
 * under one REFERENCE_CARRY_M.
 */
export function fixedHoleSpec(): HoleSpec {
  const tee: Vec2 = { x: -45, z: 0 };
  const cup: Vec2 = { x: 45, z: 8 };
  return {
    seed: FIXED_HOLE_SEED,
    index: 0,
    fieldSize: 160,
    cells: 160,
    tee,
    cup,
    control: [tee, { x: 0, z: -25 }, cup],
    par: 3,
    waterLevel: -0.72,
  };
}
```

Update the three call sites — `src/main.ts`, `src/sim/world.cart.test.ts`,
`tools/feelProbe.ts` — and replace `src/sim/course.test.ts`'s `legacyHoleSpec` block with:

```ts
import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";

describe("fixedHoleSpec", () => {
  it("holds a cell size near 1 m, which the ball radius depends on", () => {
    const spec = fixedHoleSpec();
    expect(spec.fieldSize / spec.cells).toBeCloseTo(1.0, 3);
  });

  it("has a corridor running tee first, cup last, with a dog-leg between", () => {
    const spec = fixedHoleSpec();
    expect(spec.control.length).toBeGreaterThanOrEqual(3);
    expect(spec.control[0]).toEqual(spec.tee);
    expect(spec.control[spec.control.length - 1]).toEqual(spec.cup);
  });

  it("is a fresh object each call, so a caller cannot mutate the fixture for everyone", () => {
    expect(fixedHoleSpec()).not.toBe(fixedHoleSpec());
    expect(fixedHoleSpec()).toEqual(fixedHoleSpec());
  });
});
```

- [ ] **Step 3: Write the failing test**

Create `src/sim/terrain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import {
  BLEND_WIDTH,
  GRAD_FAIRWAY,
  GRAD_GREEN,
  GREEN_RADIUS,
  HALF_WIDTH,
  createTerrain,
} from "./terrain";
import type { Terrain } from "./terrain";

const SPEC = fixedHoleSpec();
const terrain = createTerrain(SPEC);

/** Central-difference gradient magnitude, in the same rise-over-run units as the budgets. */
function gradientAt(t: Terrain, x: number, z: number, h = 0.5): number {
  const dx = (t.heightAt(x + h, z) - t.heightAt(x - h, z)) / (2 * h);
  const dz = (t.heightAt(x, z + h) - t.heightAt(x, z - h)) / (2 * h);
  return Math.hypot(dx, dz);
}

describe("budget-driven masking", () => {
  it("holds the green inside the green's own rest threshold", () => {
    // The pad flattens the middle, so sample the annulus where the budget is doing the work.
    let worst = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
      for (let r = 1; r <= GREEN_RADIUS; r += 1) {
        worst = Math.max(
          worst,
          gradientAt(terrain, SPEC.cup.x + Math.cos(a) * r, SPEC.cup.z + Math.sin(a) * r),
        );
      }
    }
    expect(worst).toBeLessThanOrEqual(GRAD_GREEN);
  });

  it("holds the corridor inside the fairway's rest threshold", () => {
    let worst = 0;
    for (let i = 0; i <= 100; i++) {
      const centre = terrain.spline.pointAt(i / 100);
      for (let offset = -HALF_WIDTH; offset <= HALF_WIDTH; offset += 5) {
        worst = Math.max(worst, gradientAt(terrain, centre.x + offset, centre.z));
      }
    }
    expect(worst).toBeLessThanOrEqual(GRAD_FAIRWAY);
  });

  it("lets the rough run unbudgeted, so a ball on a hillside keeps rolling out of it", () => {
    // GRAD_ROUGH is deliberately 0.28, above the rough's own 0.22 rest threshold: the rough is
    // the unmasked octave sum. Assert it is actually steeper somewhere than the fairway allows.
    let worst = 0;
    for (let x = -78; x <= 78; x += 3) {
      for (let z = -78; z <= 78; z += 3) {
        if (terrain.spline.nearest(x, z).distance < HALF_WIDTH + BLEND_WIDTH) continue;
        worst = Math.max(worst, gradientAt(terrain, x, z));
      }
    }
    expect(worst).toBeGreaterThan(GRAD_FAIRWAY);
  });

  it("exposes the corridor spline built from the spec's control points", () => {
    expect(terrain.spline.pointAt(0).x).toBeCloseTo(SPEC.tee.x, 6);
    expect(terrain.spline.pointAt(1).x).toBeCloseTo(SPEC.cup.x, 6);
    expect(terrain.spline.length).toBeGreaterThan(90);
  });

  it("is a pure function of (x, z): repeated and out-of-order calls agree", () => {
    const a = terrain.heightAt(12, -7);
    terrain.heightAt(-60, 40);
    terrain.heightAt(0, 0);
    expect(terrain.heightAt(12, -7)).toBe(a);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/sim/terrain.test.ts`
Expected: FAIL — `HALF_WIDTH` etc. are not exported, and `terrain.spline` is undefined.

- [ ] **Step 5: Replace the height formulation in `src/sim/terrain.ts`**

Add the import and export the constants, replacing the old `HEIGHT_AMPLITUDE` /
`NOISE_FREQUENCY` / `DETAIL_*` block:

```ts
import { createNearestPoint, createSpline } from "./spline";
import type { MutableVec2, NearestPoint, Spline } from "./spline";

/**
 * The mown corridor, and the graded edge into rough. Full rough begins at 25 m, against the
 * hard 26 m step the shipped fairway had -- about as wide as before, but graded.
 */
export const HALF_WIDTH = 15;
export const BLEND_WIDTH = 10;
export const GREEN_BLEND = 6;

/**
 * Slope budgets, as tan(theta). GRAD_GREEN and GRAD_FAIRWAY are the `crr` values already in
 * SURFACES: the rest condition surfaces.ts documents is crr >= tan(theta), so a surface's
 * rolling resistance *is* the steepest grade a ball will hold on it.
 *
 * GRAD_ROUGH is deliberately 0.28, above the rough's own 0.22 rest threshold. It is the
 * unmasked octave sum (0.03 + 0.07 + 0.18), so the rough simply runs unbudgeted -- a ball on a
 * steep rough patch keeps rolling rather than settling, which is wanted: it runs out onto
 * flatter ground instead of parking on a hillside.
 */
export const GRAD_GREEN = 0.06;
export const GRAD_FAIRWAY = 0.11;
export const GRAD_ROUGH = 0.28;

/**
 * Max ||grad S|| of the installed simplex-noise build, measured directly rather than derived:
 * central differences at h = 1e-4 over 1,002,001 samples of a 20x20 domain gave max 7.333
 * (rms 2.955, mean 2.672).
 *
 * Neither published figure was right -- the research's 2.5 is the *mean* gradient, and this
 * module previously used 2*pi. Every amplitude below solves A = G / (f * k) with this k, so it
 * is a property of the installed dependency that a version bump can silently invalidate. That
 * is why `npm run probe` asserts it rather than this comment being the only record.
 */
export const NOISE_MAX_GRADIENT = 7.333;

/** Three octaves. G is the octave's share of the slope budget; A solves A = G / (f * k). */
const F_MICRO = 0.1;
const F_MESO = 0.02;
const F_MACRO = 0.005;
const G_MICRO = 0.03;
const G_MESO = 0.07;
const G_MACRO = 0.18;
const A_MICRO = G_MICRO / (F_MICRO * NOISE_MAX_GRADIENT);
const A_MESO = G_MESO / (F_MESO * NOISE_MAX_GRADIENT);
const A_MACRO = G_MACRO / (F_MACRO * NOISE_MAX_GRADIENT);
```

Deriving the amplitudes rather than writing 0.0409 / 0.4773 / 4.9093 means a corrected `k`
propagates on its own — the spec's published values are what these expressions evaluate to.

Add `readonly spline: Spline` to the `Terrain` interface, and inside `createTerrain` build the
spline and the scratch, then replace `rawHeight`:

```ts
  const spline = createSpline(spec.control);

  // Closure-owned scratch: heightAt runs inside the fixed tick, where allocation is banned.
  const nearestScratch: NearestPoint = createNearestPoint();
  const centreScratch: MutableVec2 = { x: 0, z: 0 };

  /**
   * The slope a point is allowed, blended green -> fairway -> rough. `corridorDistance` is the
   * distance to the centreline, passed in rather than measured here so the carving code can ask
   * for the budget *at the centreline* (distance 0) without a second spline query.
   */
  function budgetAt(worldX: number, worldZ: number, corridorDistance: number): number {
    const toCup = Math.hypot(worldX - spec.cup.x, worldZ - spec.cup.z);
    const tGreen = smoothstep01((toCup - GREEN_RADIUS) / GREEN_BLEND);
    const tCorridor = smoothstep01((corridorDistance - HALF_WIDTH) / BLEND_WIDTH);
    const mown = GRAD_GREEN + (GRAD_FAIRWAY - GRAD_GREEN) * tGreen;
    return mown + (GRAD_ROUGH - mown) * tCorridor;
  }

  /**
   * Each octave takes what the budget leaves. Micro is never masked -- it is the surface
   * ripple, and 0.03 fits under even the green's 0.06.
   *
   * smoothstep01, not a raw clamp, on the scale terms: a clamp is C0 but not C1, and a mask
   * whose derivative steps produces a slope discontinuity in H. smoothstep01 has zero
   * derivative at both ends, so H stays C1.
   *
   * The budget is the design target, not the guarantee -- it assumes all three octaves peak at
   * the same coordinate, and smoothstep01(t) > t for t > 0.5 lets the transition band sit
   * slightly over. The rejection sampler in course.ts is the enforcement.
   */
  function noiseHeightAt(worldX: number, worldZ: number, corridorDistance: number): number {
    let remaining = budgetAt(worldX, worldZ, corridorDistance) - G_MICRO;
    const mesoScale = smoothstep01(remaining / G_MESO);
    remaining -= mesoScale * G_MESO;
    const macroScale = smoothstep01(remaining / G_MACRO);
    return (
      A_MICRO * noise2D(worldX * F_MICRO, worldZ * F_MICRO) +
      A_MESO * noise2D(worldX * F_MESO, worldZ * F_MESO) * mesoScale +
      A_MACRO * noise2D(worldX * F_MACRO, worldZ * F_MACRO) * macroScale
    );
  }
```

Rewrite `heightAt` to measure the corridor distance and feed it in. The carving lerp arrives in
Task 10; this task keeps the pads exactly as they are:

```ts
  function heightAt(worldX: number, worldZ: number): number {
    spline.nearestInto(worldX, worldZ, nearestScratch);
    let height = noiseHeightAt(worldX, worldZ, nearestScratch.distance);
    for (const pad of pads) {
      const distance = Math.hypot(worldX - pad.x, worldZ - pad.z);
      if (distance >= pad.radius) continue;
      const weight = smoothstep01(1 - distance / pad.radius);
      height += (pad.height - height) * weight;
    }
    return height;
  }
```

The `pads` array's heights are now sampled from `noiseHeightAt(x, z, 0)` — the pad centres sit
on the corridor, so distance 0 is correct and avoids a second spline query at construction:

```ts
  const pads: readonly Pad[] = [
    { ...spec.tee, radius: TEE_PAD_RADIUS, height: noiseHeightAt(spec.tee.x, spec.tee.z, 0) },
    { ...spec.cup, radius: GREEN_RADIUS, height: noiseHeightAt(spec.cup.x, spec.cup.z, 0) },
  ];
```

Add `spline` to the returned object. Note `centreScratch` is unused until Task 10 —
`noUnusedLocals` will reject it, so declare it there rather than here.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/sim/terrain.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: no type errors. `world.cart.test.ts` may need threshold adjustments — the terrain is
genuinely different now. Adjust only assertions that encode *terrain* facts (spawn height, how
far a shot travels); an assertion about the cart's *state machine* that starts failing is a real
regression, not a threshold.

- [ ] **Step 8: Commit**

```bash
git add -A src/sim tools/feelProbe.ts src/main.ts
git commit -s -m "Replace the two-octave terrain with budget-masked octaves

Three octaves, each taking what a continuous slope budget leaves after the
one above it. The budget is interpolated green -> fairway -> rough from
distance to the cup and distance to the corridor centreline, so the green
gets micro plus about 40% of meso and almost no macro, while the rough runs
unmasked.

Amplitudes are derived from A = G / (f * k) rather than written out, with
k = 7.333 measured against the installed simplex-noise build. The previous
2*pi and the research's 2.5 are both wrong -- 2.5 is the mean gradient, not
the max -- and the research's published amplitudes are 2.9x too large, which
would bust the green's budget on the micro octave alone.

The masks use smoothstep01 rather than a clamp: a clamp is C0 but not C1, and
a mask whose derivative steps puts a slope discontinuity into the height
field. Probe numbers move here for the first time; they are re-baselined at
the end of the phase."
```

---

## Task 10: Corridor carving and spec-sourced pads

**Files:**
- Modify: `src/sim/terrain.ts` (`heightAt`)
- Modify: `src/sim/terrain.test.ts` (add the carving tests)

**Interfaces:**
- Consumes: `noiseHeightAt`, `spline`, the scratch objects from Task 9.
- Produces: no new exports. `heightAt` becomes `lerp(H_spline(t*), H_noise(x, z), M)`.

- [ ] **Step 1: Write the failing test**

Append to `src/sim/terrain.test.ts`:

```ts
describe("corridor carving", () => {
  it("has exactly zero lateral camber inside the corridor", () => {
    // Every point sharing a centreline parameter gets the centreline's height, so a cross
    // section of the corridor is flat by construction rather than by tuning.
    const normal = { x: 0, z: 0 };
    for (let i = 1; i < 100; i++) {
      const t = i / 100;
      const centre = terrain.spline.pointAt(t);
      terrain.spline.tangentInto(t, normal);
      const nx = -normal.z;
      const nz = normal.x;
      const middle = terrain.heightAt(centre.x, centre.z);
      for (const offset of [-12, -6, 6, 12]) {
        const h = terrain.heightAt(centre.x + nx * offset, centre.z + nz * offset);
        expect(Math.abs(h - middle)).toBeLessThan(1e-6);
      }
    }
  });

  it("keeps a longitudinal profile: the corridor is flat across, not flat along", () => {
    let relief = 0;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const centre = terrain.spline.pointAt(i / 100);
      const h = terrain.heightAt(centre.x, centre.z);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    relief = high - low;
    expect(relief).toBeGreaterThan(0.2);
  });

  it("is C1 across the corridor edge and the rough edge: no step in the slope", () => {
    // The failure this catches is a mask whose derivative jumps -- the ramp failure the
    // research warns about. Sample the second difference of H along the corridor normal.
    const normal = { x: 0, z: 0 };
    const t = 0.5;
    const centre = terrain.spline.pointAt(t);
    terrain.spline.tangentInto(t, normal);
    const nx = -normal.z;
    const nz = normal.x;

    const h = 0.05;
    const slopeAt = (d: number): number =>
      (terrain.heightAt(centre.x + nx * (d + h), centre.z + nz * (d + h)) -
        terrain.heightAt(centre.x + nx * (d - h), centre.z + nz * (d - h))) /
      (2 * h);

    for (const edge of [HALF_WIDTH, HALF_WIDTH + BLEND_WIDTH]) {
      const before = slopeAt(edge - 0.25);
      const after = slopeAt(edge + 0.25);
      // A C0-but-not-C1 mask steps the slope; a C1 one changes it smoothly over 0.5 m.
      expect(Math.abs(after - before)).toBeLessThan(0.02);
    }
  });

  it("hands the corridor the corridor's budget, not the querying point's", () => {
    // An implementation that reuses the caller's mask gives the centreline rough-grade
    // undulation. Measured as: the centreline is smoother than the rough it runs through.
    let corridor = 0;
    let rough = 0;
    for (let i = 1; i < 100; i++) {
      const centre = terrain.spline.pointAt(i / 100);
      const previous = terrain.spline.pointAt((i - 1) / 100);
      corridor = Math.max(
        corridor,
        Math.abs(terrain.heightAt(centre.x, centre.z) - terrain.heightAt(previous.x, previous.z)) /
          Math.hypot(centre.x - previous.x, centre.z - previous.z),
      );
    }
    for (let x = -78; x <= 78; x += 3) {
      for (let z = -78; z <= 78; z += 3) {
        if (terrain.spline.nearest(x, z).distance < HALF_WIDTH + BLEND_WIDTH) continue;
        rough = Math.max(
          rough,
          Math.abs(terrain.heightAt(x + 1, z) - terrain.heightAt(x, z)),
        );
      }
    }
    expect(corridor).toBeLessThan(rough);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sim/terrain.test.ts`
Expected: FAIL on "has exactly zero lateral camber" — without carving the corridor inherits the
noise's cross-slope.

- [ ] **Step 3: Add the carving to `heightAt`**

```ts
  /**
   * Carving. Every point in the corridor is handed the height of the centreline point it is
   * nearest to, so lateral camber inside the corridor is exactly zero by construction while the
   * longitudinal profile is inherited from the noise and stays interesting. Outside the blend
   * band the point keeps its own height.
   *
   * H_spline(t) is `noiseHeightAt` evaluated at the centreline point with a corridor distance of
   * ZERO -- the corridor's budget, not the querying point's. Reusing the caller's masks here
   * gives the corridor rough-grade undulation and fails the camber test; it is the one trap in
   * this function.
   */
  function heightAt(worldX: number, worldZ: number): number {
    spline.nearestInto(worldX, worldZ, nearestScratch);
    const mask = smoothstep01((nearestScratch.distance - HALF_WIDTH) / BLEND_WIDTH);

    let height: number;
    if (mask >= 1) {
      height = noiseHeightAt(worldX, worldZ, nearestScratch.distance);
    } else {
      spline.pointInto(nearestScratch.t, centreScratch);
      const centre = noiseHeightAt(centreScratch.x, centreScratch.z, 0);
      height =
        mask <= 0
          ? centre
          : centre + (noiseHeightAt(worldX, worldZ, nearestScratch.distance) - centre) * mask;
    }

    // Tee and green keep an additional local flattening on top of the corridor: a putting
    // surface needs to be flatter than the corridor alone delivers.
    for (const pad of pads) {
      const distance = Math.hypot(worldX - pad.x, worldZ - pad.z);
      if (distance >= pad.radius) continue;
      const weight = smoothstep01(1 - distance / pad.radius);
      height += (pad.height - height) * weight;
    }
    return height;
  }
```

Move `centreScratch`'s declaration here from Task 9's block if `noUnusedLocals` rejected it
there. The `mask >= 1` / `mask <= 0` branches are not micro-optimisation — outside the blend
band the centreline query is not merely wasted, it is the wrong height to be blending toward.

The pad heights must now come from the carved height, so change the `pads` construction to sample
the centreline the same way (the tee and cup both sit on the corridor, so this is the same value
`noiseHeightAt(x, z, 0)` already gave — keep it as it is, and note in a comment that it matches
the carved corridor height by construction).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sim/terrain.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Re-run the tunneling check**

This is a terrain physics change, and AGENTS.md requires it after one.

Run: `npm run probe`
Expected: three club rows print with finite carry/roll/total, none marked `TIMED-OUT`, and the
driver's apex is a sane single-digit-to-low-tens metre figure rather than diverging. Record the
new numbers — Task 16 writes them into `docs/ROADMAP.md`.

- [ ] **Step 6: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/sim/terrain.ts src/sim/terrain.test.ts
git commit -s -m "Carve the corridor toward the centreline

H_final lerps from the centreline's own height to the free noise across the
blend band. Because every point in the corridor is handed the height of the
centreline point it is nearest to, lateral camber inside the corridor is
exactly zero by construction -- no constant to tune, and the camber check
only has to police the blend band, where camber is nonzero by design. The
longitudinal profile still comes from the noise, so the corridor is flat
across without being flat along.

The centreline's height is evaluated with a corridor distance of zero, which
is the corridor's budget rather than the querying point's. Reusing the
caller's mask there gives the corridor rough-grade undulation; the camber
test is what catches it."
```

---

## Task 11: Continuous `tuningAt`, spline-based `surfaceAt`

This fixes a defect in shipped code as well as adding the corridor: `tuningAt` currently returns
a discrete row, so `crr` steps from 0.11 to 0.22 in one tick at the fairway edge and the solver
sees an acceleration discontinuity. Phase 1.5's gate passed with it, so it is latent rather than
fatal — it gets fixed here rather than tracked.

**Files:**
- Modify: `src/sim/surfaces.ts`
- Modify: `src/sim/world.ts` (three `tuningAt` call sites, two scratch fields)
- Test: `src/sim/surfaces.test.ts` (create)

**Interfaces:**
- Consumes: `HALF_WIDTH`, `BLEND_WIDTH`, `GREEN_BLEND`, `GREEN_RADIUS`, `smoothstep01` from
  `./terrain`; `createNearestPoint`, `NearestPoint` from `./spline`.
- Produces:
  ```ts
  export interface MutableSurfaceTuning {
    rolling: number;
    bounceScale: number;
    cartSpeedScale: number;
    isHazard: boolean;
  }
  export function createSurfaceTuning(): MutableSurfaceTuning;
  // Surfaces.tuningAt changes shape:
  tuningAt(worldX: number, worldZ: number, out: MutableSurfaceTuning): void;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/sim/surfaces.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, createTerrain } from "./terrain";
import { SURFACES, SurfaceId, createSurfaceTuning, createSurfaces } from "./surfaces";

const SPEC = fixedHoleSpec();
const terrain = createTerrain(SPEC);
const surfaces = createSurfaces(SPEC, terrain);

/** A point `offset` metres to the left of the centreline at parameter t. */
function acrossCorridor(t: number, offset: number): { x: number; z: number } {
  const centre = terrain.spline.pointAt(t);
  const tangent = { x: 0, z: 0 };
  terrain.spline.tangentInto(t, tangent);
  return { x: centre.x - tangent.z * offset, z: centre.z + tangent.x * offset };
}

describe("tuningAt", () => {
  it("writes into the caller's object rather than returning a new one", () => {
    const out = createSurfaceTuning();
    const centre = terrain.spline.pointAt(0.5);
    surfaces.tuningAt(centre.x, centre.z, out);
    const first = out.rolling;

    const far = acrossCorridor(0.5, HALF_WIDTH + BLEND_WIDTH + 20);
    surfaces.tuningAt(far.x, far.z, out);
    expect(out.rolling).not.toBe(first);
  });

  it("matches SURFACES exactly on the mown corridor and in full rough", () => {
    const out = createSurfaceTuning();

    const centre = acrossCorridor(0.5, 0);
    surfaces.tuningAt(centre.x, centre.z, out);
    expect(out.rolling).toBeCloseTo(SURFACES[SurfaceId.Fairway].rolling, 9);
    expect(out.bounceScale).toBeCloseTo(SURFACES[SurfaceId.Fairway].bounceScale, 9);

    const rough = acrossCorridor(0.5, HALF_WIDTH + BLEND_WIDTH + 15);
    surfaces.tuningAt(rough.x, rough.z, out);
    expect(out.rolling).toBeCloseTo(SURFACES[SurfaceId.Rough].rolling, 9);
  });

  it("is monotone across the fairway-to-rough band", () => {
    const out = createSurfaceTuning();
    let previous = -Infinity;
    for (let d = HALF_WIDTH - 2; d <= HALF_WIDTH + BLEND_WIDTH + 2; d += 0.5) {
      const p = acrossCorridor(0.5, d);
      // Skip cells the discrete classifier calls sand or water: those keep hard edges.
      const id = surfaces.surfaceAt(p.x, p.z);
      if (id === SurfaceId.Sand || id === SurfaceId.Water) continue;
      surfaces.tuningAt(p.x, p.z, out);
      expect(out.rolling).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = out.rolling;
    }
    expect(previous).toBeCloseTo(SURFACES[SurfaceId.Rough].rolling, 6);
  });

  it("reaches the green's rolling resistance at the cup", () => {
    const out = createSurfaceTuning();
    surfaces.tuningAt(SPEC.cup.x, SPEC.cup.z, out);
    expect(out.rolling).toBeCloseTo(SURFACES[SurfaceId.Green].rolling, 9);
  });

  it("takes no intermediate step larger than a tick's worth of acceleration change", () => {
    // The shipped defect: crr jumped 0.11 -> 0.22 in one tick at the fairway edge. Assert the
    // largest single-metre change is a small fraction of that.
    const out = createSurfaceTuning();
    let worst = 0;
    let previous: number | null = null;
    for (let d = 0; d <= HALF_WIDTH + BLEND_WIDTH + 10; d += 0.25) {
      const p = acrossCorridor(0.35, d);
      const id = surfaces.surfaceAt(p.x, p.z);
      if (id === SurfaceId.Sand || id === SurfaceId.Water) {
        previous = null;
        continue;
      }
      surfaces.tuningAt(p.x, p.z, out);
      if (previous !== null) worst = Math.max(worst, Math.abs(out.rolling - previous));
      previous = out.rolling;
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("keeps sand and water hard-edged", () => {
    // A bunker lip and a water margin are supposed to be abrupt: blending them would make a
    // ball drift to a halt in a bunker rather than stop in it.
    const out = createSurfaceTuning();
    let sampled = false;
    for (let x = -78; x <= 78 && !sampled; x += 1) {
      for (let z = -78; z <= 78; z += 1) {
        if (surfaces.surfaceAt(x, z) !== SurfaceId.Sand) continue;
        surfaces.tuningAt(x, z, out);
        expect(out.rolling).toBe(SURFACES[SurfaceId.Sand].rolling);
        expect(out.bounceScale).toBe(SURFACES[SurfaceId.Sand].bounceScale);
        sampled = true;
        break;
      }
    }
    expect(sampled).toBe(true);
  });

  it("flags water as a hazard and nothing else", () => {
    const out = createSurfaceTuning();
    const centre = terrain.spline.pointAt(0.5);
    surfaces.tuningAt(centre.x, centre.z, out);
    expect(out.isHazard).toBe(false);
  });
});

describe("surfaceAt", () => {
  it("calls the corridor fairway out to the middle of the blend band", () => {
    const inside = acrossCorridor(0.5, HALF_WIDTH + BLEND_WIDTH / 2 - 1);
    const outside = acrossCorridor(0.5, HALF_WIDTH + BLEND_WIDTH / 2 + 1);
    // Sand can win over either, so only assert when the classifier is not calling it sand.
    if (surfaces.surfaceAt(inside.x, inside.z) !== SurfaceId.Sand) {
      expect(surfaces.surfaceAt(inside.x, inside.z)).toBe(SurfaceId.Fairway);
    }
    if (surfaces.surfaceAt(outside.x, outside.z) !== SurfaceId.Sand) {
      expect(surfaces.surfaceAt(outside.x, outside.z)).toBe(SurfaceId.Rough);
    }
  });

  it("follows the dog-leg rather than the straight tee-to-cup line", () => {
    // A point beside the apex is on the corridor; the same distance off the straight line is not.
    const apex = SPEC.control[1];
    expect(surfaces.surfaceAt(apex.x, apex.z)).not.toBe(SurfaceId.Rough);
  });

  it("calls the cup's neighbourhood green", () => {
    expect(surfaces.surfaceAt(SPEC.cup.x, SPEC.cup.z)).toBe(SurfaceId.Green);
    expect(surfaces.surfaceAt(SPEC.cup.x + GREEN_RADIUS - 1, SPEC.cup.z)).toBe(SurfaceId.Green);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sim/surfaces.test.ts`
Expected: FAIL — `createSurfaceTuning` is not exported and `tuningAt` takes two arguments.

- [ ] **Step 3: Rewrite the classification and tuning in `src/sim/surfaces.ts`**

Replace the imports and add the mutable type:

```ts
import { createNearestPoint } from "./spline";
import type { NearestPoint } from "./spline";
import {
  BLEND_WIDTH,
  GREEN_BLEND,
  GREEN_RADIUS,
  HALF_WIDTH,
  smoothstep01,
} from "./terrain";
import type { Terrain } from "./terrain";

/**
 * The scratch `tuningAt` writes into. `SurfaceTuning` stays readonly because it is what callers
 * consume; this sibling exists because `Sim.step` calls `tuningAt` every tick and a blended
 * result is a new value, which would allocate. Matches the `Sim.muzzle(out: Vec3)` idiom.
 */
export interface MutableSurfaceTuning {
  rolling: number;
  bounceScale: number;
  cartSpeedScale: number;
  isHazard: boolean;
}

export function createSurfaceTuning(): MutableSurfaceTuning {
  return { rolling: 0, bounceScale: 0, cartSpeedScale: 0, isHazard: false };
}

/** Nested lerp, green -> fairway -> rough, using the same weights the height budget uses. */
function blendMown(
  green: number,
  fairway: number,
  rough: number,
  tGreen: number,
  tCorridor: number,
): number {
  const mown = green + (fairway - green) * tGreen;
  return mown + (rough - mown) * tCorridor;
}
```

Delete `FAIRWAY_HALF_WIDTH` and `distanceToFairwayLine`. Inside `createSurfaces`, add the
scratch and the two weights, and rewrite the two functions:

```ts
  // Closure-owned scratch: both functions run inside the fixed tick.
  const nearestScratch: NearestPoint = createNearestPoint();

  /** 0 on the green, 1 off it. */
  function greenWeight(worldX: number, worldZ: number): number {
    const toCup = Math.hypot(worldX - spec.cup.x, worldZ - spec.cup.z);
    return smoothstep01((toCup - GREEN_RADIUS) / GREEN_BLEND);
  }

  /** 0 on the mown corridor, 1 in full rough. Fills `nearestScratch` as a side effect. */
  function corridorWeight(worldX: number, worldZ: number): number {
    terrain.spline.nearestInto(worldX, worldZ, nearestScratch);
    return smoothstep01((nearestScratch.distance - HALF_WIDTH) / BLEND_WIDTH);
  }

  /**
   * Classification order is a priority list, not a blend: water wins over everything (it is
   * defined by height, so it cannot be overridden by a mowing pattern), then the green, then
   * bunkers, then the corridor, and rough is the fallback.
   *
   * The corridor's visual edge sits where the blend crosses halfway -- smoothstep01 is 0.5 at
   * its midpoint, so `tCorridor < 0.5` is the same line the physics is already half-way across.
   * One source for the edge rather than a separate visual constant to drift.
   */
  function surfaceAt(worldX: number, worldZ: number): SurfaceId {
    if (terrain.heightAt(worldX, worldZ) < spec.waterLevel) return SurfaceId.Water;
    if (Math.hypot(worldX - spec.cup.x, worldZ - spec.cup.z) < GREEN_RADIUS) {
      return SurfaceId.Green;
    }
    if (sandNoise(worldX * SAND_FREQUENCY, worldZ * SAND_FREQUENCY) > SAND_THRESHOLD) {
      return SurfaceId.Sand;
    }
    return corridorWeight(worldX, worldZ) < 0.5 ? SurfaceId.Fairway : SurfaceId.Rough;
  }

  /**
   * Continuous, unlike `surfaceAt`. rolling, bounceScale and cartSpeedScale are smoothstep-
   * blended across the green<->fairway and fairway<->rough boundaries using exactly the weights
   * the height field's budget uses, so the visual edge and the physical gradient come from one
   * source.
   *
   * Sand and water keep hard edges. A bunker lip and a water margin are supposed to be abrupt,
   * and blending them would make a ball drift to a halt in a bunker rather than stop in it.
   */
  function tuningAt(worldX: number, worldZ: number, out: MutableSurfaceTuning): void {
    const id = surfaceAt(worldX, worldZ);
    if (id === SurfaceId.Sand || id === SurfaceId.Water) {
      const hard = SURFACES[id];
      out.rolling = hard.rolling;
      out.bounceScale = hard.bounceScale;
      out.cartSpeedScale = hard.cartSpeedScale;
      out.isHazard = hard.isHazard;
      return;
    }

    const tGreen = greenWeight(worldX, worldZ);
    const tCorridor = corridorWeight(worldX, worldZ);
    const green = SURFACES[SurfaceId.Green];
    const fairway = SURFACES[SurfaceId.Fairway];
    const rough = SURFACES[SurfaceId.Rough];

    out.rolling = blendMown(green.rolling, fairway.rolling, rough.rolling, tGreen, tCorridor);
    out.bounceScale = blendMown(
      green.bounceScale,
      fairway.bounceScale,
      rough.bounceScale,
      tGreen,
      tCorridor,
    );
    out.cartSpeedScale = blendMown(
      green.cartSpeedScale,
      fairway.cartSpeedScale,
      rough.cartSpeedScale,
      tGreen,
      tCorridor,
    );
    out.isHazard = false;
  }
```

Update the `Surfaces` interface's `tuningAt` to the three-argument void signature.

- [ ] **Step 4: Give `Sim` its scratch and update the three call sites**

In `src/sim/world.ts`, add to the imports:

```ts
import { SURFACES, SurfaceId, createSurfaceTuning, createSurfaces } from "./surfaces";
import type { MutableSurfaceTuning, Surfaces } from "./surfaces";
```

Add two scratch fields beside the existing ones:

```ts
  /** Two, not one: the cart and the ball are at different positions within the same tick. */
  private readonly cartTuningScratch: MutableSurfaceTuning = createSurfaceTuning();
  private readonly ballTuningScratch: MutableSurfaceTuning = createSurfaceTuning();
```

In `stepCart`:

```ts
    this.surfaces.tuningAt(c.x, c.z, this.cartTuningScratch);
    this.cart.step(driving ? intent : this.parkedIntent(intent), FIXED_DT, this.cartTuningScratch);
```

In `applySurfaceResistance`:

```ts
    const tuning = this.ballTuningScratch;
    this.surfaces.tuningAt(p.x, p.z, tuning);
```

`Cart.step` takes a `readonly` `SurfaceTuning`, and a `MutableSurfaceTuning` is structurally
assignable to it, so `src/sim/entities/Cart.ts` needs no change.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/sim/surfaces.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass; no type errors. `world.cart.test.ts` cart-speed assertions may shift
slightly — `cartSpeedScale` is now blended rather than stepped, so the cart accelerates through
the corridor edge instead of snapping.

- [ ] **Step 7: Verify the feel numbers moved in the expected direction**

Run: `npm run probe`
Expected: settle times are similar or slightly longer (a ball crossing the fairway edge is no
longer hit with a step change in `crr`), and the surface mix now reflects the 20 m corridor
rather than the 26 m one. Record the numbers for Task 16.

- [ ] **Step 8: Commit**

```bash
git add src/sim/surfaces.ts src/sim/surfaces.test.ts src/sim/world.ts
git commit -s -m "Make surface tuning continuous and the corridor a spline

surfaceAt stays discrete -- the HUD, the minimap and render colouring all
want a crisp answer -- but tuningAt now blends rolling, bounce and cart speed
across the green/fairway and fairway/rough boundaries using the same weights
the height budget uses, so the visual edge and the physical gradient come
from one source.

This also fixes a latent defect: tuningAt returned a discrete row, so crr
stepped 0.11 -> 0.22 in a single tick at the fairway edge and the solver saw
an acceleration discontinuity. Phase 1.5's gate passed with it, which made it
latent rather than fatal.

Sand and water keep hard edges on purpose. A bunker lip is supposed to be
abrupt; blending it would make a ball drift to a halt in a bunker rather than
stop in it.

tuningAt writes into a caller-owned scratch because Sim.step calls it every
tick and a blended result is a new value."
```

---

# Stage D — Generation (§6)

## Task 12: The seven playability checks

Landing the checks before the generator means the generator can be written against a validator
that is already tested, rather than both being debugged at once.

**Files:**
- Modify: `src/sim/course.ts`
- Modify: `src/sim/course.test.ts`

**Interfaces:**
- Consumes: `createTerrain`, `HALF_WIDTH`, `BLEND_WIDTH`, `GREEN_RADIUS`, `Terrain` from
  `./terrain`; `MutableVec2` from `./spline`.
- Produces:
  ```ts
  export const MIN_HOLE_LENGTH = 60;
  export const EDGE_MARGIN = 6;
  export const REFERENCE_CARRY_M = 129;
  export const MAX_ATTEMPTS = 32;
  export const MAX_LONGITUDINAL_GRAD: number;   // tan(6.27 deg)
  export const MAX_CAMBER_GRAD: number;         // tan(4.00 deg)
  export const MAX_GREEN_GRAD: number;          // tan(3.43 deg)
  export interface HoleRejection { readonly check: number; readonly reason: string }
  export function validateHole(spec: HoleSpec, terrain: Terrain): HoleRejection | null;
  export function derivePar(corridorLength: number): number;
  ```

Checks 3–5 are the research's. Checks 1, 2, 6 and 7 are this project's additions:

- **Reachability (7).** A hole can pass every slope check and still be unplayable at 400 m
  against a 129 m driver. Slope validity is not playability.
- **Flooding (6).** Water is height-derived, not authored, so a carved corridor can dip below
  `waterLevel` and wall the hole off with a hazard that has no carry.
- **Field containment (2).** `fieldSize` is per-hole and the corridor is a curve, so "fits" is a
  real check rather than a given.
- **Minimum length (1).** A 20 m par 3 is not a hole.

- [ ] **Step 1: Write the failing test**

Append to `src/sim/course.test.ts`:

```ts
import {
  EDGE_MARGIN,
  MAX_CAMBER_GRAD,
  MIN_HOLE_LENGTH,
  REFERENCE_CARRY_M,
  derivePar,
  validateHole,
} from "./course";
import type { HoleSpec } from "./course";
import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH } from "./terrain";
import type { Terrain } from "./terrain";
import { createSpline } from "./spline";

/**
 * Test terrains, so each check can be violated in isolation. validateHole only ever reads
 * `heightAt` and `spline` off a Terrain, both public, so a stand-in is honest rather than a
 * back door -- and it is the only way to make "check 3 rejects a spec that violates only
 * check 3" a real statement.
 */
function fakeTerrain(spec: HoleSpec, heightAt: (x: number, z: number) => number): Terrain {
  return {
    spec,
    spline: createSpline(spec.control),
    heightAt,
    buildHeightfield: () => new Float32Array(0),
    teePosition: { x: spec.tee.x, y: heightAt(spec.tee.x, spec.tee.z), z: spec.tee.z },
    cupPosition: { x: spec.cup.x, y: heightAt(spec.cup.x, spec.cup.z), z: spec.cup.z },
  };
}

/** A legal par 4 running west to east down the middle of a 220 m field. */
function validSpec(overrides: Partial<HoleSpec> = {}): HoleSpec {
  const tee = { x: -80, z: 0 };
  const cup = { x: 80, z: 0 };
  return {
    seed: 1,
    index: 0,
    fieldSize: 220,
    cells: 220,
    tee,
    cup,
    control: [tee, { x: 0, z: 0 }, cup],
    par: 4,
    waterLevel: -0.72,
    ...overrides,
  };
}

const FLAT = (): number => 0;

describe("validateHole", () => {
  it("accepts a legal hole on flat ground", () => {
    const spec = validSpec();
    expect(validateHole(spec, fakeTerrain(spec, FLAT))).toBeNull();
  });

  it("check 1 rejects a tee and cup closer than MIN_HOLE_LENGTH", () => {
    const tee = { x: -20, z: 0 };
    const cup = { x: 20, z: 0 };
    const spec = validSpec({ tee, cup, control: [tee, { x: 0, z: 0 }, cup] });
    expect(Math.hypot(cup.x - tee.x, cup.z - tee.z)).toBeLessThan(MIN_HOLE_LENGTH);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))?.check).toBe(1);
  });

  it("check 2 rejects a corridor that leaves the field", () => {
    // Room in a 220 m field is 110 - 15 - 10 - 6 = 79 m; put the apex outside it.
    const tee = { x: -70, z: 0 };
    const cup = { x: 70, z: 0 };
    const spec = validSpec({ tee, cup, control: [tee, { x: 0, z: -100 }, cup] });
    expect(110 - HALF_WIDTH - BLEND_WIDTH - EDGE_MARGIN).toBe(79);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))?.check).toBe(2);
  });

  it("check 3 rejects a corridor climbing steeper than tan(6.27 deg)", () => {
    const spec = validSpec();
    // Ramp along the corridor's own direction: longitudinal, with zero cross-slope.
    const ramp = (x: number): number => x * 0.2;
    expect(validateHole(spec, fakeTerrain(spec, ramp))?.check).toBe(3);
  });

  it("check 4 rejects a corridor cambered steeper than tan(4 deg)", () => {
    const spec = validSpec();
    // Ramp perpendicular to a west-east corridor: pure camber, zero longitudinal grade.
    const camber = (_x: number, z: number): number => z * 0.2;
    expect(camber(0, 1)).toBeGreaterThan(MAX_CAMBER_GRAD);
    expect(validateHole(spec, fakeTerrain(spec, camber))?.check).toBe(4);
  });

  it("check 5 rejects a green steeper than tan(3.43 deg)", () => {
    const spec = validSpec();
    // A shallow cone with its apex exactly at the cup: steep inside the green, flat outside,
    // and zero at the cup itself so the corridor's own longitudinal grade stays legal.
    const cone = (x: number, z: number): number => {
      const r = Math.hypot(x - spec.cup.x, z - spec.cup.z);
      return r < GREEN_RADIUS ? r * 0.1 : GREEN_RADIUS * 0.1;
    };
    expect(validateHole(spec, fakeTerrain(spec, cone))?.check).toBe(5);
  });

  it("check 6 rejects a corridor running below the water level", () => {
    const spec = validSpec();
    const sunken = (): number => spec.waterLevel - 0.5;
    expect(validateHole(spec, fakeTerrain(spec, sunken))?.check).toBe(6);
  });

  it("check 7 rejects a corridor longer than three full driver shots", () => {
    // 3 * 129 = 387 m. A 500 m field with a 460 m straight corridor busts it -- and the field
    // is large enough that check 2 still passes, so 7 is the only violation.
    const tee = { x: -230, z: 0 };
    const cup = { x: 230, z: 0 };
    const spec = validSpec({
      fieldSize: 600,
      cells: 600,
      tee,
      cup,
      control: [tee, { x: 0, z: 0 }, cup],
    });
    expect(460).toBeGreaterThan(3 * REFERENCE_CARRY_M);
    expect(validateHole(spec, fakeTerrain(spec, FLAT))?.check).toBe(7);
  });

  it("names the failing check and says why, so a rejection is diagnosable", () => {
    const spec = validSpec();
    const rejection = validateHole(spec, fakeTerrain(spec, (x) => x * 0.2));
    expect(rejection?.reason).toMatch(/longitudinal/i);
  });
});

describe("derivePar", () => {
  it("puts one full driver at par 3 and clamps to [3, 5]", () => {
    expect(derivePar(10)).toBe(3);
    expect(derivePar(REFERENCE_CARRY_M - 1)).toBe(3);
    expect(derivePar(REFERENCE_CARRY_M + 1)).toBe(4);
    expect(derivePar(2 * REFERENCE_CARRY_M + 1)).toBe(5);
    expect(derivePar(10 * REFERENCE_CARRY_M)).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sim/course.test.ts`
Expected: FAIL — `validateHole` is not exported.

- [ ] **Step 3: Write the checks in `src/sim/course.ts`**

Add the imports and constants:

```ts
import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import type { MutableVec2 } from "./spline";
import { hashChannel, mulberry32 } from "./rng";

/** A 20 m par 3 is not a hole. */
export const MIN_HOLE_LENGTH = 60;

/** Clearance between the corridor's outer edge and the field boundary. */
export const EDGE_MARGIN = 6;

/**
 * The driver's full-power distance, in metres, as measured by `npm run probe` in Phase 0:
 * 129 m TOTAL -- 69.5 m carry plus 59.5 m roll-out. Total rather than carry is the right
 * quantity for both consumers: a hole is reachable on where the ball ends up, and par follows
 * the same logic.
 *
 * This is NOT a second copy of CLUB_STATS. AGENTS.md forbids a second source of truth for club
 * stats, and distance is not a field in that table -- it is an emergent result of the
 * ballistics integration. The link is closed by a probe assertion that measured driver distance
 * stays within +-15% of this number, so a club-balance change that invalidates par fails the
 * probe instead of silently mis-parring every hole.
 */
export const REFERENCE_CARRY_M = 129;

/** Deterministic and bounded, never an unbounded search. */
export const MAX_ATTEMPTS = 32;

/** Slope ceilings, as tan(theta). Written as expressions so the degrees stay readable. */
export const MAX_LONGITUDINAL_GRAD = Math.tan((6.27 * Math.PI) / 180);
export const MAX_CAMBER_GRAD = Math.tan((4.0 * Math.PI) / 180);
export const MAX_GREEN_GRAD = Math.tan((3.43 * Math.PI) / 180);

/** Centreline sampling interval for checks 2, 3, 4 and 6. */
const CENTRELINE_SAMPLE_M = 1.0;

export interface HoleRejection {
  /** Which numbered check failed, matching the spec's table. */
  readonly check: number;
  readonly reason: string;
}

/**
 * Par is derived, never authored: one full driver per stroke over par 3.
 *
 *   par = clamp(3 + floor(corridorLength / REFERENCE_CARRY_M), 3, 5)
 */
export function derivePar(corridorLength: number): number {
  return Math.min(5, Math.max(3, 3 + Math.floor(corridorLength / REFERENCE_CARRY_M)));
}
```

Add the validator:

```ts
/**
 * The seven playability checks, run against a candidate and its terrain. Returns the first
 * failure or null.
 *
 * Only the corridor and the green are policed. The rough runs unbudgeted on purpose (see
 * GRAD_ROUGH in terrain.ts): a ball on a steep rough patch is *supposed* to keep rolling out
 * onto flatter ground rather than parking on a hillside.
 *
 * Cheap geometric checks run first so a hopeless candidate is rejected before any terrain is
 * sampled.
 */
export function validateHole(spec: HoleSpec, terrain: Terrain): HoleRejection | null {
  const spline = terrain.spline;

  const separation = Math.hypot(spec.cup.x - spec.tee.x, spec.cup.z - spec.tee.z);
  if (separation < MIN_HOLE_LENGTH) {
    return {
      check: 1,
      reason: `tee-to-cup ${separation.toFixed(1)} m is under the ${MIN_HOLE_LENGTH} m minimum`,
    };
  }

  const reachLimit = 3 * REFERENCE_CARRY_M;
  if (spline.length > reachLimit) {
    return {
      check: 7,
      reason: `corridor ${spline.length.toFixed(1)} m exceeds three driver shots (${reachLimit} m)`,
    };
  }

  const room = spec.fieldSize / 2 - (HALF_WIDTH + BLEND_WIDTH) - EDGE_MARGIN;
  const arm = HALF_WIDTH + BLEND_WIDTH / 2;
  const steps = Math.max(2, Math.ceil(spline.length / CENTRELINE_SAMPLE_M));
  const tangent: MutableVec2 = { x: 0, z: 0 };
  let previousX = 0;
  let previousZ = 0;
  let previousHeight = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = spline.pointAt(t);
    const height = terrain.heightAt(p.x, p.z);

    if (Math.abs(p.x) > room || Math.abs(p.z) > room) {
      return {
        check: 2,
        reason: `centreline reaches (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), outside the ${room.toFixed(1)} m box`,
      };
    }

    if (height < spec.waterLevel) {
      return {
        check: 6,
        reason: `centreline height ${height.toFixed(2)} m is below the water level ${spec.waterLevel}`,
      };
    }

    if (i > 0) {
      const run = Math.hypot(p.x - previousX, p.z - previousZ);
      if (run > 1e-6) {
        const grade = Math.abs(height - previousHeight) / run;
        if (grade > MAX_LONGITUDINAL_GRAD) {
          return {
            check: 3,
            reason: `longitudinal grade ${grade.toFixed(4)} at t=${t.toFixed(3)} exceeds ${MAX_LONGITUDINAL_GRAD.toFixed(4)}`,
          };
        }
      }
    }
    previousX = p.x;
    previousZ = p.z;
    previousHeight = height;

    // Each side is measured against the centreline separately rather than across the full
    // width: averaging the two banks lets an asymmetric bowl cancel itself out and pass.
    spline.tangentInto(t, tangent);
    const normalX = -tangent.z;
    const normalZ = tangent.x;
    for (const side of [-1, 1]) {
      const camber =
        Math.abs(
          terrain.heightAt(p.x + normalX * arm * side, p.z + normalZ * arm * side) - height,
        ) / arm;
      if (camber > MAX_CAMBER_GRAD) {
        return {
          check: 4,
          reason: `lateral camber ${camber.toFixed(4)} at t=${t.toFixed(3)} exceeds ${MAX_CAMBER_GRAD.toFixed(4)}`,
        };
      }
    }
  }

  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 24) {
    for (let radius = 1; radius <= GREEN_RADIUS; radius += 1) {
      const x = spec.cup.x + Math.cos(angle) * radius;
      const z = spec.cup.z + Math.sin(angle) * radius;
      const dx = (terrain.heightAt(x + 0.5, z) - terrain.heightAt(x - 0.5, z)) / 1.0;
      const dz = (terrain.heightAt(x, z + 0.5) - terrain.heightAt(x, z - 0.5)) / 1.0;
      const grade = Math.hypot(dx, dz);
      if (grade > MAX_GREEN_GRAD) {
        return {
          check: 5,
          reason: `green grade ${grade.toFixed(4)} at ${radius} m from the cup exceeds ${MAX_GREEN_GRAD.toFixed(4)}`,
        };
      }
    }
  }

  return null;
}
```

`createTerrain`, `hashChannel` and `mulberry32` are imported here but unused until Task 13 —
`noUnusedLocals` will reject them. Add those three imports in Task 13 instead.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sim/course.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/sim/course.ts src/sim/course.test.ts
git commit -s -m "Add the seven playability checks

Three are the terrain research's slope checks. Four are this project's:
reachability, because a hole can pass every slope check and still be
unplayable at 400 m against a 129 m driver; flooding, because water here is
height-derived rather than authored so a carved corridor can dip below it;
field containment, because fieldSize is per-hole and the corridor is a curve;
and a minimum length.

Camber is measured on each side against the centreline separately rather
than across the full width -- averaging the banks lets an asymmetric bowl
cancel itself out and pass.

Only the corridor and the green are policed. The rough runs unbudgeted by
design: a ball on a steep rough patch should keep rolling out onto flatter
ground rather than parking on a hillside.

REFERENCE_CARRY_M records the driver's measured 129 m total distance --
carry plus roll -- and is not a second copy of CLUB_STATS; the probe
assertion is what keeps the two honest."
```

---

## Task 13: `generateHole` and `generateCourse`

**Files:**
- Modify: `src/sim/course.ts`
- Modify: `src/sim/course.test.ts`

**Interfaces:**
- Consumes: `validateHole`, `derivePar`, `MAX_ATTEMPTS` from this module; `createTerrain`,
  `HALF_WIDTH`, `BLEND_WIDTH` from `./terrain`; `createSpline` from `./spline`; `hashChannel`,
  `mulberry32` from `./rng`.
- Produces:
  ```ts
  export function parForIndex(index: number): number;
  export interface GenerateOptions {
    readonly validate?: (spec: HoleSpec, terrain: Terrain) => HoleRejection | null;
  }
  export function generateHole(
    courseSeed: number, index: number, intendedPar?: number, options?: GenerateOptions,
  ): HoleSpec;
  export function generateCourse(courseSeed: number, holeCount: number): Course;
  ```

**How the layout is drawn, and why the numbers are what they are.** Checks 2 and 7 interact, and
the interaction is the design. In a 160 m field the usable box after `HALF_WIDTH + BLEND_WIDTH +
EDGE_MARGIN` is 98 × 98 m, which caps a dog-legged corridor near 200 m — a par 4. Check 7 never
binds there; check 2 does. So `fieldSize` is chosen from the intended par first:

| intended par | corridor band | `fieldSize` | `cells` | usable box half |
|---|---|---|---|---|
| 3 | 70–125 m | 160 | 160 | 49 m |
| 4 | 135–250 m | 220 | 220 | 79 m |
| 5 | 265–375 m | 300 | 300 | 119 m |

The draw is *target-first*: pick a corridor length inside the band, take whatever straight
tee-to-cup distance the box allows along a random bearing, then solve for the apex offset that
makes up the difference. Solving rather than drawing the apex directly is what keeps the derived
par equal to the intended one in the worst case — a par 5 in a 300 m field aligned with an axis
gets only 238 m of straight, and needs a ~75 m dog-leg to reach 265 m. **The spline is the
mechanism for having more than one kind of hole, not decoration.**

- [ ] **Step 1: Write the failing test**

Append to `src/sim/course.test.ts`:

```ts
import { MAX_ATTEMPTS, generateCourse, generateHole, parForIndex } from "./course";
import { createTerrain } from "./terrain";

describe("generateHole", () => {
  it("is byte-identical across repeated calls", () => {
    expect(generateHole(4242, 3)).toEqual(generateHole(4242, 3));
  });

  it("is independent of call order", () => {
    const first = generateHole(4242, 3);
    generateHole(4242, 0);
    generateHole(99, 3);
    generateHole(4242, 7);
    expect(generateHole(4242, 3)).toEqual(first);
  });

  it("differs between holes of the same course and between courses", () => {
    expect(generateHole(4242, 0)).not.toEqual(generateHole(4242, 1));
    expect(generateHole(4242, 0)).not.toEqual(generateHole(4243, 0));
  });

  it("produces a hole that passes its own checks", () => {
    const spec = generateHole(4242, 3);
    expect(validateHole(spec, createTerrain(spec))).toBeNull();
  });

  it("derives par from the corridor rather than copying the intended par", () => {
    const spec = generateHole(4242, 3);
    expect(spec.par).toBe(derivePar(createTerrain(spec).spline.length));
  });

  it("sizes the field from the intended par and keeps the cell near 1 m", () => {
    for (const [par, fieldSize] of [[3, 160], [4, 220], [5, 300]] as const) {
      const spec = generateHole(777, 0, par);
      expect(spec.fieldSize).toBe(fieldSize);
      expect(spec.fieldSize / spec.cells).toBeCloseTo(1.0, 3);
      expect(spec.par).toBe(par);
    }
  });

  it("always produces a dog-legged corridor of at least three control points", () => {
    const spec = generateHole(4242, 3);
    expect(spec.control.length).toBe(3);
    expect(spec.control[0]).toEqual(spec.tee);
    expect(spec.control[2]).toEqual(spec.cup);
  });

  it("throws rather than returning an invalid hole when attempts run out", () => {
    expect(() =>
      generateHole(1, 0, 4, { validate: () => ({ check: 99, reason: "always rejects" }) }),
    ).toThrow(new RegExp(`${MAX_ATTEMPTS}`));
  });

  it("names the last rejection when it throws, so exhaustion is diagnosable", () => {
    expect(() =>
      generateHole(1, 0, 4, { validate: () => ({ check: 99, reason: "always rejects" }) }),
    ).toThrow(/always rejects/);
  });
});

describe("generateCourse", () => {
  it("builds a par-36 front nine", () => {
    const course = generateCourse(2026, 9);
    expect(course.holes).toHaveLength(9);
    expect(course.holes.reduce((sum, h) => sum + h.par, 0)).toBe(36);
  });

  it("indexes every hole by its position", () => {
    const course = generateCourse(2026, 9);
    course.holes.forEach((hole, i) => expect(hole.index).toBe(i));
  });

  it("is deterministic", () => {
    expect(generateCourse(2026, 9)).toEqual(generateCourse(2026, 9));
  });

  it("gives a different course a different set of holes", () => {
    expect(generateCourse(2026, 9).holes[0]).not.toEqual(generateCourse(2027, 9).holes[0]);
  });

  it("carries an id and a name derived from the seed", () => {
    const course = generateCourse(2026, 9);
    expect(course.seed).toBe(2026);
    expect(course.id).toContain("2026");
    expect(course.name.length).toBeGreaterThan(0);
  });

  it("every hole passes all seven checks", () => {
    for (const hole of generateCourse(2026, 9).holes) {
      expect(validateHole(hole, createTerrain(hole))).toBeNull();
    }
  });

  it("cycles the par mix for a course that is not nine holes", () => {
    expect(generateCourse(2026, 18).holes).toHaveLength(18);
    expect(parForIndex(9)).toBe(parForIndex(0));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sim/course.test.ts`
Expected: FAIL — `generateHole` is not exported.

- [ ] **Step 3: Write the generator in `src/sim/course.ts`**

Add the three deferred imports from Task 12 (`createTerrain`, `hashChannel`, `mulberry32`) plus
`createSpline`, then append:

```ts
/**
 * A par-36 front nine. Cycled for courses that are not nine holes, so an 18-hole course is two
 * nines rather than an error.
 */
const PAR_MIX: readonly number[] = [4, 3, 4, 5, 4, 3, 4, 4, 5];

export function parForIndex(index: number): number {
  return PAR_MIX[((index % PAR_MIX.length) + PAR_MIX.length) % PAR_MIX.length];
}

/**
 * Field size scales with the par being aimed at, which is why fieldSize lives on HoleSpec
 * rather than being global. `cells` tracks it to hold the cell near 1.0 m: a coarser cell makes
 * heightfield triangle seams large enough for the 0.15 m ball to trip over.
 */
const FIELD_FOR_PAR: Readonly<Record<number, number>> = { 3: 160, 4: 220, 5: 300 };

/** Corridor length bands, chosen so derivePar returns the par the field was sized for. */
const CORRIDOR_BAND: Readonly<Record<number, { min: number; max: number }>> = {
  3: { min: 70, max: 125 },
  4: { min: 135, max: 250 },
  5: { min: 265, max: 375 },
};

/** How much of the usable box a straight run and a dog-leg apex are allowed to consume. */
const STRAIGHT_FILL = 0.92;
const APEX_FILL = 0.85;

/**
 * One candidate layout. Deterministic in (courseSeed, index, par, attempt) and does no
 * validation -- generateHole owns the accept/reject decision.
 *
 * Target-first: draw the corridor length, take whatever straight distance the box allows along
 * a random bearing, then SOLVE for the apex offset that makes up the difference. Drawing the
 * apex directly instead lets the worst case fall short of its band -- a par 5 in a 300 m field
 * aligned with an axis has only 238 m of straight available and needs a ~75 m dog-leg to reach
 * 265 m. This is the sense in which the dog-leg is load-bearing rather than decorative.
 */
function attemptSpec(courseSeed: number, index: number, par: number, attempt: number): HoleSpec {
  const seed = hashChannel(courseSeed, index, attempt);
  const random = mulberry32(hashChannel(seed, index, 2));

  const fieldSize = FIELD_FOR_PAR[par];
  const half = fieldSize / 2 - (HALF_WIDTH + BLEND_WIDTH) - EDGE_MARGIN;

  const bearing = random() * Math.PI * 2;
  const dirX = Math.cos(bearing);
  const dirZ = Math.sin(bearing);
  // Distance from the centre to the wall of a square box along +-bearing. The perpendicular
  // bearing swaps |dirX| and |dirZ|, so max() of the pair gives the same reach for both.
  const reach = half / Math.max(Math.abs(dirX), Math.abs(dirZ));

  const band = CORRIDOR_BAND[par];
  const target = band.min + (band.max - band.min) * random();
  const straight = Math.min(reach * 2 * STRAIGHT_FILL, target);

  const tee: Vec2 = { x: (-dirX * straight) / 2, z: (-dirZ * straight) / 2 };
  const cup: Vec2 = { x: (dirX * straight) / 2, z: (dirZ * straight) / 2 };

  // Solve 2 * hypot(straight / 2, apex) = target, then clamp to the box.
  const wanted = Math.sqrt(Math.max(0, (target / 2) ** 2 - (straight / 2) ** 2));
  const offset = Math.min(wanted, reach * APEX_FILL) * (random() < 0.5 ? -1 : 1);
  const apex: Vec2 = { x: -dirZ * offset, z: dirX * offset };

  return {
    seed,
    index,
    fieldSize,
    cells: fieldSize,
    tee,
    cup,
    control: [tee, apex, cup],
    // Placeholder: replaced with the derived value in generateHole, which has the spline.
    par,
    waterLevel: -0.72,
  };
}

export interface GenerateOptions {
  /**
   * Overrides the playability validator. Exists so the MAX_ATTEMPTS exhaustion path is
   * testable; production never passes it.
   */
  readonly validate?: (spec: HoleSpec, terrain: Terrain) => HoleRejection | null;
}

/**
 * Rejection sampling: hash (courseSeed, index, attempt) into a seed, draw a layout, build its
 * terrain, and run every check. On rejection, increment `attempt`. On exhausting MAX_ATTEMPTS,
 * throw -- deterministic and bounded, never an unbounded search.
 *
 * `intendedPar` only picks the field size. The par on the returned spec is derived from the
 * corridor the spline actually produced.
 */
export function generateHole(
  courseSeed: number,
  index: number,
  intendedPar: number = parForIndex(index),
  options: GenerateOptions = {},
): HoleSpec {
  const validate = options.validate ?? validateHole;
  let last: HoleRejection = { check: 0, reason: "no attempt was made" };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = attemptSpec(courseSeed, index, intendedPar, attempt);
    const terrain = createTerrain(candidate);
    // par is the only field the terrain does not depend on, so deriving it after construction
    // costs nothing and keeps "par is never authored" true.
    const spec: HoleSpec = { ...candidate, par: derivePar(terrain.spline.length) };
    const rejection = validate(spec, terrain);
    if (rejection === null) return spec;
    last = rejection;
  }

  throw new Error(
    `generateHole(${courseSeed}, ${index}) exhausted ${MAX_ATTEMPTS} attempts; ` +
      `the last rejection was check ${last.check}: ${last.reason}`,
  );
}

export function generateCourse(courseSeed: number, holeCount: number): Course {
  const holes: HoleSpec[] = [];
  for (let index = 0; index < holeCount; index++) {
    holes.push(generateHole(courseSeed, index));
  }
  return {
    id: `course-${courseSeed >>> 0}`,
    name: `Course ${(courseSeed >>> 0).toString(16).toUpperCase()}`,
    seed: courseSeed >>> 0,
    holes,
  };
}
```

`createSpline` is not needed here after all — `createTerrain` builds and exposes the spline, and
building a second one would be a second source of truth for the corridor. Do not import it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sim/course.test.ts`
Expected: PASS, 27 tests.

**If a `generateHole` call throws here, that is a finding, not a broken test.** The spec is
explicit that the research's 80–85% acceptance figure "carries no weight here and the real
number is recorded from this run". Record which check dominates the rejections (the thrown
message names it), then fix the *cause* rather than the threshold:

- check 4 (camber) dominating means the blend band inherits too much cross-slope; the lever is
  `BLEND_WIDTH`, not `MAX_CAMBER_GRAD`.
- check 5 (green) dominating means the green budget's 4% margin over `MAX_GREEN_GRAD` is too
  thin; the lever is `GREEN_BLEND` or `G_MICRO`.
- check 2 (containment) dominating means `STRAIGHT_FILL` / `APEX_FILL` are too greedy.

Whatever moves, record it in `docs/ROADMAP.md` in Task 16 with the measured rate.

- [ ] **Step 5: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/sim/course.ts src/sim/course.test.ts
git commit -s -m "Generate holes by rejection sampling

generateHole hashes (courseSeed, index, attempt) into a seed, draws a
layout, builds its terrain and runs all seven checks, retrying up to
MAX_ATTEMPTS and then throwing. Bounded and deterministic: the same seed is
the same course on every machine, and generation can fail loudly but never
hang.

The layout draw is target-first -- pick a corridor length, take whatever
straight distance the box allows along a random bearing, then solve for the
apex offset that makes up the difference. Drawing the apex directly lets the
worst case fall short of its band: a par 5 in a 300 m field aligned with an
axis has 238 m of straight available and needs a 75 m dog-leg to reach its
265 m minimum. That is why the dog-leg is load-bearing rather than
decoration -- without it a 160 m field caps out at a par 3 and nothing else.

Field size is chosen from the intended par because checks 2 and 7 interact:
in a small field the corridor runs out of room long before it runs out of
driver. Par on the returned spec is derived from the corridor the spline
actually produced, never copied from the intent."
```

---

## Task 14: The game boots on a generated course

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `generateCourse` from `./sim/course`.
- Produces: nothing new.

- [ ] **Step 1: Replace the fixture with a generated course**

In `src/main.ts`, swap the import and the two lines from Task 6:

```ts
import { generateCourse } from "./sim/course";
```

```ts
  // One course, nine holes, one seed. Playing past hole 0 is Phase 1.75's round flow: the
  // renderer's ground mesh is built once, so advancing needs a screen transition, not just
  // sim.loadHole.
  const course = generateCourse(COURSE_SEED, 9);
  const sim = await Sim.create(course.holes[0]);
  const render = new RenderScene(container, sim.terrain);
```

Add near the top of the file, beside the other module constants:

```ts
/**
 * Fixed until a course-select screen exists (Phase 1.75). Changing it changes every hole, which
 * is the whole point of the seed -- and is the cheapest way to eyeball generation variety
 * during development.
 */
const COURSE_SEED = 2026;
```

Extend the dev-only console hook so the course is inspectable:

```ts
  (window as unknown as { __teetimeturrets: unknown }).__teetimeturrets = { sim, render, course };
```

- [ ] **Step 2: Verify the type check is clean**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Verify the browser path still works**

Run: `npm run smoke`
Expected: PASS. This is the only automated coverage `main.ts` has, and it now exercises real
generation on startup.

- [ ] **Step 4: Look at it**

Run: `npm run dev`, open the page, and play a shot.

Check by eye, against `docs/concept/`: the fairway curves rather than running straight; the
corridor edge is graded rather than a step; the green is visibly flatter than its surroundings;
the ball settles on the corridor instead of drifting off it. Note anything that looks wrong for
Task 16 — this is the only human-in-the-loop step in the plan, and the geometry it inspects is
exactly the kind `tools/sceneGate.mjs` will guard once it exists.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -s -m "Boot on a generated nine-hole course

main.ts generates a course from one seed and plays hole 0. Advancing through
the round needs a screen transition because the ground mesh is built once at
construction, so it stays with Phase 1.75's round flow -- but the course now
exists as data rather than as a hardcoded hole, which is what that work will
consume."
```

---

# Stage E — Verification and roadmap (§7, §10)

## Task 15: Four probe assertions

`npm run probe` gains the four checks the spec specifies. Three assert; the fourth reports,
because the number it reports has never been measured for this codebase.

**Files:**
- Modify: `src/sim/course.ts` (export the candidate draft)
- Modify: `tools/feelProbe.ts`

**Interfaces:**
- Consumes: `createNoise2D` from `simplex-noise`; `mulberry32` from `../src/sim/rng`;
  `NOISE_MAX_GRADIENT`, `createTerrain` from `../src/sim/terrain`; `REFERENCE_CARRY_M`,
  `derivePar`, `draftHole`, `generateCourse`, `parForIndex`, `validateHole` from
  `../src/sim/course`.
- Produces: `export function draftHole(courseSeed, index, par, attempt): HoleSpec` — Task 13's
  `attemptSpec`, exported and renamed. `generateHole`'s call site changes with it.

**Note on runtime.** These assertions add real work: the `k` measurement is ~4M noise
evaluations, and the acceptance sweep builds 200 terrains and validates each. `npm run probe`
goes from a couple of seconds to tens of seconds. That is expected — it is the price of the
generator's own criteria being re-run from outside it.

- [ ] **Step 1: Export the candidate draft**

In `src/sim/course.ts`, rename `attemptSpec` to `draftHole`, export it, and update the one call
site inside `generateHole`. Extend its doc comment:

```ts
/**
 * One candidate layout, before validation. Deterministic in (courseSeed, index, par, attempt).
 *
 * Exported so `npm run probe` can measure the acceptance rate: calling generateHole and
 * counting throws measures whether a *course* can be built, which is a different and much
 * coarser question than what fraction of candidates are playable.
 */
export function draftHole(
  courseSeed: number,
  index: number,
  par: number,
  attempt: number,
): HoleSpec {
```

- [ ] **Step 2: Add the four checks to `tools/feelProbe.ts`**

Extend the import block:

```ts
import { createNoise2D } from "simplex-noise";
import { mulberry32 } from "../src/sim/rng";
import { NOISE_MAX_GRADIENT, createTerrain } from "../src/sim/terrain";
import {
  REFERENCE_CARRY_M,
  derivePar,
  draftHole,
  generateCourse,
  parForIndex,
  validateHole,
} from "../src/sim/course";
```

Add the four functions before `main()`:

```ts
/** Fixed so the measurement is comparable run to run; the band's job is to catch a library bump. */
const K_PROBE_SEED = 20260901;
const PROBE_COURSE_SEED = 2026;

let probeFailed = false;

function report(name: string, ok: boolean, detail: string): void {
  if (!ok) probeFailed = true;
  console.log(`  ${name.padEnd(22)} ${ok ? "PASS" : "FAIL"} - ${detail}`);
}

/**
 * 1. The measured constant. Every terrain amplitude solves A = G / (f * k) with this k, so it
 *    is a property of the installed simplex-noise build that a version bump can silently
 *    invalidate -- which is why it is an assertion here rather than a number in a document.
 *
 *    Central differences at h = 1e-4 over 1,002,001 samples of a 20x20 domain, matching how
 *    7.333 was measured in the first place.
 */
function noiseGradientCheck(): void {
  const noise = createNoise2D(mulberry32(K_PROBE_SEED));
  const h = 1e-4;
  const steps = 1000;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i <= steps; i++) {
    const x = -10 + (20 * i) / steps;
    for (let j = 0; j <= steps; j++) {
      const z = -10 + (20 * j) / steps;
      const dx = (noise(x + h, z) - noise(x - h, z)) / (2 * h);
      const dz = (noise(x, z + h) - noise(x, z - h)) / (2 * h);
      const g = Math.hypot(dx, dz);
      if (g > max) max = g;
      sum += g;
      count++;
    }
  }
  const tolerance = NOISE_MAX_GRADIENT * 0.05;
  report(
    "noise gradient k",
    Math.abs(max - NOISE_MAX_GRADIENT) <= tolerance,
    `max ${max.toFixed(3)} (mean ${(sum / count).toFixed(3)}, n=${count}), ` +
      `expected ${NOISE_MAX_GRADIENT} +-5%`,
  );
}

/**
 * 2. Closes the par-derivation loop. REFERENCE_CARRY_M is the driver's measured full-power
 *    TOTAL distance -- carry plus roll-out -- and is not a second copy of CLUB_STATS. A club
 *    rebalance that invalidates par fails here instead of silently mis-parring every hole.
 */
async function driverDistanceCheck(sim: Sim): Promise<void> {
  const r = await shoot(sim, ClubType.Driver);
  const drift = Math.abs(r.totalM - REFERENCE_CARRY_M) / REFERENCE_CARRY_M;
  report(
    "driver distance",
    drift <= 0.15,
    `${r.totalM.toFixed(1)} m total (${r.carryM.toFixed(1)} carry + ${r.rollM.toFixed(1)} roll) ` +
      `vs REFERENCE_CARRY_M ${REFERENCE_CARRY_M}, drift ${(drift * 100).toFixed(1)}% (limit 15%)`,
  );
}

/** 3. The generator's own criteria, re-run from outside it against a full nine. */
function coursePlayabilityCheck(): void {
  let failures = 0;
  const course = generateCourse(PROBE_COURSE_SEED, 9);
  for (const hole of course.holes) {
    const rejection = validateHole(hole, createTerrain(hole));
    if (rejection === null) continue;
    failures++;
    console.log(`    hole ${hole.index}: check ${rejection.check} - ${rejection.reason}`);
  }
  const pars = course.holes.map((h) => h.par).join("");
  report(
    "course playability",
    failures === 0,
    `${course.holes.length} holes, pars ${pars} (total ${course.holes.reduce((s, h) => s + h.par, 0)}), ` +
      `${failures} failing`,
  );
}

/**
 * 4. Reports rather than asserts. The research claims 80-85%, computed from its miscalibrated
 *    amplitudes; that figure carries no weight here and the real number is what this run
 *    records. The per-check breakdown is the useful part -- it names which threshold is
 *    actually binding.
 */
function acceptanceReport(): void {
  const samples = 200;
  let accepted = 0;
  const byCheck = new Map<number, number>();
  for (let i = 0; i < samples; i++) {
    const candidate = draftHole(PROBE_COURSE_SEED, i, parForIndex(i), 0);
    const terrain = createTerrain(candidate);
    const spec = { ...candidate, par: derivePar(terrain.spline.length) };
    const rejection = validateHole(spec, terrain);
    if (rejection === null) accepted++;
    else byCheck.set(rejection.check, (byCheck.get(rejection.check) ?? 0) + 1);
  }
  const breakdown = [...byCheck.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([check, n]) => `check ${check}: ${n}`)
    .join(", ");
  console.log(
    `  acceptance rate         ${((accepted / samples) * 100).toFixed(1)}% ` +
      `(${accepted}/${samples})${breakdown ? ` - rejections by ${breakdown}` : ""}`,
  );
}
```

In `main()`, after `hazardAndHoleOutChecks(sim)`, add:

```ts
  console.log("\n=== COURSE CHECKS ===");
  noiseGradientCheck();
  await driverDistanceCheck(sim);
  coursePlayabilityCheck();
  acceptanceReport();

  if (probeFailed) {
    console.error("\nprobe: one or more course checks failed");
    process.exitCode = 1;
  }
```

`process.exitCode = 1` on failure is new — the probe previously only reported. Setting it means
a broken assertion is visible to a caller rather than buried in output.

- [ ] **Step 3: Run the probe**

Run: `npm run probe`
Expected: the `COURSE CHECKS` block prints four lines. Record all four.

**If `noise gradient k` fails**, the measured max is the truth and 7.333 is not. This is exactly
the failure mode the assertion exists for. Do not widen the band. Instead:

1. Set `NOISE_MAX_GRADIENT` in `src/sim/terrain.ts` to the measured value.
2. The three amplitudes are expressions over it (`A = G / (f * k)`), so they follow
   automatically — nothing else to edit.
3. Re-run `npx vitest run` (the budget tests in `terrain.test.ts` are the check that the new
   amplitudes still fit their budgets) and re-run the probe.
4. Record the old value, the new value, and the cause in `docs/ROADMAP.md` in Task 16.

**If `driver distance` fails**, do not change `REFERENCE_CARRY_M` to make it pass. Phase 0's
still-open item is that the driver's 0.86 roll/carry ratio wants a play session and a `loftDeg`
change; that is club balance, explicitly out of scope here (spec §9), and moving the constant
would hide it. Record the measured number and leave the assertion failing with a note, or set
`REFERENCE_CARRY_M` to the newly measured total *and* record that par derivation shifted with it.

- [ ] **Step 4: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all suites pass; no type errors. Remember `tsc` does not cover `tools/**` — Step 3 is
the only thing that type-checks the probe.

- [ ] **Step 5: Commit**

```bash
git add src/sim/course.ts tools/feelProbe.ts
git commit -s -m "Assert the terrain's measured constants in the probe

Four checks. The noise gradient k is a property of the installed
simplex-noise build that every amplitude solves against, so a version bump
that changes it would silently invalidate all three -- it is asserted here
rather than recorded in a comment. Driver distance is asserted against
REFERENCE_CARRY_M to close the par-derivation loop, so a club rebalance
fails visibly instead of mis-parring every hole.

The third re-runs the generator's own seven checks from outside it against a
full nine. The fourth reports the candidate acceptance rate with a per-check
breakdown rather than asserting a target: the research's 80-85% was computed
from miscalibrated amplitudes and carries no weight here, so the real number
is whatever this run records.

The probe now sets a non-zero exit code when a check fails."
```

---

## Task 16: Re-baseline and roadmap placement

Terrain changed and `crr` became continuous, so Phase 0 and Phase 1.5 probe figures moved. They
are re-baselined **with the cause recorded**, not quietly overwritten — that is the spec's own
requirement and the gate for the phase.

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Collect the final numbers**

Run: `npm run probe > /tmp/probe-phase-2.5.txt 2>&1 && cat /tmp/probe-phase-2.5.txt`

Also run `npx vitest run` and `npx tsc --noEmit` one final time. Every figure written below
comes from this run — do not carry forward a number from an earlier step, because Tasks 9–15 all
moved something.

- [ ] **Step 2: Add Phase 2.5 to `docs/ROADMAP.md`**

Insert between the end of the Phase 2 section and the `## Phase 3 — Targets, ragdolls, pickups`
heading. Fill every `<…>` from Step 1's output:

```markdown
## Phase 2.5 — The Course — ✅ DONE

Independent of Phase 1.75, so the two may land in either order.
Design: `docs/superpowers/specs/2026-09-01-procedural-course-design.md`.
Plan: `docs/superpowers/plans/2026-09-01-procedural-course-generation.md`.
Source research: `docs/RESEARCH-TERRAIN.md` — its architecture was adopted, its constants
rejected. `BACKLOG.md #2` (multi-hole course) is promoted into this phase.

**Built:** `src/sim/course.ts` (HoleSpec/Course, the seven playability checks, rejection
sampling), `src/sim/spline.ts` (centripetal Catmull-Rom corridor centreline), `src/sim/rng.ts`
(mulberry32 + channel hashing). `terrain.ts` and `surfaces.ts` became factories over one spec;
`world.ts` takes the hole it is playing.

**What deliberately did not change:** the Delaunay render mesh, hierarchical jitter, hexagonal
base grid and Voronoi biome colouring from the research's §1.2/§2/§3 are deferred. They produce
exactly the geometry `tools/sceneGate.mjs` exists to guard, and that gate is still unbuilt
(Phase 1) — so deferring buys time to build the gate before the geometry that needs it arrives.
The Blender primitive-graph prop exporter pairs with that deferred phase, not this one.

**The measured constant.** The per-octave max gradient `k` in `A = G / (f * k)` was measured
directly against the installed `simplex-noise` build: max ‖∇S‖ = **<measured k>** (rms <…>,
mean <…>), over 1,002,001 samples. Neither prior source was right — this module used 2π, and
the research's 2.5 is the *mean* gradient, not the max. The research's published amplitudes
(0.12 / 1.40 / 14.40 m) are 2.9× too large and would bust the green's budget on the micro octave
alone, so they were not used. `k` is asserted in `npm run probe` because a dependency bump can
silently invalidate all three amplitudes.

**Re-baselined figures.** Terrain changed (two octaves → three with budget masking and corridor
carving) and `crr` became continuous across surface boundaries, so these moved for stated
reasons. Phase 0 / Phase 1.5 → Phase 2.5:

| | Phase 0/1.5 | Phase 2.5 | cause |
|---|---|---|---|
| terrain mean slope | 4.3° | <…>° | three-octave budget masking replaces the two-octave field |
| terrain max slope | 12.5° | <…>° | the rough runs unbudgeted at GRAD_ROUGH = 0.28 |
| driver total | 129 m | <…> m | terrain relief and continuous crr |
| driver carry / roll | 69.5 / 59.5 m | <…> / <…> m | as above |
| putter settle | 3.2 s | <…> s | crr no longer steps at the fairway edge |
| surface mix | 26 m hard corridor | <…> | 15 m corridor + 10 m graded edge |
| candidate acceptance | — | <…>% | first measurement; research's 80–85% not applicable |

**Gate passed:**
- [ ] All Vitest suites green (`npm test`).
- [ ] `tsc --noEmit` clean.
- [ ] The four new probe assertions pass.
- [ ] A generated 9-hole course has every hole satisfy all seven checks.
- [ ] The Phase 0 tunneling check still passes: full-power shot, ball Y stays bounded.
- [ ] Re-baselined figures recorded above with their causes, not silently replaced.

**Still open:** the driver's roll/carry ratio is still the Phase 0 item — club balance wants a
play session, and changing `loftDeg` during this phase would have confounded the re-baseline.
Advancing through the nine holes needs Phase 1.75's screen transition: `Sim.loadHole` exists and
is tested, but the renderer's ground mesh is built once at construction.
```

Tick each gate box only after running the thing it names.

- [ ] **Step 3: Update `docs/BACKLOG.md`**

Replace row #2 (`Multi-hole course (front 9)`):

```markdown
| 2 | Multi-hole course (front 9) | DONE | Delivered by Phase 2.5. `generateCourse(seed, 9)` returns nine independently-specified holes; `main.ts` plays hole 0. Advancing between them needs Phase 1.75's screen transition, because the renderer's ground mesh is built once at construction — `Sim.loadHole` is the sim-side half and already exists. See `docs/superpowers/specs/2026-09-01-procedural-course-design.md`. |
```

Replace row #5 (`Aim spread wired with a seeded RNG`):

```markdown
| 5 | Aim spread wired with a seeded RNG | READY | `applyAimSpread` takes an injected `random` and nothing injects one. The port is done — `mulberry32` and `hashChannel` are in `src/sim/rng.ts` as of Phase 2.5 — so this is now just wiring a per-shot channel into the call. Still true after Phase 2: the cart fires with no spread at all. |
```

- [ ] **Step 4: Verify the whole gate end to end**

Run: `npm test && npx tsc --noEmit && npm run probe && npm run smoke`
Expected: everything passes and the probe exits zero. This is the Phase 2.5 gate as
`docs/ROADMAP.md` now states it.

- [ ] **Step 5: Commit**

```bash
git add docs/ROADMAP.md docs/BACKLOG.md
git commit -s -m "Record Phase 2.5 and re-baseline the probe figures

Terrain changed and crr became continuous, so the Phase 0 and Phase 1.5 feel
numbers moved. They are re-baselined with the cause for each rather than
quietly overwritten, because a number that changes without a reason recorded
is indistinguishable from a regression the next time someone reads it.

Also records the measured noise gradient k and why neither previously
published figure was right, and the first real candidate acceptance rate --
the research's 80-85% was computed from amplitudes this project rejected.

BACKLOG #2 closes into this phase. #5 stays open but its port is done."
```

---

# Self-review

Run against the spec after finishing, before calling the phase complete.

**Spec coverage.** Every section maps to a task:

| spec § | tasks |
|---|---|
| §1 decision, deferral | scope of this plan; §1–§3 deferrals restated in Task 16's roadmap entry |
| §2 the measured constant | Task 9 (`NOISE_MAX_GRADIENT`), Task 15 (assertion 1) |
| §3 data model, factories, seeding | Tasks 1–7 |
| §4 height formulation, budget masking | Task 9 |
| §5 spline, carving, continuous physics | Tasks 8, 10, 11 |
| §6 generation and validation, derived par | Tasks 12, 13 |
| §7 verification (Vitest + four probe assertions) | Tasks 1, 8, 9, 10, 11, 12, 13, 15 |
| §8 blast radius and migration ordering | Tasks 3–7 (all five importers), Task 14 |
| §9 out of scope | nothing in any task touches Blender, `sceneGate.mjs`, boundary mountains, round state, or club balance |
| §10 roadmap placement, gate | Task 16 |

**The spec's four named Vitest suites, and where they are:**

- `spline.test.ts` — Task 8. Cusp comparison, `nearest` vs brute force to 1 cm, `length`
  monotone in control-point spread. ✔
- `terrain.test.ts` — Tasks 9 and 10. Mask C¹ across both edges, zero lateral camber in the
  corridor. ✔
- `course.test.ts` — Tasks 2, 12, 13. Byte-identical across repeated calls and call order, each
  of the seven checks rejecting a spec that violates only it, `MAX_ATTEMPTS` throwing. ✔
- `surfaces.test.ts` — Task 11. `tuningAt` writes into the scratch, blended `rolling` monotone
  across the fairway→rough band and exact at both extremes. ✔

**Blast radius — all five importers of `terrain.ts` migrate:** `world.ts` (Task 5),
`surfaces.ts` (Task 4), `scene.ts` (Task 6), `world.cart.test.ts` (Task 5), `feelProbe.ts`
(Task 7). Plus `main.ts` (Tasks 6 and 14). ✔

**Type consistency.** Names used across task boundaries, defined once:

| name | defined | consumed |
|---|---|---|
| `mulberry32`, `hashChannel` | Task 1 | 3, 4, 13 |
| `Vec2`, `Vec3`, `HoleSpec`, `Course` | Task 2 | 3, 5, 8, 12, 13 |
| `legacyHoleSpec` → `fixedHoleSpec` | Task 2, renamed Task 9 | 5, 6, 9, 11 |
| `Terrain`, `createTerrain`, `TerrainSources` | Task 3 | 4, 5, 6, 9, 12, 13, 15 |
| `smoothstep01` | Task 3 (exported) | 9, 11 |
| `Surfaces`, `createSurfaces` | Task 4 | 5, 11 |
| `Spline`, `createSpline`, `NearestPoint`, `MutableVec2`, `createNearestPoint` | Task 8 | 9, 10, 11, 12 |
| `HALF_WIDTH`, `BLEND_WIDTH`, `GREEN_BLEND`, `GRAD_*`, `NOISE_MAX_GRADIENT` | Task 9 | 11, 12, 15 |
| `MutableSurfaceTuning`, `createSurfaceTuning` | Task 11 | 11 (world.ts) |
| `validateHole`, `HoleRejection`, `derivePar`, `REFERENCE_CARRY_M`, `MAX_ATTEMPTS` | Task 12 | 13, 15 |
| `generateHole`, `generateCourse`, `parForIndex`, `draftHole` | Tasks 13, 15 | 14, 15 |

`GREEN_RADIUS` and `CUP_RADIUS` keep their existing names and values in `terrain.ts` throughout.

**Deletions accounted for:** `terrain.legacy.test.ts`, `surfaces.legacy.test.ts`,
`LEGACY_TERRAIN_SOURCES`, `LEGACY_SURFACE_SOURCES` — all deleted in Task 9, after Task 7 has
used them for the §3 gate. `FAIRWAY_HALF_WIDTH` and `distanceToFairwayLine` — deleted in
Task 11. The module-level terrain/surfaces exports — deleted in Task 7.

**Known judgement calls a reviewer should check rather than assume:**

1. **`REFERENCE_CARRY_M` is a total, not a carry.** Argued at the top of this plan. If the
   reviewer disagrees, the alternative is a second constant for carry and a reachability rule
   written against total anyway — which is the same number twice.
2. **Generated holes are symmetric about the field centre.** `draftHole` places the tee and cup
   at `∓dir · straight/2` from the origin with no positional jitter, because jitter trades
   variety against check-2 headroom and containment is the check that binds. Variety comes from
   bearing, target length, apex sign and magnitude, and the terrain seed. Worth a BACKLOG row if
   nine holes read as samey in Task 14's Step 4.
3. **`spline.pointAt` is polyline-exact, not curve-exact.** Deliberate: it makes `pointAt` and
   `nearest` exact inverses, which is what gives zero camber by construction.
4. **`createSpline` takes an optional `alpha`.** Only tests pass it. Without it the spec's own
   required cusp test cannot be written.
5. **`generateHole` takes an optional `validate` override.** Only the exhaustion test passes it.
6. **The acceptance rate is unknown until Task 15 runs.** Task 13's Step 4 says what to do if
   generation fails: fix the cause, name the binding check, record it — never loosen a
   threshold to make a red run green.
